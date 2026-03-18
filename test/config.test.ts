import { describe, it, expect } from "vitest";
import {
  CHAIN_ID,
  TOKENS,
  TOKEN_DECIMALS,
  TRADING_PAIRS,
  DEX,
  RISK_PARAMS,
  TRADE_LOG_PATH,
  type RiskParams,
  type TradingPair,
} from "../src/config.js";

describe("config exports", () => {
  // ---- Chain --------------------------------------------------------------

  describe("chain", () => {
    it("exports Base chain ID", () => {
      expect(CHAIN_ID).toBe(8453);
    });
  });

  // ---- Tokens -------------------------------------------------------------

  describe("tokens", () => {
    it("exports WETH address", () => {
      expect(TOKENS.WETH).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("exports USDC address", () => {
      expect(TOKENS.USDC).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("has decimals for all token addresses", () => {
      for (const addr of Object.values(TOKENS)) {
        expect(TOKEN_DECIMALS[addr]).toBeDefined();
        expect(TOKEN_DECIMALS[addr]).toBeGreaterThan(0);
      }
    });

    it("WETH has 18 decimals", () => {
      expect(TOKEN_DECIMALS[TOKENS.WETH]).toBe(18);
    });

    it("USDC has 6 decimals", () => {
      expect(TOKEN_DECIMALS[TOKENS.USDC]).toBe(6);
    });
  });

  // ---- Trading pairs ------------------------------------------------------

  describe("trading pairs", () => {
    it("exports at least one trading pair", () => {
      expect(TRADING_PAIRS.length).toBeGreaterThanOrEqual(1);
    });

    it("each pair has required fields", () => {
      for (const pair of TRADING_PAIRS) {
        expect(pair.name).toBeTruthy();
        expect(pair.base).toMatch(/^0x/);
        expect(pair.quote).toMatch(/^0x/);
        expect(pair.aerodromePool).toMatch(/^0x/);
        expect(pair.uniswapPool).toMatch(/^0x/);
        expect(pair.uniswapFeeTier).toBeGreaterThan(0);
      }
    });

    it("WETH/USDC pair exists", () => {
      const wethUsdc = TRADING_PAIRS.find((p) => p.name === "WETH/USDC");
      expect(wethUsdc).toBeDefined();
      expect(wethUsdc!.base).toBe(TOKENS.WETH);
      expect(wethUsdc!.quote).toBe(TOKENS.USDC);
    });
  });

  // ---- DEX contracts ------------------------------------------------------

  describe("DEX contracts", () => {
    it("exports Aerodrome router address", () => {
      expect(DEX.AERODROME_ROUTER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("exports Uniswap router address", () => {
      expect(DEX.UNISWAP_ROUTER).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  // ---- Risk params --------------------------------------------------------

  describe("risk params", () => {
    it("exports valid risk parameters", () => {
      expect(RISK_PARAMS.maxPositionUsd).toBeGreaterThan(0);
      expect(RISK_PARAMS.maxDrawdownPct).toBeGreaterThan(0);
      expect(RISK_PARAMS.maxDrawdownPct).toBeLessThanOrEqual(100);
      expect(RISK_PARAMS.perTradeLossLimitUsd).toBeGreaterThan(0);
      expect(RISK_PARAMS.cooldownMs).toBeGreaterThan(0);
      expect(RISK_PARAMS.maxConsecutiveLosses).toBeGreaterThan(0);
      expect(RISK_PARAMS.minEdgeBps).toBeGreaterThan(0);
      expect(RISK_PARAMS.maxSlippageBps).toBeGreaterThan(0);
    });

    it("has expected default values when env vars not set", () => {
      // These defaults come from config.ts fallbacks
      expect(RISK_PARAMS.maxConsecutiveLosses).toBe(3);
      expect(RISK_PARAMS.minEdgeBps).toBe(10);
      expect(RISK_PARAMS.maxSlippageBps).toBe(50);
    });
  });

  // ---- Logging ------------------------------------------------------------

  describe("logging", () => {
    it("exports trade log path", () => {
      expect(TRADE_LOG_PATH).toBe("logs/trades.jsonl");
    });
  });
});
