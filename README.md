# Autonomous Trading Agent on Base

**Liquidity Migration Regime Trader (LMRT)** — an autonomous trading agent that operates on Base L2, combining AI-driven regime detection with cross-venue execution across Aerodrome and Uniswap.

## Architecture

```
  Market Data          Regime             AI              Risk            Execution
  (on-chain)         Detection         Reasoning       Management
                                                                      
 ┌────────────┐    ┌────────────┐    ┌────────────┐   ┌────────────┐   ┌────────────┐
 │ Aerodrome  │───▶│  Volatility│───▶│   Claude    │──▶│  Drawdown  │──▶│   Route    │
 │ V2 pools   │    │  Trend     │    │   Approve/  │   │  Limits    │   │   to best  │
 │            │    │  Z-score   │    │   Reject    │   │            │   │   venue    │
 │ Uniswap   │    │  Spread    │    │   + size    │   │  Cooldown  │   │            │
 │ V3 pools   │    │  Volume    │    │   modifier  │   │  Per-trade │   │   Sign &   │
 │            │    │            │    │             │   │  loss cap  │   │   submit   │
 └────────────┘    └────────────┘    └────────────┘   └────────────┘   └────────────┘
       │                 │                 │                │                │
       └─────────────────┴─────────────────┴────────────────┴────────────────┘
                                    Base L2 (Chain 8453)
                               Aerodrome  ·  Uniswap V3
```

**Pipeline:** Market Data → Regime Detection → AI Reasoning → Risk Management → Execution

The agent autonomously trades on Base by reading on-chain pool states from Aerodrome and Uniswap, classifying market regimes (momentum / mean-reversion / no-trade), letting an AI layer approve or veto each trade with a confidence-scaled size multiplier, enforcing strict risk limits, and routing the swap to the best venue.

## How It Works

### 1. Market Data Ingestion

The price feed reads real-time pool states from both **Aerodrome V2** (AMM reserves) and **Uniswap V3** (concentrated liquidity sqrtPriceX96) on Base. It maintains a rolling window of mid-prices and detects significant moves.

### 2. Regime Detection

A statistical classifier labels each pair's market condition:

| Regime | Condition | Action |
|--------|-----------|--------|
| **Momentum** | Strong trend + moderate volatility | Trade in trend direction |
| **Mean-reversion** | Price far from mean (high z-score) + low trend | Trade back toward mean |
| **No-trade** | Insufficient data, toxic flow, or no clear signal | Skip — preserve capital |

Features used: realised volatility, linear trend strength, z-score, cross-venue spread, volume trend.

### 3. AI Reasoning (Claude)

An LLM-powered risk analyst evaluates every trade proposal. It returns structured JSON with:

- **Decision** — approve or reject
- **Confidence** — 0 to 1
- **Size multiplier** — 0.0× to 1.5× (scales position size)
- **Explanation** — 1–3 sentence rationale
- **Risk flags** — list of concerns (high volatility, drawdown, consecutive losses, etc.)

Falls back to a deterministic heuristic when no API key is configured.

### 4. Risk Management

Hard limits enforced on every trade:

| Control | Default | Description |
|---------|---------|-------------|
| **Max position** | $500 | Maximum single trade size |
| **Max drawdown** | 5% | Circuit breaker — stops all trading |
| **Per-trade loss** | $50 | Caps worst-case loss per trade |
| **Cooldown** | 60 s | Pause after 3 consecutive losses |
| **Min edge** | 10 bps | Won't trade unless expected edge exceeds cost |
| **Max slippage** | 50 bps | Rejects fills with excessive slippage |

Additional dynamic sizing: positions shrink as drawdown approaches the limit.

### 5. Execution

Trades are routed to the venue with the better price:
- **Aerodrome** — `swapExactTokensForTokens` via Router V2
- **Uniswap V3** — `exactInputSingle` via SwapRouter02

Approvals, slippage protection, and gas estimation are handled automatically. Every trade logs a full decision record (regime, AI explanation, tx hash, PnL) to `logs/trades.jsonl`.

## Components

| Module | File | Purpose |
|--------|------|---------|
| **Price Feed** | `src/data/price-feed.ts` | Reads on-chain pool reserves/prices from Aerodrome (V2) and Uniswap (V3) via viem. Maintains rolling price history. |
| **Regime Detector** | `src/strategy/regime-detector.ts` | Classifies market conditions into momentum, mean-reversion, or no-trade using statistical features. |
| **AI Reasoner** | `src/agent/ai-reasoner.ts` | LLM-based (Claude) reasoning layer. Approves/rejects trades with confidence and size multiplier. |
| **Risk Manager** | `src/risk/risk-manager.ts` | Enforces position limits, drawdown circuit breaker, cooldowns, and dynamic position scaling. |
| **Swap Executor** | `src/execution/swap-executor.ts` | Executes trades on Base via Aerodrome and Uniswap. Handles approvals, slippage, and returns real tx hashes. |
| **Trading Agent** | `src/agent/trading-agent.ts` | Main loop: poll → detect → propose → risk check → AI evaluate → execute → log. |
| **Config** | `src/config.ts` | Chain config, token addresses, DEX contracts, risk parameters, and environment variable loading. |

## Trading Pairs

- `WETH/USDC` — Aerodrome volatile pool + Uniswap V3 0.05% pool

## Setup

### Prerequisites

- Node.js ≥ 22
- A funded wallet on Base (with WETH, USDC, etc.)
- (Optional) Anthropic API key for AI reasoning

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env with your private key and optional API keys
```

Required environment variables:
- `PRIVATE_KEY` — Wallet private key (hex)

Optional:
- `ANTHROPIC_API_KEY` — For AI-powered trade reasoning (falls back to deterministic without it)
- `BASE_RPC_URL` — Custom RPC endpoint (default: `https://mainnet.base.org`)
- `MAX_POSITION_USD` — Max position size (default: 500)
- `MAX_DRAWDOWN_PCT` — Max drawdown % (default: 5)
- `PER_TRADE_LOSS_LIMIT_USD` — Per-trade loss limit (default: 50)
- `COOLDOWN_MS` — Cooldown after consecutive losses (default: 60000)
- `POLL_INTERVAL_MS` — Polling interval (default: 15000)

### Build & Run

```bash
# Build
npm run build

# Run the agent
npm start

# Or run directly in development
npm run dev
```

### Demo (read-only)

Run the demo to read real Base mainnet data without trading:

```bash
npm run demo
```

This connects to Base, reads live WETH/USDC prices from both Aerodrome and Uniswap, looks up the WETH/cbBTC pool, runs regime detection, and saves the results to `proof/demo.json`.

### Tests

```bash
npm test
```

### Graceful Shutdown

Press `Ctrl+C` to stop the agent. It will finish the current cycle and exit cleanly.

## Trade Logs

All decisions are logged to `logs/trades.jsonl` in JSONL format:

```json
{
  "timestamp": "2026-03-18T12:00:00.000Z",
  "pair": "WETH/USDC",
  "direction": "buy",
  "amountInUsd": 250,
  "venue": "uniswap",
  "reason": "Momentum long: trend=0.45, vol=35.2%, confidence=0.72",
  "txHash": "0x...",
  "pnl": null,
  "regime": "momentum",
  "aiDecision": "approve",
  "aiConfidence": 0.72,
  "aiExplanation": "Strong upward momentum with moderate volatility..."
}
```

## License

MIT
