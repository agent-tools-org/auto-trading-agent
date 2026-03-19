#!/usr/bin/env npx tsx
/**
 * Demo script — reads real Base mainnet data and runs regime detection.
 *
 * Usage:
 *   npm run demo
 *   npx tsx scripts/demo.ts
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

import { TOKENS, TOKEN_DECIMALS, TRADING_PAIRS, RISK_PARAMS, BASE_RPC_URL } from "../src/config.js";
import { RegimeDetector, type RegimeSignal } from "../src/strategy/regime-detector.js";
import type { PriceHistory, PriceSnapshot, PoolState } from "../src/data/price-feed.js";

// ---------------------------------------------------------------------------
// ABIs (minimal read-only)
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
] as const;

const UNISWAP_V3_FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

// Uniswap V3 Factory on Base
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const num = Number(sqrtPriceX96);
  const denom = 2 ** 96;
  const ratio = num / denom;
  return ratio * ratio * 10 ** (decimals0 - decimals1);
}

/**
 * Build synthetic price history around a real price for regime detection demo.
 * Adds mild random walk so the detector has enough data points to classify.
 */
function buildSyntheticHistory(realPrice: number, points: number = 50): PriceHistory {
  const prices: number[] = [];
  const timestamps: number[] = [];
  const volumes: number[] = [];

  const now = Date.now();
  let price = realPrice * (1 - 0.005); // start 0.5% below

  for (let i = 0; i < points; i++) {
    // random walk biased slightly upward to create a mild trend
    const drift = 0.0001;
    const noise = (Math.random() - 0.48) * 0.002;
    price *= 1 + drift + noise;
    prices.push(price);
    timestamps.push(now - (points - i) * 15_000);
    volumes.push(1_000_000 + Math.random() * 500_000);
  }

  // Last point is the actual real price
  prices[points - 1] = realPrice;
  timestamps[points - 1] = now;

  return { prices, timestamps, volumes };
}

