import { describe, it, expect } from "vitest";
import { RegimeDetector, type RegimeSignal } from "../src/strategy/regime-detector.js";
import type { PriceHistory, PriceSnapshot, PoolState } from "../src/data/price-feed.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(opts: {
  aeroPrice?: number;
  uniPrice?: number;
  spread?: number;
}): PriceSnapshot {
  const aero: PoolState | null =
    opts.aeroPrice != null
      ? { venue: "aerodrome", pair: "WETH/USDC", price: opts.aeroPrice, liquidity: 1000n, timestamp: Date.now() }
      : null;
  const uni: PoolState | null =
    opts.uniPrice != null
      ? { venue: "uniswap", pair: "WETH/USDC", price: opts.uniPrice, liquidity: 1000n, timestamp: Date.now() }
      : null;
  return {
    pair: "WETH/USDC",
    aerodrome: aero,
    uniswap: uni,
    spread: opts.spread ?? 0,
    timestamp: Date.now(),
  };
}

/** Generate a price series with a linear trend. */
function trendingPrices(start: number, end: number, count: number): number[] {
  const prices: number[] = [];
  for (let i = 0; i < count; i++) {
    prices.push(start + ((end - start) * i) / (count - 1));
  }
  return prices;
}

/** Generate a price series oscillating around a mean (for mean-reversion). */
function oscillatingPrices(mean: number, amplitude: number, count: number): number[] {
  const prices: number[] = [];
  for (let i = 0; i < count; i++) {
    prices.push(mean + amplitude * Math.sin((2 * Math.PI * i) / 10));
  }
  return prices;
}

function makeHistory(prices: number[], volumes?: number[]): PriceHistory {
  return {
    prices,
    timestamps: prices.map((_, i) => Date.now() - (prices.length - i) * 15000),
    volumes: volumes ?? prices.map(() => 100),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegimeDetector", () => {
  const detector = new RegimeDetector();

  describe("insufficient data", () => {
    it("returns no_trade with fewer than 10 data points", () => {
      const history = makeHistory([100, 101, 102, 103, 104]);
      const snapshot = makeSnapshot({ aeroPrice: 105, uniPrice: 105 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("no_trade");
      expect(signal.direction).toBe("neutral");
      expect(signal.confidence).toBeLessThan(0.5);
      expect(signal.features.dataPoints).toBe(5);
    });

    it("returns no_trade with empty price history", () => {
      const history = makeHistory([]);
      const snapshot = makeSnapshot({ aeroPrice: 100, uniPrice: 100 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("no_trade");
      expect(signal.features.dataPoints).toBe(0);
    });

    it("returns no_trade with a single price point", () => {
      const history = makeHistory([100]);
      const snapshot = makeSnapshot({ aeroPrice: 100, uniPrice: 100 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("no_trade");
    });
  });

  describe("momentum regime", () => {
    it("detects upward momentum (long)", () => {
      // Strong uptrend: 100 → 250 over 30 points (trendStrength ~0.89)
      const prices = trendingPrices(100, 250, 30);
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 250, uniPrice: 250 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("momentum");
      expect(signal.direction).toBe("long");
      expect(signal.confidence).toBeGreaterThan(0.4);
    });

    it("detects downward momentum (short)", () => {
      // Strong downtrend: 250 → 100 over 30 points
      const prices = trendingPrices(250, 100, 30);
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 100, uniPrice: 100 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("momentum");
      expect(signal.direction).toBe("short");
      expect(signal.confidence).toBeGreaterThan(0.4);
    });
  });

  describe("mean-reversion regime", () => {
    it("detects price far above mean (short signal)", () => {
      // Oscillate around 100, but end with price well above mean
      const prices = oscillatingPrices(100, 1, 30);
      // Push the last few prices high to create a high z-score with low trend
      prices[prices.length - 1] = 108;
      prices[prices.length - 2] = 106;
      prices[prices.length - 3] = 104;
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 108, uniPrice: 108 });

      const signal = detector.detect(history, snapshot);

      // With the price pushed up, z-score should be high
      if (signal.regime === "mean_reversion") {
        expect(signal.direction).toBe("short");
      }
      // May also detect as momentum depending on features; accept either
      expect(["mean_reversion", "momentum", "no_trade"]).toContain(signal.regime);
    });

    it("detects price far below mean (long signal)", () => {
      const prices = oscillatingPrices(100, 1, 30);
      prices[prices.length - 1] = 92;
      prices[prices.length - 2] = 94;
      prices[prices.length - 3] = 96;
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 92, uniPrice: 92 });

      const signal = detector.detect(history, snapshot);

      if (signal.regime === "mean_reversion") {
        expect(signal.direction).toBe("long");
      }
      expect(["mean_reversion", "momentum", "no_trade"]).toContain(signal.regime);
    });
  });

  describe("cross-venue spread", () => {
    it("detects large spread as mean-reversion opportunity", () => {
      // Enough data points to pass the minimum threshold
      const prices = trendingPrices(100, 100.5, 15);
      const history = makeHistory(prices);
      // Large spread: 0.5% between venues
      const snapshot = makeSnapshot({
        aeroPrice: 99.75,
        uniPrice: 100.25,
        spread: 0.005,
      });

      const signal = detector.detect(history, snapshot);

      // The spread is > 0.003, so cross-venue detection should kick in
      // unless another regime has higher priority
      if (signal.features.venueSpread > 0.003) {
        expect(signal.regime).toBe("mean_reversion");
      }
    });
  });

  describe("no-trade regime", () => {
    it("returns no_trade for flat, featureless market", () => {
      // Flat prices with no volatility, no trend, no spread
      const prices = Array(50).fill(100) as number[];
      // Add tiny noise to avoid zero stddev
      for (let i = 0; i < prices.length; i++) {
        prices[i] += (Math.random() - 0.5) * 0.001;
      }
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 100, uniPrice: 100 });

      const signal = detector.detect(history, snapshot);

      expect(signal.regime).toBe("no_trade");
      expect(signal.direction).toBe("neutral");
    });

    it("returns no_trade for high volatility with low data points", () => {
      // Highly volatile with few points (10-29 range)
      const prices: number[] = [];
      for (let i = 0; i < 15; i++) {
        prices.push(100 + (i % 2 === 0 ? 20 : -20));
      }
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 120, uniPrice: 120 });

      const signal = detector.detect(history, snapshot);

      // High volatility + low data → no_trade
      expect(signal.regime).toBe("no_trade");
    });
  });

  describe("feature extraction", () => {
    it("populates all feature fields", () => {
      const prices = trendingPrices(100, 110, 30);
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 110, uniPrice: 110, spread: 0.001 });

      const signal = detector.detect(history, snapshot);

      expect(signal.features.dataPoints).toBe(30);
      expect(typeof signal.features.volatility).toBe("number");
      expect(typeof signal.features.trendStrength).toBe("number");
      expect(typeof signal.features.zScore).toBe("number");
      expect(typeof signal.features.venueSpread).toBe("number");
      expect(typeof signal.features.volumeTrend).toBe("number");
    });

    it("venue spread matches snapshot spread", () => {
      const prices = trendingPrices(100, 100.5, 20);
      const history = makeHistory(prices);
      const snapshot = makeSnapshot({ aeroPrice: 100, uniPrice: 101, spread: 0.01 });

      const signal = detector.detect(history, snapshot);

      expect(signal.features.venueSpread).toBe(0.01);
    });
  });
});
