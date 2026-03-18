import {
  createPublicClient,
  http,
  type Address,
  formatUnits,
} from "viem";
import { BASE_RPC_URL, CHAIN, TOKEN_DECIMALS, type TradingPair } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolState {
  venue: "aerodrome" | "uniswap";
  pair: string;
  price: number; // price of base token in quote terms
  liquidity: bigint;
  timestamp: number;
}

export interface PriceSnapshot {
  pair: string;
  aerodrome: PoolState | null;
  uniswap: PoolState | null;
  spread: number; // percentage spread between venues
  timestamp: number;
}

export interface PriceHistory {
  prices: number[];
  timestamps: number[];
  volumes: number[]; // estimated from liquidity changes
}

// ---------------------------------------------------------------------------
// ABIs (minimal)
// ---------------------------------------------------------------------------

const UNISWAP_V3_POOL_ABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

const AERODROME_V2_POOL_ABI = [
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_reserve0", type: "uint256" },
      { name: "_reserve1", type: "uint256" },
      { name: "_blockTimestampLast", type: "uint256" },
    ],
  },
  {
    name: "token0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "token1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Price feed
// ---------------------------------------------------------------------------

const MAX_HISTORY = 200;

export class PriceFeed {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private history: Map<string, PriceHistory> = new Map();

  constructor(rpcUrl: string = BASE_RPC_URL) {
    this.client = createPublicClient({
      chain: CHAIN,
      transport: http(rpcUrl),
    });
  }

  // ---- Uniswap V3 --------------------------------------------------------

  private sqrtPriceX96ToPrice(
    sqrtPriceX96: bigint,
    decimals0: number,
    decimals1: number,
  ): number {
    // price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
    const num = Number(sqrtPriceX96);
    const denom = 2 ** 96;
    const ratio = num / denom;
    const price = ratio * ratio * 10 ** (decimals0 - decimals1);
    return price;
  }

  async getUniswapState(pair: TradingPair): Promise<PoolState | null> {
    try {
      const [slot0, liquidity] = await Promise.all([
        this.client.readContract({
          address: pair.uniswapPool,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: "slot0",
        }),
        this.client.readContract({
          address: pair.uniswapPool,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: "liquidity",
        }),
      ]);

      const sqrtPriceX96 = slot0[0];
      const dec0 = TOKEN_DECIMALS[pair.base] ?? 18;
      const dec1 = TOKEN_DECIMALS[pair.quote] ?? 18;
      const price = this.sqrtPriceX96ToPrice(sqrtPriceX96, dec0, dec1);

      return {
        venue: "uniswap",
        pair: pair.name,
        price,
        liquidity,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error(`[PriceFeed] Uniswap read failed for ${pair.name}:`, err);
      return null;
    }
  }

  // ---- Aerodrome V2 -------------------------------------------------------

  async getAerodromeState(pair: TradingPair): Promise<PoolState | null> {
    try {
      const [reserves, token0] = await Promise.all([
        this.client.readContract({
          address: pair.aerodromePool,
          abi: AERODROME_V2_POOL_ABI,
          functionName: "getReserves",
        }),
        this.client.readContract({
          address: pair.aerodromePool,
          abi: AERODROME_V2_POOL_ABI,
          functionName: "token0",
        }),
      ]);

      const [reserve0, reserve1] = reserves;
      const dec0 = TOKEN_DECIMALS[pair.base] ?? 18;
      const dec1 = TOKEN_DECIMALS[pair.quote] ?? 18;

      // Determine order: if token0 == base, price = reserve1/reserve0 adjusted
      const isBaseToken0 =
        (token0 as Address).toLowerCase() === pair.base.toLowerCase();

      let price: number;
      if (isBaseToken0) {
        const r0 = Number(formatUnits(reserve0, dec0));
        const r1 = Number(formatUnits(reserve1, dec1));
        price = r0 > 0 ? r1 / r0 : 0;
      } else {
        const r0 = Number(formatUnits(reserve0, dec1));
        const r1 = Number(formatUnits(reserve1, dec0));
        price = r1 > 0 ? r0 / r1 : 0;
      }

      return {
        venue: "aerodrome",
        pair: pair.name,
        price,
        liquidity: reserve0 + reserve1,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error(
        `[PriceFeed] Aerodrome read failed for ${pair.name}:`,
        err,
      );
      return null;
    }
  }

  // ---- Snapshot -----------------------------------------------------------

  async getSnapshot(pair: TradingPair): Promise<PriceSnapshot> {
    const [aero, uni] = await Promise.all([
      this.getAerodromeState(pair),
      this.getUniswapState(pair),
    ]);

    let spread = 0;
    if (aero && uni && aero.price > 0 && uni.price > 0) {
      const mid = (aero.price + uni.price) / 2;
      spread = Math.abs(aero.price - uni.price) / mid;
    }

    const snapshot: PriceSnapshot = {
      pair: pair.name,
      aerodrome: aero,
      uniswap: uni,
      spread,
      timestamp: Date.now(),
    };

    // Update rolling history
    this.recordPrice(pair.name, snapshot);

    return snapshot;
  }

  // ---- History management -------------------------------------------------

  private recordPrice(pairName: string, snap: PriceSnapshot): void {
    let hist = this.history.get(pairName);
    if (!hist) {
      hist = { prices: [], timestamps: [], volumes: [] };
      this.history.set(pairName, hist);
    }

    // Use the mid-price between venues, or whichever is available
    const aPrice = snap.aerodrome?.price ?? 0;
    const uPrice = snap.uniswap?.price ?? 0;
    const midPrice =
      aPrice > 0 && uPrice > 0
        ? (aPrice + uPrice) / 2
        : aPrice > 0
          ? aPrice
          : uPrice;

    if (midPrice > 0) {
      hist.prices.push(midPrice);
      hist.timestamps.push(snap.timestamp);
      // Volume proxy: sum of liquidity changes (simplified)
      hist.volumes.push(
        Number(snap.aerodrome?.liquidity ?? 0n) +
          Number(snap.uniswap?.liquidity ?? 0n),
      );

      // Trim to max
      if (hist.prices.length > MAX_HISTORY) {
        hist.prices.shift();
        hist.timestamps.shift();
        hist.volumes.shift();
      }
    }
  }

  getHistory(pairName: string): PriceHistory {
    return (
      this.history.get(pairName) ?? { prices: [], timestamps: [], volumes: [] }
    );
  }

  /** Detect whether a significant price move happened recently. */
  detectSignificantMove(
    pairName: string,
    thresholdPct: number = 1.0,
  ): { detected: boolean; changePct: number } {
    const hist = this.getHistory(pairName);
    if (hist.prices.length < 5) return { detected: false, changePct: 0 };

    const recent = hist.prices[hist.prices.length - 1];
    // Compare to price 5 snapshots ago
    const earlier = hist.prices[hist.prices.length - 5];
    const changePct = ((recent - earlier) / earlier) * 100;

    return {
      detected: Math.abs(changePct) >= thresholdPct,
      changePct,
    };
  }
}