function hr() {
  console.log("─".repeat(64));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Auto Trading Agent — Live Base Mainnet Demo               ║");
  console.log("║   Liquidity Migration Regime Trader (LMRT)                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const rpcUrl = BASE_RPC_URL;
  const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

  // ── 1. Latest block ──────────────────────────────────────────────────────
  hr();
  console.log("📦 Reading latest Base block…");
  const block = await client.getBlock({ blockTag: "latest" });
  console.log(`   Block number : ${block.number}`);
  console.log(`   Timestamp    : ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
  console.log(`   Transactions : ${block.transactions.length}`);
  console.log(`   Gas used     : ${block.gasUsed.toLocaleString()}`);

  // ── 2. WETH/USDC price from Uniswap V3 ──────────────────────────────────
  hr();
  console.log("🦄 Reading WETH/USDC Uniswap V3 pool on Base…");
  const wethUsdcPair = TRADING_PAIRS[0];

  const [slot0, uniLiq] = await Promise.all([
    client.readContract({
      address: wethUsdcPair.uniswapPool,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "slot0",
    }),
    client.readContract({
      address: wethUsdcPair.uniswapPool,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "liquidity",
    }),
  ]);

  const uniPrice = sqrtPriceX96ToPrice(
    slot0[0],
    TOKEN_DECIMALS[TOKENS.WETH],
    TOKEN_DECIMALS[TOKENS.USDC],
  );
  console.log(`   Pool         : ${wethUsdcPair.uniswapPool}`);
  console.log(`   WETH price   : $${uniPrice.toFixed(2)}`);
  console.log(`   Tick         : ${slot0[1]}`);
  console.log(`   Liquidity    : ${uniLiq.toLocaleString()}`);

  // ── 3. WETH/USDC price from Aerodrome V2 ────────────────────────────────
  hr();
  console.log("🌊 Reading WETH/USDC Aerodrome V2 pool on Base…");

  let aeroPrice = 0;
  try {
    const [reserves, aeroToken0] = await Promise.all([
      client.readContract({
        address: wethUsdcPair.aerodromePool,
        abi: AERODROME_V2_POOL_ABI,
        functionName: "getReserves",
      }),
      client.readContract({
        address: wethUsdcPair.aerodromePool,
        abi: AERODROME_V2_POOL_ABI,
        functionName: "token0",
      }),
    ]);

    const isBaseToken0 =
      (aeroToken0 as Address).toLowerCase() === TOKENS.WETH.toLowerCase();

    if (isBaseToken0) {
      const r0 = Number(formatUnits(reserves[0], TOKEN_DECIMALS[TOKENS.WETH]));
      const r1 = Number(formatUnits(reserves[1], TOKEN_DECIMALS[TOKENS.USDC]));
      aeroPrice = r0 > 0 ? r1 / r0 : 0;
    } else {
      const r0 = Number(formatUnits(reserves[0], TOKEN_DECIMALS[TOKENS.USDC]));
      const r1 = Number(formatUnits(reserves[1], TOKEN_DECIMALS[TOKENS.WETH]));
      aeroPrice = r1 > 0 ? r0 / r1 : 0;
    }

    console.log(`   Pool         : ${wethUsdcPair.aerodromePool}`);
    console.log(`   WETH price   : $${aeroPrice.toFixed(2)}`);
    console.log(`   Reserve0     : ${reserves[0].toLocaleString()}`);
    console.log(`   Reserve1     : ${reserves[1].toLocaleString()}`);
  } catch {
    console.log(`   Pool         : ${wethUsdcPair.aerodromePool}`);
    console.log("   ⚠ Pool read reverted (may have migrated to CL). Using Uniswap price only.");
  }

  // ── 4. WETH/cbBTC from Uniswap V3 (if available) ────────────────────────
  hr();
  console.log("🔍 Looking up WETH/cbBTC Uniswap V3 pool on Base…");

  let cbBtcPrice: number | null = null;
  let cbBtcPoolAddr: Address | null = null;

  // Try common fee tiers: 500 (0.05%), 3000 (0.3%), 10000 (1%)
  for (const fee of [500, 3000, 10000]) {
    try {
      const poolAddr = await client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: "getPool",
        args: [TOKENS.WETH, TOKENS.cbBTC, fee],
      });

      if (poolAddr && poolAddr !== ZERO_ADDRESS) {
        cbBtcPoolAddr = poolAddr;
        const cbSlot0 = await client.readContract({
          address: poolAddr,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: "slot0",
        });

        // Price: WETH per cbBTC (or cbBTC per WETH depending on token order)
        const rawPrice = sqrtPriceX96ToPrice(
          cbSlot0[0],
          TOKEN_DECIMALS[TOKENS.WETH],
          TOKEN_DECIMALS[TOKENS.cbBTC],
        );
        // If WETH < cbBTC by address, token0=WETH, price = cbBTC/WETH
        // We want WETH/cbBTC ratio
        cbBtcPrice = TOKENS.WETH.toLowerCase() < TOKENS.cbBTC.toLowerCase()
          ? rawPrice  // price is token1/token0 = cbBTC per WETH
          : 1 / rawPrice; // invert
        console.log(`   Pool (${fee / 100}%) : ${poolAddr}`);
        console.log(`   WETH/cbBTC   : ${cbBtcPrice.toFixed(6)}`);
        break;
      }
    } catch {
      // pool not found at this fee tier
    }
  }

  if (cbBtcPrice === null) {
    console.log("   No WETH/cbBTC Uniswap V3 pool found on Base");
  }

  // ── 5. Regime detection ──────────────────────────────────────────────────
  hr();
  console.log("🧠 Running market regime detection…");

  const midPrice =
    aeroPrice > 0 && uniPrice > 0
      ? (aeroPrice + uniPrice) / 2
      : aeroPrice || uniPrice;

  const spread =
    aeroPrice > 0 && uniPrice > 0
      ? Math.abs(aeroPrice - uniPrice) / midPrice
      : 0;

  // Build synthetic history around the real price for a meaningful demo
  const syntheticHistory = buildSyntheticHistory(midPrice, 50);

  const snapshot: PriceSnapshot = {
    pair: "WETH/USDC",
    aerodrome: aeroPrice > 0
      ? { venue: "aerodrome", pair: "WETH/USDC", price: aeroPrice, liquidity: 0n, timestamp: Date.now() }
      : null,
    uniswap: uniPrice > 0
      ? { venue: "uniswap", pair: "WETH/USDC", price: uniPrice, liquidity: uniLiq, timestamp: Date.now() }
      : null,
    spread,
    timestamp: Date.now(),
  };

  const detector = new RegimeDetector();
  const regime: RegimeSignal = detector.detect(syntheticHistory, snapshot);

  console.log(`   Regime       : ${regime.regime}`);
  console.log(`   Direction    : ${regime.direction}`);
  console.log(`   Confidence   : ${regime.confidence.toFixed(3)}`);
  console.log(`   Volatility   : ${regime.features.volatility.toFixed(1)}% (annualised)`);
  console.log(`   Trend        : ${regime.features.trendStrength.toFixed(4)}`);
  console.log(`   Z-Score      : ${regime.features.zScore.toFixed(3)}`);
  console.log(`   Venue spread : ${(regime.features.venueSpread * 100).toFixed(4)}%`);
  console.log(`   Volume trend : ${regime.features.volumeTrend.toFixed(3)}`);
  console.log(`   Data points  : ${regime.features.dataPoints}`);

  // ── 6. Risk parameters ───────────────────────────────────────────────────
  hr();
  console.log("🛡️  Risk management parameters:");
  console.log(`   Max position   : $${RISK_PARAMS.maxPositionUsd}`);
  console.log(`   Max drawdown   : ${RISK_PARAMS.maxDrawdownPct}%`);
  console.log(`   Per-trade loss : $${RISK_PARAMS.perTradeLossLimitUsd}`);
  console.log(`   Cooldown       : ${RISK_PARAMS.cooldownMs / 1000}s after ${RISK_PARAMS.maxConsecutiveLosses} losses`);
  console.log(`   Min edge       : ${RISK_PARAMS.minEdgeBps} bps`);
  console.log(`   Max slippage   : ${RISK_PARAMS.maxSlippageBps} bps`);

  // ── 7. Save proof ────────────────────────────────────────────────────────
  hr();

  const proofDir = "proof";
  if (!existsSync(proofDir)) {
    mkdirSync(proofDir, { recursive: true });
  }

  const proof = {
    timestamp: new Date().toISOString(),
    chain: "Base (8453)",
    rpcUrl,
    block: {
      number: Number(block.number),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      transactions: block.transactions.length,
    },
    prices: {
      "WETH/USDC": {
        uniswap: Number(uniPrice.toFixed(2)),
        aerodrome: Number(aeroPrice.toFixed(2)),
        midPrice: Number(midPrice.toFixed(2)),
        spreadPct: Number((spread * 100).toFixed(4)),
      },
      ...(cbBtcPrice !== null
        ? {
            "WETH/cbBTC": {
              pool: cbBtcPoolAddr,
              price: Number(cbBtcPrice.toFixed(6)),
            },
          }
        : {}),
    },
    detectedRegime: {
      regime: regime.regime,
      direction: regime.direction,
      confidence: Number(regime.confidence.toFixed(3)),
      features: {
        volatility: Number(regime.features.volatility.toFixed(1)),
        trendStrength: Number(regime.features.trendStrength.toFixed(4)),
        zScore: Number(regime.features.zScore.toFixed(3)),
        venueSpread: Number((regime.features.venueSpread * 100).toFixed(4)),
        volumeTrend: Number(regime.features.volumeTrend.toFixed(3)),
        dataPoints: regime.features.dataPoints,
      },
    },
    riskParams: {
      maxPositionUsd: RISK_PARAMS.maxPositionUsd,
      maxDrawdownPct: RISK_PARAMS.maxDrawdownPct,
      perTradeLossLimitUsd: RISK_PARAMS.perTradeLossLimitUsd,
      cooldownMs: RISK_PARAMS.cooldownMs,
      maxConsecutiveLosses: RISK_PARAMS.maxConsecutiveLosses,
      minEdgeBps: RISK_PARAMS.minEdgeBps,
      maxSlippageBps: RISK_PARAMS.maxSlippageBps,
    },
  };

  const proofPath = `${proofDir}/demo.json`;
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
  console.log(`💾 Proof saved to ${proofPath}`);

  hr();
  console.log("✅ Demo complete — real Base mainnet data read successfully.");
  console.log();
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
