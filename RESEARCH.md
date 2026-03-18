# Autonomous Trading Agent on Base — Comprehensive Research Report

**Date:** 2026-03-18  
**Purpose:** Hackathon research for building an autonomous trading agent on Base chain

---

## Table of Contents

1. [Existing Open Source Trading Bots on Base](#1-existing-open-source-trading-bots-on-base)
2. [Base Flashblocks](#2-base-flashblocks)
3. [Novel DeFi Trading Strategies (2025–2026)](#3-novel-defi-trading-strategies-20252026)
4. [AI-Driven Trading Agents](#4-ai-driven-trading-agents)
5. [Base-Specific Tooling](#5-base-specific-tooling)
6. [Key Takeaways & Recommended Architecture](#6-key-takeaways--recommended-architecture)

---

## 1. Existing Open Source Trading Bots on Base

### 1.1 Chainstack Web3 AI Trading Agent (★ Top Pick — Base-native)

- **Repo:** [chainstacklabs/web3-ai-trading-agent](https://github.com/chainstacklabs/web3-ai-trading-agent) (58 stars, Apache-2.0)
- **Architecture:** Full-stack local-first agent operating on **Base + Uniswap V4** ETH-USDC pair
- **Tech Stack:**
  - **Language:** Python (web3.py, eth-abi, eth-account)
  - **AI/ML:** Ollama (local LLM inference), Apple MLX-LM for LoRA fine-tuning, PyTorch (GANs), Gymnasium (RL)
  - **Blockchain:** Base L2, Uniswap V4 singleton contracts, Foundry for local fork testing
  - **RPC:** Chainstack enterprise-grade Base endpoints
  - **Models:** Fin-R1 (financial domain-specific), Qwen 2.5 3B (student model), QwQ 32B teacher via OpenRouter, Grok-4/Kimi-K2 options
- **Pipeline (10 stages):**
  1. Manual MetaMask swaps → 2. Bot script automation → 3. Stateless AI agent → 4. Stateful agent with memory → 5. On-chain data collection → 6. GAN synthetic data generation → 7. Teacher-student distillation (Chain of Draft prompting) → 8. LoRA fine-tuning → 9. Reinforcement learning (DQN) → 10. Final autonomous trading agent
- **What worked:** Comprehensive local-first approach, custom model fine-tuning pipeline, Uniswap V4 integration
- **What didn't:** Marked "NOT FOR PRODUCTION" — educational focus, no live MEV protection, single trading pair only

### 1.2 TradingAgents (TauricResearch)

- **Repo:** [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) (32.6k stars, v0.2.1)
- **Architecture:** Multi-agent LLM framework mirroring real trading firms
- **Tech Stack:** Python, LangGraph, multi-provider LLM support (GPT-5.x, Gemini 3.x, Claude 4.x, Grok 4.x, Ollama)
- **Agent Roles:**
  - **Analyst Team:** Fundamentals, Sentiment, News, Technical analysts
  - **Researcher Team:** Bullish vs bearish structured debates
  - **Trader Agent:** Synthesizes reports into trade decisions
  - **Risk Management + Portfolio Manager:** Evaluates, approves/rejects trades
- **What worked:** Sophisticated multi-agent debate structure, multi-LLM provider support, active community (32k+ stars)
- **What didn't:** Primarily equities-focused (uses Alpha Vantage, yfinance), not natively DeFi/on-chain; needs adaptation for on-chain execution

### 1.3 Fulcrum — Low-Latency L2 Arbitrage Bot

- **Repo:** [jordy25519/fulcrum](https://github.com/jordy25519/fulcrum)
- **Architecture:** Low-latency arbitrage bot for **Arbitrum L2** (adaptable to Base)
- **Tech Stack:** Rust, direct EVM interaction
- **Strategy:** DEX-to-DEX arbitrage with sub-millisecond execution
- **What worked:** Rust-based for maximum speed, designed for L2 block times
- **What didn't:** Arbitrum-specific (would need adaptation for Base), no AI component

### 1.4 Freqtrade / Hummingbot / OctoBot (General-Purpose)

| Project | Stars | Language | Key Feature |
|---------|-------|----------|-------------|
| [freqtrade/freqtrade](https://github.com/freqtrade/freqtrade) | 35k+ | Python | Backtesting, ML optimization, Telegram/web UI |
| [hummingbot/hummingbot](https://github.com/hummingbot/hummingbot) | 8k+ | Python | Market-making, cross-exchange, DEX connectors |
| [Drakkar-Software/OctoBot](https://github.com/Drakkar-Software/OctoBot) | 3k+ | Python | AI + ML real-time analysis, 15+ exchange support |

- **What worked:** Mature ecosystems, extensive backtesting, strategy libraries
- **What didn't:** Primarily CEX-focused, limited native Base/L2 DEX support; need custom connector development for Uniswap V4 on Base

### 1.5 DeFi Arbitrage Bot

- **Repo:** [mcgraneder/Defi-Trading-Arbitrage-Bot](https://github.com/mcgraneder/Defi-Trading-Arbitrage-Bot)
- **Architecture:** Flash loan-based arbitrage between AMMs (Uniswap V2, SushiSwap, etc.)
- **Tech Stack:** Node.js, Truffle, Solidity
- **What worked:** Flash loan integration, multi-AMM routing
- **What didn't:** V2-era design, no V4 support, no AI component

---

## 2. Base Flashblocks

### 2.1 What Are Flashblocks?

Flashblocks are **200-millisecond sub-blocks** streamed during Base's 2-second block interval, providing **10x faster preconfirmations**. Launched on Base mainnet on July 16, 2025, they were built in collaboration with Flashbots.

**Key specs:**
- 10 Flashblocks per regular 2-second block
- Each flashblock_i can use up to `i/10` of total block gas
- Transactions are ordered by fee within each 200ms window
- Preconfirmation state is available via standard RPC methods

**Sources:**
- [Flashblocks Deep Dive (Base Engineering Blog)](https://blog.base.dev/flashblocks-deep-dive) — Sept 2025
- [Base Flashblocks Documentation](https://docs.base.org/base-chain/flashblocks/apps)
- [Flashblocks FAQ](https://docs.base.org/base-chain/flashblocks/docs)

### 2.2 Architecture Components

The Flashblocks system adds several components to the Base sequencer:

| Component | Role | Repo |
|-----------|------|------|
| **Rollup-boost** | CL↔EL Engine API proxy; intercepts calls without modifying CL | [flashbots/rollup-boost](https://github.com/flashbots/rollup-boost) |
| **Op-rbuilder** | Out-of-protocol builder running at 200ms cadence | [flashbots/op-rbuilder](https://github.com/flashbots/op-rbuilder) |
| **WebSocket Proxy** | Fan-out layer for streaming Flashblocks to consumers | [flashbots/rollup-boost/crates/websocket-proxy](https://github.com/flashbots/rollup-boost/tree/main/crates/websocket-proxy) |
| **Node-reth** | RPC surface exposing preconfirmation state | [base/node-reth](https://github.com/base/node-reth) |

### 2.3 How Flashblocks Work (Block Building Pseudocode)

```
FOR j FROM 0 TO 10:
    NEXT_TIME = NOW() + 150ms
    gas_limit = (j / 10) * total_block_gas_limit
    sorted_txs = SORT_BY_FEE_DESC(pending_transactions)
    selected = TOP_TXS_WITHIN_GAS_LIMIT(sorted_txs, gas_limit, used)
    executed, gas_used = EXECUTE_TX(selected)
    flashblock = BUILD_BLOCK(flashblock, executed)
    WAIT_UNTIL(NEXT_TIME)
```

Full implementation: [op-rbuilder flashblocks payload](https://github.com/flashbots/op-rbuilder/blob/main/crates/op-rbuilder/src/builders/flashblocks/payload.rs#L197)

### 2.4 APIs Available

- **Standard RPCs with preconfirmation state:** `eth_getTransactionReceipt`, `eth_getBlockByNumber` (with `"latest"` returning flashblock state)
- **WebSocket streaming:** Connect to Flashblocks WebSocket for real-time sub-block data
- **Upcoming:** `eth_call` and `eth_estimateGas` against preconfirmation state (in development)
- **Data stream format:** [Flashblocks primitives definition](https://github.com/flashbots/rollup-boost/blob/main/crates/rollup-boost/src/flashblocks/primitives.rs#L63)

### 2.5 RPC Providers Supporting Flashblocks

| Provider | Flashblocks Support | URL |
|----------|-------------------|-----|
| QuickNode | ✅ Full support | [quicknode.com/docs/base/flashblocks](https://www.quicknode.com/docs/base/flashblocks/overview) |
| Chainstack | ✅ Full support | [chainstack.com/flashblocks-base-rpc](https://chainstack.com/flashblocks-base-rpc/) |
| GetBlock | ✅ Listener guide | [docs.getblock.io/guides/flashblocks-listener](https://docs.getblock.io/guides/how-to-build-a-base-flashblocks-listener) |

### 2.6 Open Source Projects Using Flashblocks

- **alloy-flashblocks:** [SkandaBhat/alloy-flashblocks](https://github.com/SkandaBhat/alloy-flashblocks) — Rust library to stream Base L2 flashblocks and query preconfirmation state using Alloy
- **bloXroute Base integration:** [bloXroute for Base](https://bloxroute.com/pulse/trade-faster-on-base-with-bloxroute/) — Low-latency trading infrastructure leveraging Flashblocks

### 2.7 Implications for Trading

Flashblocks are a **game-changer for trading bots on Base**:
- **200ms preconfirmations** mean near-instant execution feedback
- **Fee-ordered transactions within flashblocks** create more predictable execution
- **Streaming sub-blocks** enable reactive strategies that can adapt within a single block interval
- **For arbitrage:** React to price changes 10x faster than before
- **For market making:** Tighter spreads possible with faster state updates
- **Caveat:** WebSocket dependency recommended over polling for latency-sensitive strategies

---

## 3. Novel DeFi Trading Strategies (2025–2026)

### 3.1 MEV Landscape in 2026

By 2026, the MEV ecosystem has evolved into a **highly competitive automated trading industry**. Key developments:

- **Leading MEV infrastructure:** Flashbots (MEV-Boost, relays, block-building frameworks) remains dominant
- **Telegram-based trading bots** (MevX, Maestro, Trojan, BONKBot, Banana Gun) have collectively processed $16B+ in volume
- **Anti-MEV protection** has become a standard feature (private mempools, encrypted transactions, batch auctions)
- **Cross-chain MEV** is growing — arbitrage between L1 and L2s, between different L2s

**Source:** [Leading MEV Bots Dominating DeFi Trading in 2026 (Metaverse Post)](https://mpost.io/leading-mev-bots-dominating-defi-trading-in-2026/)

### 3.2 L2-Specific Arbitrage Strategies

On L2s like Base, unique opportunities exist:

1. **Cross-L2 Arbitrage:** Price discrepancies between Base ↔ Arbitrum ↔ Optimism DEXs
2. **L1→L2 Arbitrage:** CEX ↔ Base DEX price gaps (requires bridge latency management)
3. **Intra-L2 DEX Arbitrage:** Aerodrome vs Uniswap on Base (same chain, different AMM designs)
4. **Flashblock-aware strategies:** React to partial blocks within 200ms windows
5. **Sequencer-aware strategies:** L2 sequencers have different ordering rules than L1

**Source:** [Layer-2 Arbitrage Guide (coincryptorank)](https://coincryptorank.com/blog/l2-arbitrage)

### 3.3 Aerodrome Finance — Base's Leading DEX

Aerodrome is the **#1 DEX on Base by fees and TVL**, surpassing Uniswap on the chain. It's critical to understand for any Base trading agent.

**How Aerodrome Differs from Uniswap:**

| Feature | Aerodrome | Uniswap V4 |
|---------|-----------|-------------|
| **AMM Model** | MetaDEX: combines Curve (stable swaps) + Convex (incentives) + Uniswap (concentrated liquidity) | Singleton architecture, hooks system |
| **Governance** | **ve(3,3) model** — lock AERO tokens as veAERO NFTs, vote on emission distribution | UNI governance token, fee switch proposals |
| **Liquidity Incentives** | Voters direct AERO emissions to pools; receive trading fees + bribes from protocols | Protocol fees, no emission incentives |
| **Pool Types** | Stable pools (Curve-style), Volatile pools (Uniswap V2-style), Concentrated liquidity (Slipstream) | Concentrated liquidity with custom hooks |
| **Fee Model** | Competitive fees, protocols bribe voters to attract liquidity | 0.3% default, configurable per pool |
| **Key Advantage** | Flywheel: protocols bribe → voters direct emissions → LPs earn more → deeper liquidity → more volume | Composability via hooks, flash accounting |

**Why it matters for a trading agent:**
- Aerodrome's **Slipstream** (concentrated liquidity) pools often have different pricing than Uniswap V4 for the same pairs — **arbitrage opportunity**
- Aerodrome's **ve(3,3) emissions** create predictable liquidity shifts each epoch — **alpha signal**
- **Bribe economy** creates information asymmetry — monitoring bribe data can predict where liquidity will flow

**Sources:**
- [Aerodrome Finance](https://aerodrome.finance/)
- [CoinGecko Guide to Aerodrome](https://www.coingecko.com/learn/what-is-aerodrome-finance-aero-base)
- [Metalamp: Aerodrome Protocol Analysis](https://metalamp.io/magazine/article/aerodrome-protocol-how-a-metadex-on-base)
- [DeFi Showdown: Uniswap vs Aerodrome on Base](https://www.dadsdefispace.org/post/defi-showdown-uniswap-vs-aerodrome-on-base)

### 3.4 DeFAI: AI + DeFi Convergence

**DeFAI** is the emerging category where AI agents autonomously interact with DeFi protocols:

- **Intent-based execution:** AI agents express "intents" (desired outcomes) and solver networks find optimal execution paths
- **Autonomous yield optimization:** Agents monitor rates across protocols and rebalance
- **MEV protection via AI:** Agents detect and avoid sandwich attacks by analyzing mempool patterns
- **Portfolio rebalancing:** AI-driven risk-adjusted portfolio management on-chain

**Source:** [CoW Protocol: How AI Agents Can Be Used in DeFi](https://cow.fi/learn/how-ai-agents-can-be-used-in-defi)

### 3.5 Novel Strategy Ideas for a Hackathon

1. **Flashblock Arbitrage:** Monitor Aerodrome vs Uniswap V4 prices via Flashblocks stream; execute atomic arb within 200ms
2. **AI Market Making:** Use LLM to interpret market conditions + RL for optimal bid-ask spread on concentrated liquidity positions
3. **Emission-Aware Trading:** Predict liquidity shifts based on Aerodrome veAERO voting patterns
4. **Cross-DEX Smart Router:** AI-optimized routing across Aerodrome + Uniswap V4 for best execution
5. **Sentiment-Driven Momentum:** LLM analyzes social sentiment → RL decides position sizing on Base DEXs

---

## 4. AI-Driven Trading Agents

### 4.1 Key Frameworks

#### ElizaOS (formerly ai16z/eliza)

- **Repo:** [elizaOS/eliza](https://github.com/elizaOS/eliza)
- **Docs:** [docs.elizaos.ai](https://docs.elizaos.ai)
- **What it is:** The most popular open-source framework for autonomous AI agents, originally from the ai16z community
- **Architecture:**
  - TypeScript-based
  - Plugin system for extensibility (Solana, EVM, etc.)
  - Character files define agent personality and capabilities
  - Supports multiple LLM backends
  - Built-in memory and conversation management
- **DeFi capabilities:** Token transfers, swaps via plugins, wallet management
- **Integrations:** Gelato (gasless transactions), Ankr (blockchain awareness), MetaMask (swap/transfer), QuickNode (Web3 RPC)
- **Strengths:** Large community, modular plugin architecture, multi-chain support
- **Limitations:** More focused on social agents than high-frequency trading; latency not optimized for MEV

**Sources:**
- [ElizaOS Docs](https://docs.elizaos.ai)
- [How to Create Crypto AI Agents With ElizaOS & Gelato](https://gelato.cloud/blog/how-to-create-crypto-ai-agents-with-eliza-os-and-gelato)
- [QuickNode: Build Web3-Enabled AI Agents with Eliza](https://www.quicknode.com/guides/ai/how-to-setup-an-ai-agent-with-eliza-ai16z)

#### Olas (Autonolas) Autonomous Agents

- **Website:** [olas.network](https://olas.network/)
- **GitHub:** [valory-xyz](https://github.com/valory-xyz)
- **What it is:** Protocol for autonomous agent-based services in decentralized environments
- **Architecture:**
  - Multi-operator consensus for agent reliability
  - On-chain registration and staking (OLAS token)
  - Agent services run as decentralized services with multiple operators
- **Notable Agents:**
  - **Modius:** Autonomous DeFi agent
  - **Optimus:** AI-powered trading agent
  - **Mech:** Decentralized AI tool agent
  - **Governatooor:** DAO governance agent
- **Strengths:** Decentralized agent execution, economic incentives via staking
- **Limitations:** Complex setup, focused on long-running services rather than hackathon prototypes

#### TradingAgents (TauricResearch) — Detailed Above (Section 1.2)

Multi-agent LLM framework (32.6k stars). The architecture of specialized analyst + researcher + trader + risk management agents is highly relevant for a hackathon project.

### 4.2 Other Notable Projects

| Project | Description | URL |
|---------|-------------|-----|
| **Chainstack Web3 AI Agent** | Full-stack Base + Uniswap V4 trading agent with custom LLM fine-tuning | [GitHub](https://github.com/chainstacklabs/web3-ai-trading-agent) |
| **LLM-TradeBot** | Multi-agent AI trading system using LLMs for strategy optimization | [GitHub](https://github.com/EthanAlgoX/LLM-TradeBot) |
| **LLM_trader** | LLM-powered crypto framework with vision AI chart analysis | [GitHub](https://github.com/qrak/LLM_trader) |
| **Hummingbot MCP** | Enables Claude/Gemini to interact with Hummingbot for automated trading | [hummingbot.org](https://hummingbot.org/) |
| **OpenAlgo** | Natural language trading via AI assistants (Claude, Cursor, ChatGPT) | [openalgo.in](https://openalgo.in/) |
| **FinRL** | Deep reinforcement learning library for trading | [GitHub](https://github.com/AI4Finance-Foundation/FinRL) |

### 4.3 How Existing Projects Integrate AI/LLM with On-Chain Execution

**Common patterns observed:**

1. **LLM-as-Analyst:** LLM processes market data → outputs JSON trade signal → execution engine swaps on-chain
   - Used by: Chainstack AI agent, LLM_trader
   
2. **Multi-Agent Debate:** Multiple specialized LLM agents discuss → consensus trade decision → execution
   - Used by: TradingAgents
   
3. **RL + LLM Hybrid:** RL model handles fast decisions, LLM provides strategic reasoning overlay
   - Used by: Chainstack AI agent (DQN + fine-tuned LLM)
   
4. **Tool-Calling Agent:** LLM agent with on-chain tools (read balances, execute swaps, check prices)
   - Used by: ElizaOS plugins, Hummingbot MCP

5. **Autonomous Loop:** Continuous cycle of sense → think → act with persistent state
   - Used by: Olas agents, Chainstack stateful agent

**Recommended for hackathon:** Pattern 1 or 4 (simplest to implement) with elements of Pattern 3 (RL for position sizing).

---

## 5. Base-Specific Tooling

### 5.1 RPC Endpoints

| Provider | Free Tier | Flashblocks | URL |
|----------|-----------|-------------|-----|
| **Coinbase/Base** | ✅ Free mainnet endpoint | Via node-reth | [coinbase.com/developer-platform](https://www.coinbase.com/developer-platform/products/base-node) |
| **Alchemy** | ✅ Free tier | ✅ | [alchemy.com](https://www.alchemy.com/) |
| **QuickNode** | ✅ Free tier | ✅ Full Flashblocks RPC | [quicknode.com](https://www.quicknode.com/docs/base/flashblocks/overview) |
| **Chainstack** | ✅ Free tier | ✅ Full Flashblocks RPC | [chainstack.com](https://chainstack.com/build-better-with-base/) |
| **Infura** | ✅ Free tier | Partial | [infura.io](https://infura.io/) |
| **dRPC** | ✅ Free tier | ✅ | [drpc.org](https://drpc.org/chainlist/base-mainnet-rpc) |
| **Dwellir** | ✅ Free tier | ✅ | [dwellir.com](https://www.dwellir.com/networks/base) |

**Base Mainnet details:**
- Chain ID: `8453`
- Public RPC: `https://mainnet.base.org`
- Base Sepolia (testnet) Chain ID: `84532`

**Source:** [Base Docs: Node Providers](https://docs.base.org/base-chain/tools/node-providers)

### 5.2 Block Explorers

| Explorer | URL | Features |
|----------|-----|----------|
| **Basescan** | [basescan.org](https://basescan.org/) | Official (Etherscan-family), API for contract verification |
| **OKLink Base** | [oklink.com/base](https://www.oklink.com/base) | Alternative explorer with analytics |
| **Blockscout** | Referenced in Base docs | Open-source explorer option |

**Source:** [Base Docs: Block Explorers](https://docs.base.org/base-chain/tools/block-explorers)

### 5.3 SDKs and Libraries

| Tool | Type | Language | Description |
|------|------|----------|-------------|
| **OnchainKit** | UI + Logic SDK | TypeScript/React | Coinbase's official SDK for building on Base. Includes wallet, swap, identity components. Built on viem/wagmi | 
| **viem** | Low-level client | TypeScript | Modern Ethereum library, Base chain definitions included |
| **wagmi** | React hooks | TypeScript | React hooks for Ethereum, integrates with OnchainKit |
| **web3.py** | Client library | Python | Full EVM interaction, used by most Python trading bots |
| **ethers.js / viem** | Client library | JavaScript/TypeScript | EVM interaction, viem is newer and faster |
| **Foundry (forge, anvil, cast)** | Dev framework | Solidity/Rust | Local testing via Base mainnet fork, transaction tracing |
| **Alloy** | Client library | Rust | Modern Rust Ethereum library, used by alloy-flashblocks |
| **Coinbase CDP SDKs** | Multi-language | Python, TypeScript, etc. | [docs.cdp.coinbase.com/sdks](https://docs.cdp.coinbase.com/sdks) — includes AI agent toolkit |

**Source:**
- [OnchainKit npm](https://www.npmjs.com/package/@coinbase/onchainkit)
- [Base Docs: Wagmi & Viem Integration](https://docs.base.org/onchainkit/latest/configuration/wagmi-viem-integration)
- [Coinbase Developer Documentation](https://docs.cdp.coinbase.com/sdks)

### 5.4 DEX-Specific Tools

| Tool | Purpose |
|------|---------|
| **Uniswap Universal Router Decoder** | Python library for decoding/encoding Uniswap Universal Router commands |
| **Uniswap V4 SDK** | JavaScript SDK for interacting with Uniswap V4 singleton contracts |
| **Aerodrome API** | REST API for pool data, pricing, and routing on Aerodrome |
| **1inch Fusion / Aggregator** | DEX aggregator API supporting Base |

### 5.5 Flashblocks-Specific Tools

| Tool | Language | Description | URL |
|------|----------|-------------|-----|
| **alloy-flashblocks** | Rust | Stream flashblocks + query preconfirmation state | [GitHub](https://github.com/SkandaBhat/alloy-flashblocks) |
| **node-reth** | Rust | Flashblocks-aware RPC node | [GitHub](https://github.com/base/node-reth) |
| **rollup-boost** | Rust | CL↔EL proxy with WebSocket streaming | [GitHub](https://github.com/flashbots/rollup-boost) |

---

## 6. Key Takeaways & Recommended Architecture

### 6.1 Competitive Differentiation Opportunities

Based on this research, the strongest hackathon angles for an autonomous trading agent on Base are:

1. **Flashblocks-native trading:** Very few open-source projects leverage 200ms preconfirmations. This is a **unique Base advantage** and a strong differentiator.

2. **Aerodrome ↔ Uniswap V4 arbitrage:** These are the two biggest DEXs on Base with fundamentally different AMM designs. Cross-DEX arbitrage with Flashblocks speed is novel.

3. **AI-driven strategy selection:** Use an LLM to analyze market conditions and select between multiple strategies (arb, market making, momentum) rather than hardcoding one strategy.

4. **On-chain execution with local AI:** The Chainstack approach of local LLM inference (Ollama) + on-chain execution via web3.py is the proven pattern.

### 6.2 Recommended Tech Stack

```
┌─────────────────────────────────────────────────────┐
│                 AI Layer (Off-Chain)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Ollama   │  │ RL Model │  │ Market Data Feed  │  │
│  │ (LLM)    │  │ (DQN/PPO)│  │ (price, volume)   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       └──────────────┴─────────────────┘             │
│                      │                                │
│              Strategy Decision                        │
│                      │                                │
├──────────────────────┼──────────────────────────────-─┤
│           Execution Layer (On-Chain)                  │
│  ┌──────────────┐  ┌────────────────────────────┐    │
│  │ Flashblocks  │  │  DEX Router                 │    │
│  │ WebSocket    │←→│  (Uniswap V4 + Aerodrome)  │    │
│  │ Stream       │  └────────────────────────────┘    │
│  └──────────────┘                                    │
│                                                      │
│  RPC: QuickNode/Chainstack (Flashblocks-enabled)     │
│  Chain: Base Mainnet (Chain ID 8453)                 │
└──────────────────────────────────────────────────────┘
```

**Language:** Python (web3.py for on-chain, Ollama for AI) or TypeScript (viem + OnchainKit)  
**Testing:** Foundry (anvil for local Base fork)  
**AI:** Ollama with financial model (Fin-R1 or fine-tuned Qwen) + optional RL layer  
**DEX Integration:** Uniswap V4 (via Universal Router) + Aerodrome (via their router)  
**Speed Edge:** Flashblocks WebSocket stream for 200ms preconfirmation awareness

### 6.3 Key Risks

- **MEV competition:** Professional bots with colocation infrastructure
- **Flashblocks reorgs:** Though reduced to ~0%, tail flashblocks may not be included
- **LLM latency:** Even local LLM inference adds 1-5 seconds — use for strategic decisions, not per-block execution
- **Gas costs:** Base is cheap but frequent trading accumulates
- **Smart contract risk:** Interacting with multiple DEXs increases attack surface

### 6.4 Key Sources Index

| Resource | URL |
|----------|-----|
| Base Documentation | https://docs.base.org/ |
| Flashblocks Deep Dive | https://blog.base.dev/flashblocks-deep-dive |
| Flashblocks FAQ | https://docs.base.org/base-chain/flashblocks/docs |
| Flashblocks Apps Guide | https://docs.base.org/base-chain/flashblocks/apps |
| Chainstack AI Trading Agent | https://github.com/chainstacklabs/web3-ai-trading-agent |
| TradingAgents Framework | https://github.com/TauricResearch/TradingAgents |
| ElizaOS Framework | https://github.com/elizaOS/eliza |
| Olas Network | https://olas.network/ |
| Aerodrome Finance | https://aerodrome.finance/ |
| Uniswap V4 Docs | https://docs.uniswap.org/contracts/v4/ |
| alloy-flashblocks | https://github.com/SkandaBhat/alloy-flashblocks |
| Fulcrum L2 Arbitrage | https://github.com/jordy25519/fulcrum |
| OnchainKit | https://www.npmjs.com/package/@coinbase/onchainkit |
| Coinbase Developer SDKs | https://docs.cdp.coinbase.com/sdks |
| Base Node Providers | https://docs.base.org/base-chain/tools/node-providers |
| MEV Bots in 2026 | https://mpost.io/leading-mev-bots-dominating-defi-trading-in-2026/ |
| L2 Arbitrage Guide | https://coincryptorank.com/blog/l2-arbitrage |
| DeFAI (CoW Protocol) | https://cow.fi/learn/how-ai-agents-can-be-used-in-defi |
| Stanford DeFi Lecture | https://fintech.stanford.edu/events/guest-lecture-series/decentralized-finance |
| bloXroute for Base | https://bloxroute.com/pulse/trade-faster-on-base-with-bloxroute/ |

---

*Report generated 2026-03-18 for Autonomous Trading Agent on Base hackathon project.*
