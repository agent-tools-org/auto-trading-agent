# Autonomous Trading Agent on Base

## 1. Project Thesis

Build a **Base-native autonomous trading agent** that trades real capital on Base by combining:

1. **Flashblocks-aware execution** for sub-block state and fee-sensitive order placement.
2. **AI-driven regime selection** that chooses whether to run momentum, mean-reversion, or no-trade mode.
3. **Liquidity-migration detection** across Base DEX venues, with the initial focus on Aerodrome + Uniswap pools for the same token pairs.
4. **Closed-loop risk management** where the AI agent explains why it is taking or skipping trades, adjusts exposure, and records profit attribution.

The differentiator is not “an LLM calling a swap API.” The novelty is an **autonomous policy engine** that reasons over Base-specific microstructure and only routes capital when onchain state, liquidity shape, and execution costs line up.

## 2. Strategy Design

### Strategy Name

**Liquidity Migration Regime Trader (LMRT)**

### Core Idea

On Base, liquidity for the same pair can shift between venues and pool shapes. Price dislocations are often small, but they become tradable when combined with:

- pending-state awareness from Base Flashblocks
- pool inventory and fee-tier changes
- sudden liquidity additions/removals
- short-horizon flow imbalance
- explicit fee and slippage modeling

The agent trades only when three layers agree:

1. **Signal layer**
   Detect whether a pair is entering:
   - momentum continuation
   - mean-reversion after overshoot
   - no-trade / toxic-flow regime

2. **Execution layer**
   Compare expected edge vs:
   - Base gas cost
   - DEX fees
   - price impact
   - stale quote risk

3. **Risk layer**
   AI agent approves, scales down, or rejects the trade based on:
   - drawdown budget
   - correlation to current inventory
   - unusual volatility
   - whether the explanation is consistent with historical profitable setups

### Why This Counts as “Novel”

This goes beyond simple swaps because it is a **multi-agent decision system** with:

- Base-native Flashblocks reads instead of standard 2s block-only logic
- cross-venue liquidity migration detection instead of single-venue trend following
- AI-based regime classification and risk gating instead of fixed thresholds only
- autonomous position sizing, cooldowns, and stop-trading decisions
- a full profit attribution loop that lets the agent learn which setup families are worth repeating

### Initial Tradable Universe

Start with 3 highly liquid Base pairs:

- `WETH/USDC`
- `cbBTC/WETH`
- `AERO/WETH`

Rationale:

- enough activity to get real fills
- lower operational complexity than long-tail tokens
- easy to show real Base transaction IDs

### First Strategy Slice to Ship

Ship **single-position spot trading** first:

- trade spot only
- one open position per pair
- max gross exposure cap
- no leverage in v1

This is enough to satisfy the hackathon requirement for real profitable trading while avoiding liquidation and lending complexity.

### Entry Logic

For each watched pair every cycle:

1. Pull current pool states from Aerodrome + Uniswap.
2. Read Flashblocks-aware pending state on Base.
3. Compute short-horizon features:
   - spread between venues
   - liquidity delta over last N blocks
   - trade imbalance over last N minutes
   - realized volatility
   - expected slippage for target size
   - all-in execution cost
4. Ask the AI policy agent to classify the regime:
   - `momentum`
   - `mean_reversion`
   - `no_trade`
5. Convert classification into a deterministic action proposal.
6. Run deterministic safety checks.
7. Simulate transaction bundle.
8. Submit on Base only if expected net edge stays positive after simulation.

### Exit Logic

- take-profit at model-estimated fair value convergence
- hard stop-loss on adverse move
- time stop if thesis does not resolve within a short holding window
- forced flattening if gas/slippage conditions deteriorate or if AI confidence drops below threshold

## 3. Architecture Overview

### High-Level Components

1. **Market Data Ingestor**
   - watches Base pools, swaps, liquidity updates, and pending-state changes
   - normalizes all raw data into internal typed events

2. **Feature Builder**
   - turns event streams into feature vectors per pair
   - maintains rolling windows for volatility, flow imbalance, and venue divergence

3. **AI Policy Agent**
   - receives compact market snapshots
   - returns structured output:
     - regime
     - confidence
     - narrative explanation
     - risk flags
     - recommended size multiplier

