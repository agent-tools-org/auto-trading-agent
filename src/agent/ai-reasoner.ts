import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "../config.js";
import type { RegimeSignal, RegimeFeatures } from "../strategy/regime-detector.js";
import type { PriceSnapshot } from "../data/price-feed.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasonerInput {
  pair: string;
  snapshot: PriceSnapshot;
  regime: RegimeSignal;
  currentPositionDir: "long" | "short" | null;
  currentEquityUsd: number;
  drawdownPct: number;
  consecutiveLosses: number;
}

export interface ReasonerOutput {
  decision: "approve" | "reject";
  confidence: number; // 0-1
  sizeMultiplier: number; // 0.0 to 1.5
  explanation: string;
  riskFlags: string[];
}

// ---------------------------------------------------------------------------
// AI Reasoner
// ---------------------------------------------------------------------------

export class AIReasoner {
  private client: Anthropic | null = null;

  constructor() {
    if (ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    }
  }

  async evaluate(input: ReasonerInput): Promise<ReasonerOutput> {
    // If no API key, use deterministic fallback
    if (!this.client) {
      return this.deterministicFallback(input);
    }

    try {
      return await this.llmEvaluate(input);
    } catch (err) {
      console.error("[AIReasoner] LLM call failed, using fallback:", err);
      return this.deterministicFallback(input);
    }
  }

  // ---- LLM evaluation ----------------------------------------------------

  private async llmEvaluate(input: ReasonerInput): Promise<ReasonerOutput> {
    const systemPrompt = `You are a quantitative trading risk analyst for an autonomous trading agent operating on Base L2. You analyze market conditions and trade proposals to decide whether to approve or reject trades.

You must respond with ONLY valid JSON matching this schema:
{
  "decision": "approve" | "reject",
  "confidence": number (0 to 1),
  "sizeMultiplier": number (0.0 to 1.5),
  "explanation": string (1-3 sentences),
  "riskFlags": string[] (list of concerns, empty if none)
}

Guidelines:
- Reject trades in no_trade regime or when confidence is below 0.3
- Reduce sizeMultiplier when volatility is extreme or drawdown is high
- Flag concerns about consecutive losses, low liquidity, or unusual spread
- Approve with high confidence only when regime is clear and risk metrics are healthy
- Be conservative: preserving capital is more important than catching every opportunity`;

    const userPrompt = `Evaluate this trade proposal:

Pair: ${input.pair}
Market Regime: ${input.regime.regime} (confidence: ${input.regime.confidence.toFixed(2)})
Signal Direction: ${input.regime.direction}
Current Position: ${input.currentPositionDir ?? "none"}

Market Features:
- Volatility: ${input.regime.features.volatility.toFixed(1)}% (annualised)
- Trend Strength: ${input.regime.features.trendStrength.toFixed(3)}
- Z-Score: ${input.regime.features.zScore.toFixed(2)}
- Venue Spread: ${(input.regime.features.venueSpread * 100).toFixed(4)}%
- Volume Trend: ${input.regime.features.volumeTrend.toFixed(2)}
- Data Points: ${input.regime.features.dataPoints}

Prices:
- Aerodrome: ${input.snapshot.aerodrome?.price?.toFixed(4) ?? "N/A"}
- Uniswap: ${input.snapshot.uniswap?.price?.toFixed(4) ?? "N/A"}

Portfolio:
- Equity: $${input.currentEquityUsd.toFixed(2)}
- Drawdown: ${input.drawdownPct.toFixed(2)}%
- Consecutive Losses: ${input.consecutiveLosses}

Should this trade be approved? Respond with JSON only.`;

    const response = await this.client!.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: systemPrompt,
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return this.parseResponse(text);
  }

  private parseResponse(text: string): ReasonerOutput {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        decision: parsed.decision === "approve" ? "approve" : "reject",
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        sizeMultiplier: Math.max(
          0,
          Math.min(1.5, Number(parsed.sizeMultiplier) || 1),
        ),
        explanation: String(parsed.explanation || "No explanation provided"),
        riskFlags: Array.isArray(parsed.riskFlags)
          ? parsed.riskFlags.map(String)
          : [],
      };
    } catch (err) {
      console.error("[AIReasoner] Failed to parse LLM response:", text);
      return {
        decision: "reject",
        confidence: 0.1,
        sizeMultiplier: 0,
        explanation: "Failed to parse AI response — rejecting for safety",
        riskFlags: ["parse_error"],
      };
    }
  }

  // ---- Deterministic fallback ---------------------------------------------

  private deterministicFallback(input: ReasonerInput): ReasonerOutput {
    const { regime, features } = input.regime;

    // No-trade regime → always reject
    if (regime === "no_trade") {
      return {
        decision: "reject",
        confidence: 0.6,
        sizeMultiplier: 0,
        explanation: `No-trade regime detected. Volatility: ${features.volatility.toFixed(1)}%, ` +
          `trend: ${features.trendStrength.toFixed(3)}, z-score: ${features.zScore.toFixed(2)}`,
        riskFlags: ["no_trade_regime"],
      };
    }

    // Collect risk flags
    const riskFlags: string[] = [];
    let sizeMultiplier = 1.0;

    // High drawdown → reduce or reject
    if (input.drawdownPct > 3) {
      sizeMultiplier *= 0.5;
      riskFlags.push("high_drawdown");
    }
    if (input.drawdownPct > 4) {
      return {
        decision: "reject",
        confidence: 0.7,
        sizeMultiplier: 0,
        explanation: `Drawdown too high at ${input.drawdownPct.toFixed(2)}%`,
        riskFlags: ["critical_drawdown"],
      };
    }

    // Consecutive losses → reduce size
    if (input.consecutiveLosses >= 2) {
      sizeMultiplier *= 0.5;
      riskFlags.push("consecutive_losses");
    }

    // Very high volatility → reduce size
    if (features.volatility > 80) {
      sizeMultiplier *= 0.7;
      riskFlags.push("high_volatility");
    }

    // Low data → reduce confidence
    if (features.dataPoints < 20) {
      sizeMultiplier *= 0.6;
      riskFlags.push("insufficient_data");
    }

    // Confidence threshold
    const confidence = input.regime.confidence * (sizeMultiplier > 0.3 ? 1 : 0.5);
    if (confidence < 0.3) {
      return {
        decision: "reject",
        confidence,
        sizeMultiplier: 0,
        explanation: `Confidence too low: ${confidence.toFixed(2)}`,
        riskFlags: [...riskFlags, "low_confidence"],
      };
    }

    const explanation =
      regime === "momentum"
        ? `Momentum ${input.regime.direction}: trend=${features.trendStrength.toFixed(3)}, ` +
          `vol=${features.volatility.toFixed(1)}%, confidence=${confidence.toFixed(2)}`
        : `Mean-reversion ${input.regime.direction}: z=${features.zScore.toFixed(2)}, ` +
          `spread=${(features.venueSpread * 100).toFixed(4)}%, confidence=${confidence.toFixed(2)}`;

    return {
      decision: "approve",
      confidence,
      sizeMultiplier: Math.max(0.1, Math.min(1.5, sizeMultiplier)),
      explanation,
      riskFlags,
    };
  }
}
