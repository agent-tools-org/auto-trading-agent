import { type Address, type Hex, parseEther } from "viem";
import { base } from "viem/chains";

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export const CHAIN = base;
export const CHAIN_ID = 8453;
export const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export function getPrivateKey(): Hex {
  const raw = process.env.PRIVATE_KEY;
  if (!raw) throw new Error("PRIVATE_KEY env var is required");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

// ---------------------------------------------------------------------------
// Token addresses on Base
// ---------------------------------------------------------------------------

export const TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006" as Address,
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" as Address,
} as const;

export const TOKEN_DECIMALS: Record<Address, number> = {
  [TOKENS.WETH]: 18,
  [TOKENS.USDC]: 6,
  [TOKENS.cbBTC]: 8,
  [TOKENS.AERO]: 18,
};

// ---------------------------------------------------------------------------
// Trading pairs
// ---------------------------------------------------------------------------

export interface TradingPair {
  name: string;
  base: Address;
  quote: Address;
  /** Aerodrome pool (volatile V2 pool) */
  aerodromePool: Address;
  /** Uniswap V3 pool */
  uniswapPool: Address;
  /** Uniswap V3 fee tier (bps × 100, e.g. 500 = 0.05%) */
  uniswapFeeTier: number;
}

export const TRADING_PAIRS: TradingPair[] = [
  {
    name: "WETH/USDC",
    base: TOKENS.WETH,
    quote: TOKENS.USDC,
    // Aerodrome volatile WETH/USDC pool
    aerodromePool: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59" as Address,
    // Uniswap V3 WETH/USDC 0.05% pool on Base
    uniswapPool: "0xd0b53D9277642d899DF5C87A3966A349A798F224" as Address,
    uniswapFeeTier: 500,
  },
];

// ---------------------------------------------------------------------------
// DEX routers / contracts on Base
// ---------------------------------------------------------------------------

export const DEX = {
  /** Aerodrome Router V2 */
  AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" as Address,
  /** Uniswap V3 SwapRouter02 on Base */
  UNISWAP_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481" as Address,
} as const;

// ---------------------------------------------------------------------------
// Risk parameters
// ---------------------------------------------------------------------------

export interface RiskParams {
  /** Maximum position size in USD */
  maxPositionUsd: number;
  /** Max portfolio drawdown percentage (0-100) */
  maxDrawdownPct: number;
  /** Per-trade loss limit in USD */
  perTradeLossLimitUsd: number;
  /** Cooldown period after consecutive losses (ms) */
  cooldownMs: number;
  /** Max consecutive losses before cooldown */
  maxConsecutiveLosses: number;
  /** Minimum expected edge (bps) to execute a trade */
  minEdgeBps: number;
  /** Maximum slippage tolerance (bps) */
  maxSlippageBps: number;
}

export const RISK_PARAMS: RiskParams = {
  maxPositionUsd: Number(process.env.MAX_POSITION_USD ?? 500),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? 5),
  perTradeLossLimitUsd: Number(process.env.PER_TRADE_LOSS_LIMIT_USD ?? 50),
  cooldownMs: Number(process.env.COOLDOWN_MS ?? 60_000),
  maxConsecutiveLosses: 3,
  minEdgeBps: 10,
  maxSlippageBps: 50,
};

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);

export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export const TRADE_LOG_PATH = "logs/trades.jsonl";