4. **Deterministic Strategy Engine**
   - translates AI output into concrete orders
   - enforces hard rules for edge threshold, exposure, cooldown, and inventory caps

5. **Execution Engine**
   - simulates swaps
   - picks venue
   - signs and submits transactions on Base
   - records tx hash, gas, fill price, and realized PnL

6. **Portfolio and Risk Manager**
   - tracks balances, open positions, drawdown, per-pair caps, and circuit breakers

7. **Profit Attribution and Evaluation Worker**
   - scores each completed trade
   - groups trades by setup type
   - measures whether AI-added decisions improved or harmed returns

8. **Operator Dashboard**
   - open-source web UI showing:
     - live balances
     - open/closed trades
     - tx links
     - cumulative PnL
     - AI explanations

### Interaction Flow

1. Ingestor updates pair state.
2. Feature builder emits a `MarketSnapshot`.
3. AI policy agent labels the regime.
4. Strategy engine proposes an action.
5. Risk manager approves or rejects it.
6. Execution engine simulates and routes the trade.
7. Submitted trade lands on Base and returns a transaction hash.
8. Evaluation worker updates PnL and stores an explanation bundle for the demo.

## 4. Tech Stack

### Core Runtime

- **TypeScript**
- **Node.js 22**
- **pnpm**

Reason:

- fastest path for CDP AgentKit, Base tooling, dashboard, and open-source hackathon delivery

### Onchain / Wallet / RPC

- **Coinbase AgentKit** for agent wallet actions and Base-compatible autonomous operations
- **Viem** for typed EVM reads/writes
- **Alchemy on Base** for production RPC and indexed data
- **Base Flashblocks endpoints** for preconfirmed pending-state reads

### AI / Agent Framework

- **OpenAI Responses API** for structured policy decisions
- **LangGraph** for explicit agent workflow orchestration

### Backend / Storage

- **Fastify** API server
- **PostgreSQL**
- **Prisma**
- **Redis** for hot caches, locks, and rolling feature windows

### Frontend

- **Next.js**
- **Tailwind CSS**
- **Recharts** or **Tremor** for PnL and attribution charts

### Smart Contracts

Keep contracts minimal for v1:

- `TradeVault.sol`
  - custody strategy capital
  - restrict withdrawals
  - emit canonical trade/accounting events
- `ExecutionProxy.sol`
  - authorized swap executor
  - optional emergency pause

If time is short, reduce to only `TradeVault.sol` plus EOA-based execution.

## 5. File Structure

```text
autonomous-trading-agent-base/
  apps/
    executor/
      src/
        index.ts
        config/
          env.ts
          chains.ts
        features/
          market-data/
            index.ts
            types.ts
            pool-watchers.ts
            flashblocks-client.ts
            event-normalizer.ts
          strategy/
            index.ts
            types.ts
            signal-builder.ts
            ai-policy.ts
            deterministic-rules.ts
            order-planner.ts
          execution/
            index.ts
            quote-router.ts
            simulation.ts
            swap-submit.ts
            receipt-handler.ts
          portfolio/
            index.ts
            balances.ts
            positions.ts
            risk-limits.ts
            pnl.ts
          evaluation/
            index.ts
            trade-grader.ts
            attribution.ts
            profitability-report.ts
          agents/
            planner-agent.ts
            risk-agent.ts
            explanation-agent.ts
        lib/
          db.ts
          redis.ts
          logger.ts
          result.ts
        workers/
          scan-pairs.ts
          close-positions.ts
          daily-report.ts
        scripts/
          seed-pairs.ts
          run-paper-mode.ts
          run-live-mode.ts
    dashboard/
      app/
        page.tsx
        trades/page.tsx
        positions/page.tsx
        settings/page.tsx
      components/
        pnl-chart.tsx
        trade-table.tsx
        agent-rationale-card.tsx
        tx-link.tsx
  packages/
    contracts/
      src/
        TradeVault.sol
        ExecutionProxy.sol
      script/
        Deploy.s.sol
        Configure.s.sol
      test/
        TradeVault.t.sol
        ExecutionProxy.t.sol
    shared/
      src/
        domain/
          pair.ts
          trade.ts
          position.ts
          signal.ts
        constants/
          addresses.ts
          pairs.ts
          risk.ts
        schemas/
          ai-policy.ts
          market-snapshot.ts
  prisma/
    schema.prisma
    migrations/
  docs/
    strategy.md
    architecture.md
    deployment.md
    demo-runbook.md
  .env.example
  pnpm-workspace.yaml
  turbo.json
  package.json
  tsconfig.base.json
```

