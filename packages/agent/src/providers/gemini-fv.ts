/**
 * Gemini Fair Value Provider (Simplified)
 *
 * Thin provider: prompt construction + Gemini API call + response parsing.
 * Caching, rate limiting, cooldowns, and flow tracking are handled by
 * FairValueService at the runtime level.
 *
 * General-purpose FV for non-sports markets using Gemini with Google Search grounding.
 * Skips sports markets (detected by league extraction).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";
import { extractLeagueFromQuestion } from "../signals/espn.js";

// ─── Types ───

export interface GeminiFairValueOptions {
  /** Google AI API key. Falls back to GEMINI_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: "gemini-3-pro-preview" */
  model?: string;
  /** How long to cache this estimate (ms). Returned as cacheTtlMs hint. Default: 3600000 (1hr). */
  recalcIntervalMs?: number;
  /** Fallback FV if LLM fails (cents). Default: 50 */
  fallbackCents?: number;
}

// ─── Provider ───

export class GeminiFairValue implements FairValueProvider {
  readonly name = "Gemini Fair Value";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly recalcIntervalMs: number;
  private readonly fallbackCents: number;

  constructor(options: GeminiFairValueOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || "gemini-3-pro-preview";
    this.recalcIntervalMs = options.recalcIntervalMs ?? 60 * 60 * 1000;
    this.fallbackCents = options.fallbackCents ?? 50;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { market } = snapshot;
    const title = market.title || (market as any).question || "";

    // Skip sports markets — those use VegasFairValue
    const league = extractLeagueFromQuestion(title);
    if (league) {
      return { yesCents: this.fallbackCents, confidence: 0 };
    }

    const result = await this.callGemini(snapshot);

    if (result) {
      console.log(
        `[gemini-fv] ${title.slice(0, 45)}... → FV=${result.yesCents}¢ (${result.reasoning.slice(0, 80)})`,
      );
      return {
        yesCents: result.yesCents,
        confidence: result.confidence,
        reasoning: result.reasoning,
        cacheTtlMs: this.recalcIntervalMs,
      };
    }

    // LLM failed — return fallback
    return { yesCents: this.fallbackCents, confidence: 0.2 };
  }

  // ─── Gemini LLM Call ───

  private async callGemini(
    snapshot: MarketSnapshot,
  ): Promise<{ yesCents: number; confidence: number; reasoning: string } | null> {
    if (!this.apiKey) {
      console.error("[gemini-fv] No GEMINI_API_KEY set");
      return null;
    }

    const { market, oracleSignals, orderbook } = snapshot;
    const title = market.title || (market as any).question || "";
    const description = market.description || (market as any).resolutionCriteria || "";

    // Build oracle evidence summary
    const oracleEvidence = oracleSignals.length > 0
      ? oracleSignals
        .map((s) => `[${s.source}] confidence=${s.confidence} outcome=${s.outcome ?? "unknown"}\n  ${s.evidence ?? "No evidence text"}`)
        .join("\n\n")
      : "No oracle signals available.";

    // Current market price (midpoint of best bid/ask)
    const bestBid = orderbook.bids?.[0]?.price ?? 0;
    const bestAsk = orderbook.asks?.[0]?.price ?? 0;
    const midpoint = bestBid && bestAsk
      ? Math.round((bestBid + bestAsk) / 2)
      : bestBid || bestAsk || 50;

    const prompt = `You are a probability analyst for prediction markets. Your job is to estimate the probability that a market question resolves YES.

MARKET QUESTION: ${title}
${description ? `DESCRIPTION/RESOLUTION CRITERIA: ${description}` : ""}

ORACLE EVIDENCE:
${oracleEvidence}

CURRENT MARKET PRICE: ${midpoint}¢ (out of 100¢)

Instructions:
- Use your knowledge and any search results to assess the current probability.
- Consider base rates, current evidence, time horizon, and any recent developments.
- Be well-calibrated: use extreme values (1-10 or 90-99) only when evidence is strong.
- Do NOT anchor too heavily on the current market price — form your own independent view.

Think through your analysis, then output your final answer as a JSON object on the LAST line of your response:
{"yesCents": <integer 1-99>, "confidence": <float 0.0-1.0>, "reasoning": "<2-3 sentences>"}

The JSON line MUST be the last thing you output.`;

    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({ model: this.model });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16384,
        },
        // Enable Google Search grounding
        tools: [{ googleSearch: {} }] as any,
      });

      const candidate = result.response.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      let text = "";
      for (const part of parts) {
        if ((part as any).text) {
          text += (part as any).text;
        }
      }
      text = text.trim();

      return this.parseResponse(text);
    } catch (error: any) {
      console.error("[gemini-fv] API error:", error);
      return null;
    }
  }

  private parseResponse(text: string): { yesCents: number; confidence: number; reasoning: string } | null {
    try {
      let jsonText = text;

      // Handle markdown code blocks
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      // Try to find JSON object containing yesCents
      if (!jsonText.startsWith("{")) {
        const jsonMatch = jsonText.match(/\{[\s\S]*?"yesCents"[\s\S]*?\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      // Still no JSON? Gemini 3 Pro with thinking may bury it at the end. Try harder.
      if (!jsonText.includes("yesCents")) {
        const anyJson = text.match(/\{\s*"yesCents"\s*:\s*\d+[\s\S]*?\}/);
        if (anyJson) {
          jsonText = anyJson[0];
        }
      }

      // Try the last line — we prompt the model to put JSON as the final line
      if (!jsonText.includes("yesCents")) {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
          if (lines[i].startsWith("{") && lines[i].includes("yesCents")) {
            jsonText = lines[i];
            break;
          }
        }
      }

      const parsed = JSON.parse(jsonText);

      const yesCents = clamp(Math.round(parsed.yesCents ?? 50), 1, 99);
      const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
      const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

      return { yesCents, confidence, reasoning };
    } catch (error) {
      // Last resort: extract probability from Gemini's verbose prose output.
      const probMatch =
        text.match(/yesCents[:\s"]+(\d{1,2})/i)
        || text.match(/estimated\s+(?:to be\s+|at\s+)\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%/i)
        || text.match(/\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%\s*\*?\*?\s*(?:probability|chance|likely|likelihood)/i)
        || text.match(/(?:probability|chance|likelihood)\s+(?:of\s+|is\s+|at\s+|=\s*)?\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%/i)
        || text.match(/(\d{1,2})(?:\.\d+)?%\s*chance/i)
        || text.match(/\*\*(\d{1,2})(?:\.\d+)?%\*\*/);

      if (probMatch) {
        const yesCents = clamp(parseInt(probMatch[1]), 1, 99);
        console.log(`[gemini-fv] Extracted from text: ${yesCents}¢`);
        return { yesCents, confidence: 0.5, reasoning: text.slice(0, 200) };
      }

      const allPercents = [...text.matchAll(/\b(\d{1,2})(?:\.\d+)?%/g)];
      if (allPercents.length === 1) {
        const yesCents = clamp(parseInt(allPercents[0][1]), 1, 99);
        console.log(`[gemini-fv] Extracted lone percentage: ${yesCents}¢`);
        return { yesCents, confidence: 0.4, reasoning: text.slice(0, 200) };
      }

      console.error("[gemini-fv] Failed to parse response. First 300 chars:", text.slice(0, 300));
      console.error("[gemini-fv] Last 300 chars:", text.slice(-300));
      return null;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
