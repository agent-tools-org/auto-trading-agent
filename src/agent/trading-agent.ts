import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { formatUnits, parseUnits, type Hex } from "viem";

import {
  TRADING_PAIRS,
  RISK_PARAMS,
  POLL_INTERVAL_MS,
  TRADE_LOG_PATH,
  TOKEN_DECIMALS,
  type TradingPair,
} from "../config.js";
import { PriceFeed, type PriceSnapshot } from "../data/price-feed.js";
import { RegimeDetector, type RegimeSignal } from "../strategy/regime-detector.js";
import {
  SwapExecutor,
  type TradeProposal,
  type TradeResult,
  type Venue,
} from "../execution/swap-executor.js";
import { RiskManager } from "../risk/risk-manager.js";
import { AIReasoner, type ReasonerInput, type ReasonerOutput } from "./ai-reasoner.js";

// ---------------------------------------------------------------------------
// Trade log entry
// ---------------------------------------------------------------------------

interface TradeLogEntry {
  timestamp: string;
  pair: string;
  direction: "buy" | "sell";
  amountInUsd: number;
  venue: Venue;
  reason: string;
  txHash: string | null;
  pnl: number | null;
  regime: string;
  aiDecision: string;
  aiConfidence: number;
  aiExplanation: string;
}

// ---------------------------------------------------------------------------
// Trading Agent
// ---------------------------------------------------------------------------

export class TradingAgent {
  private priceFeed: PriceFeed;
  private regimeDetector: RegimeDetector;
  private executor: SwapExecutor;
  private riskManager: RiskManager;
  private aiReasoner: AIReasoner;
  private running: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount: number = 0;

  constructor() {
    this.priceFeed = new PriceFeed();
    this.regimeDetector = new RegimeDetector();
    this.executor = new SwapExecutor();
    this.riskManager = new RiskManager(RISK_PARAMS);
    this.aiReasoner = new AIReasoner();

    // Ensure log directory exists
    const logDir = dirname(TRADE_LOG_PATH);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  // ---- Lifecycle ----------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log("=".repeat(60));
    console.log("  Autonomous Trading Agent — Liquidity Migration Regime Trader");
    console.log("  Base L2 | Aerodrome + Uniswap");
    console.log(`  Pairs: ${TRADING_PAIRS.map((p) => p.name).join(", ")}`);
    console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`  Wallet: ${this.executor.address}`);
    console.log("=".repeat(60));

