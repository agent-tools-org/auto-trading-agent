import type { PriceHistory, PriceSnapshot } from "../data/price-feed.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketRegime = "momentum" | "mean_reversion" | "no_trade";

export interface RegimeSignal {
  regime: MarketRegime;
  confidence: number; // 0-1
  direction: "long" | "short" | "neutral";
  features: RegimeFeatures;
}

export interface RegimeFeatures {
  /** Realised volatility (std dev of returns, annualised %) */
  volatility: number;
  /** Trend strength: positive = uptrend, negative = downtrend */
  trendStrength: number;
  /** Mean-reversion z-score: distance from moving average in std devs */
  zScore: number;
  /** Cross-venue spread (%) */
  venueSpread: number;
  /** Volume trend: >1 means increasing, <1 means decreasing */
  volumeTrend: number;
  /** Number of data points available */
  dataPoints: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function returns(prices: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    ret.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return ret;
}

// ---------------------------------------------------------------------------
// Regime Detector
// ---------------------------------------------------------------------------

export class RegimeDetector {
  /**
   * Classify the current market regime for a pair using recent price data,
   * volume patterns, and cross-venue spread.
   */
  detect(history: PriceHistory, snapshot: PriceSnapshot): RegimeSignal {
    const features = this.extractFeatures(history, snapshot);

    // Not enough data → no-trade
    if (features.dataPoints < 10) {
      return {
        regime: "no_trade",
        confidence: 0.1,
        direction: "neutral",
        features,
      };
    }

    // High volatility + low data confidence → no-trade (toxic flow)
    if (features.volatility > 120 && features.dataPoints < 30) {
      return {
        regime: "no_trade",
        confidence: 0.3,
        direction: "neutral",
        features,
      };
    }

    // ----- Momentum detection -----
    // Strong trend with moderate volatility
    const absTrend = Math.abs(features.trendStrength);
    if (absTrend > 0.6 && features.volatility < 100) {
      const direction = features.trendStrength > 0 ? "long" : "short";
      // Confidence scales with trend strength and data availability
      const confidence = Math.min(
        0.9,
        0.4 + absTrend * 0.3 + (features.dataPoints / 200) * 0.2,
      );
      return { regime: "momentum", confidence, direction, features };
    }

    // ----- Mean-reversion detection -----
    // Price far from mean in a low-volatility, range-bound environment
    const absZ = Math.abs(features.zScore);
    if (absZ > 1.5 && features.volatility < 80 && absTrend < 0.4) {
      // Trade back toward the mean
      const direction = features.zScore > 0 ? "short" : "long";
      const confidence = Math.min(
        0.85,
        0.3 + absZ * 0.15 + (features.dataPoints / 200) * 0.2,
      );
      return { regime: "mean_reversion", confidence, direction, features };
    }

    // ----- Cross-venue spread opportunity -----
    // Large venue spread may indicate dislocated pricing
    if (features.venueSpread > 0.003) {
      // 0.3%
      const confidence = Math.min(0.7, 0.3 + features.venueSpread * 50);
      // Determine direction: buy on cheaper venue
      const aPrice = snapshot.aerodrome?.price ?? 0;
      const uPrice = snapshot.uniswap?.price ?? 0;
      const direction =
        aPrice > 0 && uPrice > 0
          ? aPrice < uPrice
            ? "long"
            : "short"
          : "neutral";
      return { regime: "mean_reversion", confidence, direction, features };
    }

    // ----- Default: no clear signal -----
    return {
      regime: "no_trade",
      confidence: 0.5,
      direction: "neutral",
      features,
    };
  }

  // ---- Feature extraction -------------------------------------------------

  private extractFeatures(
    history: PriceHistory,
    snapshot: PriceSnapshot,
  ): RegimeFeatures {
    const { prices, volumes } = history;
    const n = prices.length;

    if (n < 2) {
      return {
        volatility: 0,
        trendStrength: 0,
        zScore: 0,
        venueSpread: snapshot.spread,
        volumeTrend: 1,
        dataPoints: n,
      };
    }

    // Realised volatility (annualised, assuming ~15s polling → ~5760 samples/day)
    const rets = returns(prices);
    const retStd = stdDev(rets);
    const volatility = retStd * Math.sqrt(5760) * 100; // annualised %

    // Trend strength: linear regression slope normalised by price level
    const trendStrength = this.linearTrendStrength(prices);

    // Z-score: current price vs 20-period SMA
    const lookback = Math.min(20, n);
    const recentSlice = prices.slice(n - lookback);
    const sma = mean(recentSlice);
    const smaStd = stdDev(recentSlice);
    const zScore = smaStd > 0 ? (prices[n - 1] - sma) / smaStd : 0;

    // Volume trend: recent average vs older average
    let volumeTrend = 1;
    if (volumes.length >= 10) {
      const recentVol = mean(volumes.slice(-5));
      const olderVol = mean(volumes.slice(-10, -5));
      volumeTrend = olderVol > 0 ? recentVol / olderVol : 1;
    }

    return {
      volatility,
      trendStrength,
      zScore,
      venueSpread: snapshot.spread,
      volumeTrend,
      dataPoints: n,
    };
  }

  /**
   * Compute normalised linear regression slope as a trend strength indicator.
   * Returns a value roughly in [-1, 1] for typical market data.
   */
  private linearTrendStrength(prices: number[]): number {
    const n = prices.length;
    if (n < 3) return 0;

    // Use last 30 data points max
    const window = Math.min(30, n);
    const slice = prices.slice(n - window);
    const m = mean(slice);

    let sumXY = 0;
    let sumXX = 0;
    const xMean = (window - 1) / 2;

    for (let i = 0; i < window; i++) {
      const dx = i - xMean;
      sumXY += dx * (slice[i] - m);
      sumXX += dx * dx;
    }

    const slope = sumXX > 0 ? sumXY / sumXX : 0;
    // Normalise by price level and window size to get a unitless strength
    const normSlope = (slope * window) / (m || 1);
    // Clamp to [-2, 2] then scale to roughly [-1, 1]
    return Math.max(-2, Math.min(2, normSlope));
  }
}
