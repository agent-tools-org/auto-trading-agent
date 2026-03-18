# Autonomous Trading Agent on Base

**Liquidity Migration Regime Trader (LMRT)** — an autonomous trading agent that operates on Base L2, combining AI-driven regime detection with cross-venue execution across Aerodrome and Uniswap.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Trading Agent Loop                     │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  Price Feed  │───▶│   Regime     │───▶│    AI      │  │
│  │  (on-chain)  │    │  Detector    │    │  Reasoner  │  │
│  └─────────────┘    └──────────────┘    └─────┬──────┘  │
│        │                                       │         │
│        │              ┌──────────────┐         │         │
│        └─────────────▶│    Risk      │◀────────┘         │
│                       │   Manager    │                   │
│                       └──────┬───────┘                   │
│                              │                           │
│                       ┌──────▼───────┐                   │
│                       │    Swap      │                   │
│                       │  Executor    │                   │
│                       └──────┬───────┘                   │
│                              │                           │
│                       Base L2 (8453)                     │
│                  Aerodrome  ·  Uniswap                   │
└──────────────────────────────────────────────────────────┘
```

### Components

| Module | File | Purpose |
|--------|------|---------|
| **Price Feed** | `src/data/price-feed.ts` | Reads on-chain pool reserves/prices from Aerodrome (V2) and Uniswap (V3) via viem. Maintains rolling price history and detects significant moves. |
| **Regime Detector** | `src/strategy/regime-detector.ts` | Classifies market conditions into momentum, mean-reversion, or no-trade using volatility, trend strength, z-score, cross-venue spread, and volume patterns. |
| **AI Reasoner** | `src/agent/ai-reasoner.ts` | LLM-based (Claude) reasoning layer that evaluates trade proposals. Returns approve/reject with confidence, size multiplier, and structured explanation. Falls back to deterministic logic when no API key is set. |
| **Risk Manager** | `src/risk/risk-manager.ts` | Enforces max position size, drawdown limits, per-trade loss limits, cooldowns after consecutive losses, and dynamic position scaling. |
| **Swap Executor** | `src/execution/swap-executor.ts` | Executes trades on Base via Aerodrome Router V2 and Uniswap V3 SwapRouter02. Handles approvals, slippage calculation, and returns real TxIDs. |
| **Trading Agent** | `src/agent/trading-agent.ts` | Main orchestration loop: polls prices → detects regime → builds proposal → risk check → AI evaluation → execute → log. |
| **Config** | `src/config.ts` | Chain config, token addresses, DEX contracts, risk parameters, and environment variable loading. |

## Strategy: Liquidity Migration Regime Trader

The agent trades only when three independent layers agree:

1. **Signal Layer** — Detects whether a pair is in momentum continuation, mean-reversion after overshoot, or no-trade/toxic-flow regime using statistical features (volatility, trend strength, z-score, cross-venue spread).

2. **Execution Layer** — Compares expected edge vs. gas cost, DEX fees, price impact, and stale quote risk. Routes to the best venue (Aerodrome or Uniswap).

3. **Risk Layer** — AI agent approves, scales, or rejects trades based on drawdown, consecutive losses, volatility, and consistency of the thesis.

### What makes it novel

- **Cross-venue liquidity migration detection** between Aerodrome and Uniswap on Base
- **AI-gated regime classification** — the LLM acts as a risk gatekeeper with veto power, not just a UI wrapper
- **Dynamic position sizing** via AI confidence multipliers within strict bounds
- **Autonomous decision-making** with full reasoning traces logged

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
- `ANTHROPIC_API_KEY` — (Optional) For AI-powered trade reasoning

Optional overrides:
- `BASE_RPC_URL` — Custom RPC endpoint (default: `https://mainnet.base.org`)
- `MAX_POSITION_USD` — Max position size (default: 500)
- `MAX_DRAWDOWN_PCT` — Max drawdown % (default: 5)
- `POLL_INTERVAL_MS` — Polling interval (default: 15000)

### Build & Run

```bash
# Build
npm run build

# Run
npm start

# Or run directly in development
npm run dev
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

## Risk Controls

| Parameter | Default | Description |
|-----------|---------|-------------|
| Max Position | $500 | Maximum single position size |
| Max Drawdown | 5% | Circuit breaker on portfolio drawdown |
| Per-Trade Loss | $50 | Maximum acceptable loss per trade |
| Cooldown | 60s | Pause after 3 consecutive losses |
| Min Edge | 10 bps | Minimum expected edge to trade |
| Max Slippage | 50 bps | Maximum slippage tolerance |

## License

MIT