    // Run immediately, then on interval
    void this.cycle();
    this.timer = setInterval(() => void this.cycle(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[Agent] Stopped.");
  }

  // ---- Main cycle ---------------------------------------------------------

  private async cycle(): Promise<void> {
    this.cycleCount++;
    const cycleTag = `[Cycle ${this.cycleCount}]`;

    try {
      for (const pair of TRADING_PAIRS) {
        if (!this.running) break;
        await this.processPair(pair, cycleTag);
      }
    } catch (err) {
      console.error(`${cycleTag} Unhandled error:`, err);
    }
  }

  private async processPair(pair: TradingPair, cycleTag: string): Promise<void> {
    // 1. Get price snapshot
    const snapshot = await this.priceFeed.getSnapshot(pair);
    const midPrice = this.getMidPrice(snapshot);

    if (midPrice === 0) {
      console.log(`${cycleTag} [${pair.name}] No price data — skipping`);
      return;
    }

    console.log(
      `${cycleTag} [${pair.name}] ` +
        `Aero=${snapshot.aerodrome?.price?.toFixed(4) ?? "N/A"} | ` +
        `Uni=${snapshot.uniswap?.price?.toFixed(4) ?? "N/A"} | ` +
        `Spread=${(snapshot.spread * 100).toFixed(4)}%`,
    );

    // 2. Check for exit conditions on existing position
    if (this.riskManager.hasOpenPosition(pair.name)) {
      await this.checkExit(pair, snapshot, midPrice, cycleTag);
      return; // Don't open new position while one is open
    }

    // 3. Detect regime
    const history = this.priceFeed.getHistory(pair.name);
    const regime = this.regimeDetector.detect(history, snapshot);

    console.log(
      `${cycleTag} [${pair.name}] Regime: ${regime.regime} ` +
        `(${regime.direction}, conf=${regime.confidence.toFixed(2)})`,
    );

    // 4. Skip no-trade regimes
    if (regime.regime === "no_trade") {
      console.log(`${cycleTag} [${pair.name}] No-trade regime — skipping`);
      return;
    }

    // 5. Build trade proposal
    const proposedSizeUsd = RISK_PARAMS.maxPositionUsd * regime.confidence;
    const direction = regime.direction === "long" ? "buy" as const : "sell" as const;

    // 6. Risk check
    const riskCheck = this.riskManager.checkTrade(
      pair.name,
      direction,
      proposedSizeUsd,
      midPrice,
    );

    if (!riskCheck.approved) {
      console.log(
        `${cycleTag} [${pair.name}] Risk rejected: ${riskCheck.reasons.join("; ")}`,
      );
      return;
    }

    // 7. AI reasoning
    const reasonerInput: ReasonerInput = {
      pair: pair.name,
      snapshot,
      regime,
      currentPositionDir: null,
      currentEquityUsd: this.riskManager.getEquity(),
      drawdownPct: this.riskManager.getDrawdownPct(),
      consecutiveLosses: this.riskManager.getConsecutiveLosses(),
    };

    const aiResult = await this.aiReasoner.evaluate(reasonerInput);

    console.log(
      `${cycleTag} [${pair.name}] AI: ${aiResult.decision} ` +
        `(conf=${aiResult.confidence.toFixed(2)}, mult=${aiResult.sizeMultiplier.toFixed(2)}) ` +
        `— ${aiResult.explanation}`,
    );

    if (aiResult.decision === "reject") {
      this.writeLog({
        timestamp: new Date().toISOString(),
        pair: pair.name,
        direction,
        amountInUsd: 0,
        venue: "uniswap",
        reason: `AI rejected: ${aiResult.explanation}`,
        txHash: null,
        pnl: null,
        regime: regime.regime,
        aiDecision: aiResult.decision,
        aiConfidence: aiResult.confidence,
        aiExplanation: aiResult.explanation,
      });
      return;
    }

    // 8. Compute final trade size
    const finalSizeUsd =
      riskCheck.adjustedSizeUsd * aiResult.sizeMultiplier;

    if (finalSizeUsd < 1) {
      console.log(`${cycleTag} [${pair.name}] Size too small ($${finalSizeUsd.toFixed(2)}) — skipping`);
      return;
    }

    // 9. Choose venue — prefer venue with better price
    const venue = this.pickVenue(snapshot, direction);

    // 10. Convert USD size to token amount
    const tokenIn = direction === "buy" ? pair.quote : pair.base;
    const decimalsIn = TOKEN_DECIMALS[tokenIn] ?? 18;
    let amountIn: bigint;

    if (direction === "buy") {
      // Buying base with quote (USDC) — amountIn is in USDC
      amountIn = parseUnits(finalSizeUsd.toFixed(decimalsIn), decimalsIn);
    } else {
      // Selling base for quote — amountIn is base token amount
      const baseAmount = finalSizeUsd / midPrice;
      amountIn = parseUnits(baseAmount.toFixed(decimalsIn), decimalsIn);
    }

    // 11. Execute trade
    const proposal: TradeProposal = {
      pair,
      direction,
      amountIn,
      venue,
      expectedPrice: midPrice,
      maxSlippageBps: RISK_PARAMS.maxSlippageBps,
    };

    console.log(
      `${cycleTag} [${pair.name}] Executing ${direction} $${finalSizeUsd.toFixed(2)} on ${venue}`,
    );

    const result = await this.executor.execute(proposal);

    // 12. Record position and log
    if (result.success) {
      this.riskManager.openPosition(pair.name, direction, midPrice, finalSizeUsd);
      console.log(
        `${cycleTag} [${pair.name}] ✅ Trade executed: ${result.txHash}`,
      );
    } else {
      console.log(
        `${cycleTag} [${pair.name}] ❌ Trade failed: ${result.error}`,
      );
    }

    this.writeLog({
      timestamp: new Date().toISOString(),
      pair: pair.name,
      direction,
      amountInUsd: finalSizeUsd,
      venue: result.venue,
      reason: aiResult.explanation,
      txHash: result.txHash,
      pnl: null,
      regime: regime.regime,
      aiDecision: aiResult.decision,
      aiConfidence: aiResult.confidence,
      aiExplanation: aiResult.explanation,
    });
  }

  // ---- Exit logic ---------------------------------------------------------

  private async checkExit(
    pair: TradingPair,
    snapshot: PriceSnapshot,
    currentPrice: number,
    cycleTag: string,
  ): Promise<void> {
    const position = this.riskManager.getPosition(pair.name);
    if (!position) return;

    const priceChange =
      (currentPrice - position.entryPrice) / position.entryPrice;
    const pnlMultiplier =
      position.direction === "buy" ? priceChange : -priceChange;
    const unrealisedPnl = position.size * pnlMultiplier;

    // Exit conditions:
    // 1. Take profit: +2% move in our favor
    // 2. Stop loss: -1% adverse move
    // 3. Time stop: position held > 10 minutes
    const holdTimeMs = Date.now() - position.entryTimestamp;
    const holdTimeMin = holdTimeMs / 60_000;

    const shouldExit =
      pnlMultiplier >= 0.02 || // take profit
      pnlMultiplier <= -0.01 || // stop loss
      holdTimeMin > 10; // time stop

    if (!shouldExit) {
      console.log(
        `${cycleTag} [${pair.name}] Position ${position.direction}: ` +
          `PnL ${(pnlMultiplier * 100).toFixed(2)}% ($${unrealisedPnl.toFixed(2)}) | ` +
          `Hold: ${holdTimeMin.toFixed(1)}min`,
      );
      return;
    }

    const exitReason =
      pnlMultiplier >= 0.02
        ? "take_profit"
        : pnlMultiplier <= -0.01
          ? "stop_loss"
          : "time_stop";

    console.log(
      `${cycleTag} [${pair.name}] Exiting: ${exitReason} | ` +
        `PnL: $${unrealisedPnl.toFixed(2)}`,
    );

    // Execute the closing trade (opposite direction)
    const closeDirection = position.direction === "buy" ? "sell" as const : "buy" as const;
    const tokenIn = closeDirection === "buy" ? pair.quote : pair.base;
    const decimalsIn = TOKEN_DECIMALS[tokenIn] ?? 18;

    let amountIn: bigint;
    if (closeDirection === "sell") {
      // Selling base → amount is in base tokens
      const baseAmount = position.size / position.entryPrice;
      amountIn = parseUnits(baseAmount.toFixed(decimalsIn), decimalsIn);
    } else {
      // Buying base with quote
      amountIn = parseUnits(position.size.toFixed(decimalsIn), decimalsIn);
    }

    const venue = this.pickVenue(snapshot, closeDirection);

    const proposal: TradeProposal = {
      pair,
      direction: closeDirection,
      amountIn,
      venue,
      expectedPrice: currentPrice,
      maxSlippageBps: RISK_PARAMS.maxSlippageBps,
    };

    const result = await this.executor.execute(proposal);
    const record = this.riskManager.closePosition(pair.name, currentPrice);

    this.writeLog({
      timestamp: new Date().toISOString(),
      pair: pair.name,
      direction: closeDirection,
      amountInUsd: position.size,
      venue: result.venue,
      reason: `Exit: ${exitReason}`,
      txHash: result.txHash,
      pnl: record?.pnlUsd ?? null,
      regime: "exit",
      aiDecision: "exit",
      aiConfidence: 1,
      aiExplanation: `Closed position: ${exitReason}, PnL $${(record?.pnlUsd ?? 0).toFixed(2)}`,
    });
  }

  // ---- Helpers ------------------------------------------------------------

  private getMidPrice(snapshot: PriceSnapshot): number {
    const a = snapshot.aerodrome?.price ?? 0;
    const u = snapshot.uniswap?.price ?? 0;
    if (a > 0 && u > 0) return (a + u) / 2;
    return a || u;
  }

  private pickVenue(
    snapshot: PriceSnapshot,
    direction: "buy" | "sell",
  ): Venue {
    const aPrice = snapshot.aerodrome?.price ?? 0;
    const uPrice = snapshot.uniswap?.price ?? 0;

    if (aPrice === 0) return "uniswap";
    if (uPrice === 0) return "aerodrome";

    // Buy on cheaper venue, sell on more expensive venue
    if (direction === "buy") {
      return aPrice < uPrice ? "aerodrome" : "uniswap";
    }
    return aPrice > uPrice ? "aerodrome" : "uniswap";
  }

  private writeLog(entry: TradeLogEntry): void {
    try {
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(TRADE_LOG_PATH, line, "utf-8");
    } catch (err) {
      console.error("[Agent] Failed to write trade log:", err);
    }
  }
}
