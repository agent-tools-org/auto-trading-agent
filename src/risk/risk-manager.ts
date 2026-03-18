import type { RiskParams } from "../config.js";
import type { TradeDirection } from "../execution/swap-executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position {
  pair: string;
  direction: TradeDirection;
  entryPrice: number;
  size: number; // in USD terms
  entryTimestamp: number;
}

export interface RiskCheckResult {
  approved: boolean;
  reasons: string[];
  adjustedSizeUsd: number;
}

export interface TradeRecord {
  pair: string;
  pnlUsd: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Risk manager
// ---------------------------------------------------------------------------

export class RiskManager {
  private params: RiskParams;
  private positions: Map<string, Position> = new Map();
  private tradeHistory: TradeRecord[] = [];
  private startingEquityUsd: number;
  private currentEquityUsd: number;
  private lastTradeTimestamp: number = 0;
  private consecutiveLosses: number = 0;

  constructor(params: RiskParams, startingEquityUsd: number = 10_000) {
    this.params = params;
    this.startingEquityUsd = startingEquityUsd;
    this.currentEquityUsd = startingEquityUsd;
  }

  // ---- Risk checks --------------------------------------------------------

  checkTrade(
    pair: string,
    direction: TradeDirection,
    proposedSizeUsd: number,
    currentPrice: number,
  ): RiskCheckResult {
    const reasons: string[] = [];
    let adjustedSize = proposedSizeUsd;

    // 1. Cooldown check
    if (this.isInCooldown()) {
      return {
        approved: false,
        reasons: [
          `In cooldown: ${this.consecutiveLosses} consecutive losses. ` +
            `Wait ${this.cooldownRemainingMs()}ms`,
        ],
        adjustedSizeUsd: 0,
      };
    }

    // 2. Drawdown limit
    const drawdownPct =
      ((this.startingEquityUsd - this.currentEquityUsd) /
        this.startingEquityUsd) *
      100;
    if (drawdownPct >= this.params.maxDrawdownPct) {
      return {
        approved: false,
        reasons: [
          `Drawdown limit hit: ${drawdownPct.toFixed(2)}% >= ${this.params.maxDrawdownPct}%`,
        ],
        adjustedSizeUsd: 0,
      };
    }

    // 3. Max position size
    if (adjustedSize > this.params.maxPositionUsd) {
      adjustedSize = this.params.maxPositionUsd;
      reasons.push(
        `Capped size from $${proposedSizeUsd} to $${adjustedSize} (max position)`,
      );
    }

    // 4. Per-trade loss limit — ensure max possible loss is within limit
    // Worst case: max slippage + adverse move = lose full position (conservative)
    if (adjustedSize > this.params.perTradeLossLimitUsd * 5) {
      adjustedSize = this.params.perTradeLossLimitUsd * 5;
      reasons.push(
        `Reduced size to $${adjustedSize} (per-trade loss limit)`,
      );
    }

    // 5. Existing position check — don't double up on same pair same direction
    const existing = this.positions.get(pair);
    if (existing && existing.direction === direction) {
      return {
        approved: false,
        reasons: [
          `Already have ${direction} position on ${pair} ($${existing.size.toFixed(2)})`,
        ],
        adjustedSizeUsd: 0,
      };
    }

    // 6. Scale down near drawdown limit
    const drawdownBuffer = this.params.maxDrawdownPct - drawdownPct;
    if (drawdownBuffer < 2) {
      const scaleFactor = drawdownBuffer / 2;
      adjustedSize *= scaleFactor;
      reasons.push(
        `Scaled down ${((1 - scaleFactor) * 100).toFixed(0)}% — near drawdown limit`,
      );
    }

    if (adjustedSize <= 0) {
      return { approved: false, reasons: ["Adjusted size is zero"], adjustedSizeUsd: 0 };
    }

    if (reasons.length === 0) {
      reasons.push("All risk checks passed");
    }

    return { approved: true, reasons, adjustedSizeUsd: adjustedSize };
  }

  // ---- Cooldown -----------------------------------------------------------

  private isInCooldown(): boolean {
    if (this.consecutiveLosses < this.params.maxConsecutiveLosses) return false;
    const elapsed = Date.now() - this.lastTradeTimestamp;
    return elapsed < this.params.cooldownMs;
  }

  private cooldownRemainingMs(): number {
    const elapsed = Date.now() - this.lastTradeTimestamp;
    return Math.max(0, this.params.cooldownMs - elapsed);
  }

  // ---- Position tracking --------------------------------------------------

  openPosition(
    pair: string,
    direction: TradeDirection,
    entryPrice: number,
    sizeUsd: number,
  ): void {
    this.positions.set(pair, {
      pair,
      direction,
      entryPrice,
      size: sizeUsd,
      entryTimestamp: Date.now(),
    });
    console.log(
      `[Risk] Opened ${direction} ${pair}: $${sizeUsd.toFixed(2)} @ ${entryPrice}`,
    );
  }

  closePosition(pair: string, exitPrice: number): TradeRecord | null {
    const pos = this.positions.get(pair);
    if (!pos) return null;

    const priceChange = (exitPrice - pos.entryPrice) / pos.entryPrice;
    const pnlMultiplier = pos.direction === "buy" ? priceChange : -priceChange;
    const pnlUsd = pos.size * pnlMultiplier;

    this.positions.delete(pair);
    this.currentEquityUsd += pnlUsd;
    this.lastTradeTimestamp = Date.now();

    if (pnlUsd < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }

    const record: TradeRecord = {
      pair,
      pnlUsd,
      timestamp: Date.now(),
    };
    this.tradeHistory.push(record);

    console.log(
      `[Risk] Closed ${pair}: PnL $${pnlUsd.toFixed(2)} | ` +
        `Equity $${this.currentEquityUsd.toFixed(2)} | ` +
        `Consecutive losses: ${this.consecutiveLosses}`,
    );

    return record;
  }

  getPosition(pair: string): Position | undefined {
    return this.positions.get(pair);
  }

  hasOpenPosition(pair: string): boolean {
    return this.positions.has(pair);
  }

  // ---- Stats --------------------------------------------------------------

  getEquity(): number {
    return this.currentEquityUsd;
  }

  getDrawdownPct(): number {
    return (
      ((this.startingEquityUsd - this.currentEquityUsd) /
        this.startingEquityUsd) *
      100
    );
  }

  getTradeHistory(): TradeRecord[] {
    return [...this.tradeHistory];
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  updateEquity(newEquity: number): void {
    this.currentEquityUsd = newEquity;
  }
}