## 6. Specific Files to Create First

### Repo Bootstrap

- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `.env.example`

### Shared Types

- `packages/shared/src/domain/trade.ts`
- `packages/shared/src/domain/position.ts`
- `packages/shared/src/domain/signal.ts`
- `packages/shared/src/schemas/ai-policy.ts`
- `packages/shared/src/schemas/market-snapshot.ts`

### Strategy Path

- `apps/executor/src/features/market-data/types.ts`
- `apps/executor/src/features/market-data/flashblocks-client.ts`
- `apps/executor/src/features/market-data/pool-watchers.ts`
- `apps/executor/src/features/strategy/signal-builder.ts`
- `apps/executor/src/features/strategy/ai-policy.ts`
- `apps/executor/src/features/strategy/deterministic-rules.ts`
- `apps/executor/src/features/strategy/order-planner.ts`

### Execution Path

- `apps/executor/src/features/execution/quote-router.ts`
- `apps/executor/src/features/execution/simulation.ts`
- `apps/executor/src/features/execution/swap-submit.ts`
- `apps/executor/src/features/execution/receipt-handler.ts`

### Risk / Accounting

- `apps/executor/src/features/portfolio/positions.ts`
- `apps/executor/src/features/portfolio/risk-limits.ts`
- `apps/executor/src/features/portfolio/pnl.ts`
- `apps/executor/src/features/evaluation/attribution.ts`
- `apps/executor/src/features/evaluation/profitability-report.ts`

### Contracts

- `packages/contracts/src/TradeVault.sol`
- `packages/contracts/src/ExecutionProxy.sol`
- `packages/contracts/script/Deploy.s.sol`

### Demo Surface

- `apps/dashboard/app/page.tsx`
- `apps/dashboard/components/pnl-chart.tsx`
- `apps/dashboard/components/trade-table.tsx`
- `docs/demo-runbook.md`

## 7. Step-by-Step Build Order

### Phase 0: Scope Lock

Deliverable:

- 3-pair universe
- spot only
- single wallet
- one vault
- one open-source repo

Estimated effort: **0.5 day**

### Phase 1: Repo and Types

Build:

- monorepo skeleton
- shared domain types
- environment config
- database schema

Exit criteria:

- project boots locally
- typed entities compile

Estimated effort: **1 day**

### Phase 2: Market Data Pipeline

Build:

- Base RPC client
- Flashblocks client
- Aerodrome + Uniswap pool watchers
- normalized market event storage

Exit criteria:

- can produce rolling market snapshots for 3 pairs

Estimated effort: **2 days**

### Phase 3: Signal Engine

Build:

- feature extraction
- venue divergence metrics
- liquidity migration detector
- deterministic pre-AI edge scoring

Exit criteria:

- snapshots produce candidate setups with backtestable metadata

Estimated effort: **1.5 days**

### Phase 4: AI Policy Layer

Build:

- structured prompt
- JSON schema constrained output
- regime classifier
- explanation generator
- confidence + risk flags

Exit criteria:

- same market snapshot always yields parseable structured policy output

Estimated effort: **1 day**

### Phase 5: Risk and Order Planning

Build:

- exposure caps
- per-pair cooldown
- stop-loss / take-profit logic
- position sizing

Exit criteria:

- order planner can say buy/sell/skip with exact size and reason

Estimated effort: **1 day**

### Phase 6: Execution

Build:

- swap routing
- pre-trade simulation
- submission to Base
- tx receipt processing

Exit criteria:

- paper mode and live mode can both submit through one interface

Estimated effort: **2 days**

### Phase 7: Contracts

Build:

- vault
- execution authorization
- emergency pause

Exit criteria:

- strategy capital is isolated from operator wallet

Estimated effort: **1.5 days**

### Phase 8: Evaluation and Profitability Reporting

Build:

- realized PnL calculator
- mark-to-market snapshots
- per-trade attribution
- daily equity curve

Exit criteria:

- dashboard shows net PnL, win rate, fees, and tx links

Estimated effort: **1 day**

