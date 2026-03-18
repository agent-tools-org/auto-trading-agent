import { describe, it, expect, beforeEach } from "vitest";
import { RiskManager } from "../src/risk/risk-manager.js";
import type { RiskParams } from "../src/config.js";

// ---------------------------------------------------------------------------
// Default test params
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS: RiskParams = {
  maxPositionUsd: 500,
  maxDrawdownPct: 5,
  perTradeLossLimitUsd: 50,
  cooldownMs: 60_000,
  maxConsecutiveLosses: 3,
  minEdgeBps: 10,
  maxSlippageBps: 50,
};

const STARTING_EQUITY = 10_000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RiskManager", () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = new RiskManager(DEFAULT_PARAMS, STARTING_EQUITY);
  });

  // ---- Basic approval -----------------------------------------------------

  describe("checkTrade — basic approval", () => {
    it("approves a valid trade within limits", () => {
      const result = rm.checkTrade("WETH/USDC", "buy", 200, 3000);

      expect(result.approved).toBe(true);
      expect(result.adjustedSizeUsd).toBe(200);
      expect(result.reasons).toContain("All risk checks passed");
    });
  });

  // ---- Position size limits -----------------------------------------------

  describe("checkTrade — position size limits", () => {
    it("caps size to maxPositionUsd", () => {
      const result = rm.checkTrade("WETH/USDC", "buy", 1000, 3000);

      expect(result.approved).toBe(true);
      expect(result.adjustedSizeUsd).toBeLessThanOrEqual(DEFAULT_PARAMS.maxPositionUsd);
      expect(result.reasons.some((r) => r.includes("Capped size"))).toBe(true);
    });

    it("reduces size based on per-trade loss limit", () => {
      // perTradeLossLimitUsd * 5 = 250, proposing 400 (within maxPosition=500)
      const params: RiskParams = {
        ...DEFAULT_PARAMS,
        maxPositionUsd: 600,
        perTradeLossLimitUsd: 40,
      };
      const rm2 = new RiskManager(params, STARTING_EQUITY);

      const result = rm2.checkTrade("WETH/USDC", "buy", 400, 3000);

      expect(result.approved).toBe(true);
      // Should be capped to perTradeLossLimitUsd * 5 = 200
      expect(result.adjustedSizeUsd).toBeLessThanOrEqual(200);
    });
  });

  // ---- Drawdown limits ----------------------------------------------------

  describe("checkTrade — drawdown limits", () => {
    it("rejects trade when drawdown limit is hit", () => {
      // Simulate equity loss to hit drawdown
      rm.updateEquity(STARTING_EQUITY * 0.94); // 6% drawdown > 5% limit

      const result = rm.checkTrade("WETH/USDC", "buy", 200, 3000);

      expect(result.approved).toBe(false);
      expect(result.reasons.some((r) => r.includes("Drawdown limit"))).toBe(true);
      expect(result.adjustedSizeUsd).toBe(0);
    });

    it("scales down size near drawdown limit", () => {
      // 4% drawdown → 1% buffer < 2% → should scale down
      rm.updateEquity(STARTING_EQUITY * 0.96);

      const result = rm.checkTrade("WETH/USDC", "buy", 200, 3000);

      expect(result.approved).toBe(true);
      expect(result.adjustedSizeUsd).toBeLessThan(200);
      expect(result.reasons.some((r) => r.includes("near drawdown limit"))).toBe(true);
    });
  });

  // ---- Cooldown after losses ----------------------------------------------

  describe("checkTrade — cooldown after losses", () => {
    it("triggers cooldown after max consecutive losses", () => {
      // Simulate 3 consecutive losing trades
      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 2900); // loss
      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 2900); // loss
      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 2900); // loss → 3 consecutive

      const result = rm.checkTrade("WETH/USDC", "buy", 200, 3000);

      expect(result.approved).toBe(false);
      expect(result.reasons.some((r) => r.includes("cooldown"))).toBe(true);
      expect(rm.getConsecutiveLosses()).toBe(3);
    });

    it("resets consecutive losses after a winning trade", () => {
      // 2 losses then 1 win
      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 2900); // loss
      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 2900); // loss

      expect(rm.getConsecutiveLosses()).toBe(2);

      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 3100); // win

      expect(rm.getConsecutiveLosses()).toBe(0);
    });
  });

  // ---- Duplicate position blocking ----------------------------------------

  describe("checkTrade — duplicate position", () => {
    it("rejects same-direction trade on an open position", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 200);

      const result = rm.checkTrade("WETH/USDC", "buy", 200, 3100);

      expect(result.approved).toBe(false);
      expect(result.reasons.some((r) => r.includes("Already have"))).toBe(true);
    });

    it("allows opposite-direction trade on an open position", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 200);

      const result = rm.checkTrade("WETH/USDC", "sell", 200, 3100);

      expect(result.approved).toBe(true);
    });

    it("allows trade on different pair", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 200);

      const result = rm.checkTrade("cbBTC/USDC", "buy", 200, 60000);

      expect(result.approved).toBe(true);
    });
  });

  // ---- Position tracking --------------------------------------------------

  describe("position tracking", () => {
    it("tracks open position", () => {
      expect(rm.hasOpenPosition("WETH/USDC")).toBe(false);

      rm.openPosition("WETH/USDC", "buy", 3000, 200);

      expect(rm.hasOpenPosition("WETH/USDC")).toBe(true);
      const pos = rm.getPosition("WETH/USDC");
      expect(pos).toBeDefined();
      expect(pos!.direction).toBe("buy");
      expect(pos!.entryPrice).toBe(3000);
      expect(pos!.size).toBe(200);
    });

    it("closes position and computes buy PnL correctly", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 300);
      const record = rm.closePosition("WETH/USDC", 3300);

      expect(record).not.toBeNull();
      expect(record!.pnlUsd).toBeCloseTo(30); // 300 * (3300-3000)/3000 = 30
      expect(rm.hasOpenPosition("WETH/USDC")).toBe(false);
    });

    it("closes position and computes sell PnL correctly", () => {
      rm.openPosition("WETH/USDC", "sell", 3000, 300);
      // Price dropped → sell is profitable
      const record = rm.closePosition("WETH/USDC", 2700);

      expect(record).not.toBeNull();
      expect(record!.pnlUsd).toBeCloseTo(30); // 300 * -(2700-3000)/3000 = 30
    });

    it("returns null when closing non-existent position", () => {
      const record = rm.closePosition("WETH/USDC", 3000);
      expect(record).toBeNull();
    });
  });

  // ---- Equity and stats ---------------------------------------------------

  describe("equity and stats", () => {
    it("starts with correct equity", () => {
      expect(rm.getEquity()).toBe(STARTING_EQUITY);
      expect(rm.getDrawdownPct()).toBe(0);
    });

    it("updates equity after trade", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 300);
      rm.closePosition("WETH/USDC", 3300); // +$30

      expect(rm.getEquity()).toBeCloseTo(STARTING_EQUITY + 30);
    });

    it("tracks drawdown percentage", () => {
      rm.openPosition("WETH/USDC", "buy", 3000, 1000);
      rm.closePosition("WETH/USDC", 2700); // -$100 (10% of position lost)

      const drawdown = rm.getDrawdownPct();
      expect(drawdown).toBeGreaterThan(0);
      expect(drawdown).toBeCloseTo(1); // $100 / $10000 = 1%
    });

    it("returns trade history", () => {
      expect(rm.getTradeHistory()).toHaveLength(0);

      rm.openPosition("WETH/USDC", "buy", 3000, 100);
      rm.closePosition("WETH/USDC", 3100);

      const history = rm.getTradeHistory();
      expect(history).toHaveLength(1);
      expect(history[0].pair).toBe("WETH/USDC");
      expect(history[0].pnlUsd).toBeGreaterThan(0);
    });

    it("updateEquity changes current equity", () => {
      rm.updateEquity(8000);
      expect(rm.getEquity()).toBe(8000);
      expect(rm.getDrawdownPct()).toBeCloseTo(20); // (10000-8000)/10000 * 100
    });
  });
});