### Phase 9: Demo UI and Open-Source Packaging

Build:

- web dashboard
- docs
- environment template
- demo runbook

Exit criteria:

- external reviewer can inspect strategy, txs, and profitability

Estimated effort: **1 day**

### Phase 10: Live Trading Run

Build:

- fund vault with small real capital
- execute minimum 10-20 real Base trades
- export tx hashes and PnL report

Exit criteria:

- live Base activity is public and reproducible

Estimated effort: **2-4 days of monitored runtime**

## 8. On-Chain Artifacts to Produce

### Contracts

1. `TradeVault.sol`
2. `ExecutionProxy.sol` if using a separate executor contract

### Required Live Transactions on Base

1. vault deployment transaction
2. vault funding transaction
3. approval transactions for traded assets
4. 10-20 live swap transactions
5. optional rebalance / withdraw transaction

### Metadata to Publish

- deployed contract addresses
- wallet address used for trading
- transaction hashes for each trade
- Basescan links
- final balances and PnL snapshot timestamp

## 9. How to Demonstrate Profitability

### Minimum Proof Package

Show all of the following:

1. **Starting capital**
   - wallet/vault balances before live run

2. **Trade ledger**
   - timestamp
   - pair
   - side
   - size
   - venue
   - tx hash
   - gas spent
   - realized/unrealized PnL

3. **Equity curve**
   - initial capital vs current equity in USDC terms

4. **Net profitability**
   - gross PnL
   - gas + fees
   - net PnL

5. **AI contribution evidence**
   - policy decision output for each trade
   - examples where AI vetoed bad trades
   - comparison against deterministic baseline

### Stronger Demo

Add a simple A/B comparison:

- **Baseline bot**:
  deterministic liquidity-divergence strategy without AI regime filter

- **Agent bot**:
  same execution path, but with AI regime classification and risk gating

If the AI-gated version produces:

- higher net PnL
- lower drawdown
- fewer toxic trades

then the project has concrete evidence that AI added real value.

### Judge-Friendly Metric Set

- net return on capital
- max drawdown
- profit factor
- win rate
- median hold time
- gas as % of gross profit
- percentage of trades initiated in Flashblocks-aware mode

## 10. Meaningful AI Agent Contribution

The AI agent must do work that is non-cosmetic. Make it responsible for:

1. **Regime classification**
   - momentum vs mean-reversion vs no-trade

2. **Risk explanation**
   - articulate why a setup is or is not valid

3. **Dynamic sizing modifier**
   - return `0.0x` to `1.5x` multiplier under strict bounds

4. **Trade veto power**
   - reject trades when explanation and features conflict

5. **Post-trade self-review**
   - label whether the thesis was correct, late, or invalid

This is enough to show the system is not just using AI as a UI wrapper.

## 11. Estimated Effort by Component

| Component | Effort |
| --- | --- |
| Repo bootstrap and types | 1 day |
| Base market data and Flashblocks integration | 2 days |
| Aerodrome + Uniswap pool adapters | 1 day |
| Feature engineering and signal builder | 1.5 days |
| AI policy layer | 1 day |
| Risk manager and order planner | 1 day |
| Swap execution and simulation | 2 days |
| Vault / executor contracts | 1.5 days |
| PnL, attribution, and reporting | 1 day |
| Dashboard and demo assets | 1 day |
| Live monitored trading run | 2-4 days |
| Total | 14.5-16.5 days |

## 12. Recommended MVP Cut Line

If time compresses, cut aggressively to this MVP:

- one strategy only: liquidity migration + AI regime filter
- two venues only: Aerodrome + Uniswap
- three pairs only
- one vault contract only
- one executor service only
- one dashboard page only

Do **not** add:

- cross-chain trading
- perps
- leverage
- social sentiment ingestion
- autonomous code generation
- too many pairs

## 13. Final Build Recommendation

The best hackathon submission is:

- **TypeScript monorepo**
- **AgentKit + Viem + Alchemy on Base**
- **Base Flashblocks-aware execution**
- **minimal vault contract**
- **AI policy agent with structured output**
- **3-pair live strategy with 10-20 real Base trades**
- **public dashboard and open repo**

That is complex enough to look novel, narrow enough to finish, and concrete enough to prove profitability with real transaction IDs on Base.
