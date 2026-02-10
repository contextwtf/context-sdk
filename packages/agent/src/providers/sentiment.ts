/**
 * Sentiment Fair Value Provider
 *
 * General-purpose LLM-based fair value estimation. Unlike LlmFairValue (sports-specific
 * with ESPN/Vegas enrichment), this works for any market type: politics, crypto,
 * entertainment, tech, geopolitics, etc.
 *
 * Simply reads the market question + oracle evidence and asks Haiku to reason
 * about the probability. No signal enrichment — just the question and evidence.
 *
 * SDK improvements surfaced:
 * - FairValueEstimate lacks reasoning — { yesCents, confidence } doesn't carry the
 *   LLM's reasoning. Adding `reasoning?: string` and `metadata?: Record<string, unknown>`
 *   to FairValueEstimate would improve logging for any LLM-based provider.
 * - No market filtering by type — both this and sports agents scan all markets but
 *   only care about their subset. A MarketFilter predicate on MarketSelector would
 *   be cleaner than filtering inside evaluate().
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";

// ─── Types ───

export interface SentimentFairValueOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: "claude-haiku-4-5-20251001". */
  model?: string;
  /** Cache TTL in ms. Default: 300_000 (5 min). */
  cacheTtlMs?: number;
  /** Fallback FV in cents if LLM call fails. Default: 50. */
  fallbackCents?: number;
}

interface CacheEntry {
  estimate: FairValueEstimate;
  reasoning: string;
  timestamp: number;
}

// ─── Provider ───

export class SentimentFairValue implements FairValueProvider {
  readonly name = "Sentiment Fair Value";

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly cacheTtlMs: number;
  private readonly fallbackCents: number;

  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: SentimentFairValueOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || "claude-haiku-4-5-20251001";
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.fallbackCents = options.fallbackCents ?? 50;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { market } = snapshot;

    // Check cache
    const cached = this.cache.get(market.id);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.estimate;
    }

    try {
      const prompt = this.buildPrompt(snapshot);
      const result = await this.callLlm(prompt);

      // Cache result
      this.cache.set(market.id, {
        estimate: result.estimate,
        reasoning: result.reasoning,
        timestamp: Date.now(),
      });

      this.logEstimate(snapshot, result);
      return result.estimate;
    } catch (error) {
      console.error(`[sentiment-fv] Error estimating ${market.id}:`, error);
      return { yesCents: this.fallbackCents, confidence: 0.3 };
    }
  }

  // ─── Prompt ───

  private buildPrompt(snapshot: MarketSnapshot): string {
    const { market, oracleSignals, orderbook } = snapshot;
    const title = market.title || (market as any).question || "Unknown market";

    const parts: string[] = [
      `You are a probability analyst for prediction markets.

MARKET QUESTION: ${title}${market.description ? `\nDESCRIPTION: ${market.description}` : ""}`,
    ];

    // Resolution date if available
    if ((market as any).resolutionDate || (market as any).endDate) {
      parts.push(`RESOLUTION DATE: ${(market as any).resolutionDate || (market as any).endDate}`);
    }

    // Oracle evidence
    if (oracleSignals.length > 0) {
      parts.push(`\nORACLE EVIDENCE:`);
      for (const signal of oracleSignals.slice(0, 5)) {
        const conf = typeof signal.confidence === "number"
          ? ` (confidence: ${(signal.confidence * 100).toFixed(0)}%)`
          : "";
        parts.push(`  [${signal.source}]${conf}${signal.evidence ? `\n    ${signal.evidence.slice(0, 300)}` : ""}`);
      }
    }

    // Current market price
    const bestBid = orderbook.bids[0];
    const bestAsk = orderbook.asks[0];
    if (bestBid || bestAsk) {
      const bidCents = bestBid ? Math.round(bestBid.price) : "—";
      const askCents = bestAsk ? Math.round(bestAsk.price) : "—";
      const mid = bestBid && bestAsk
        ? Math.round((bestBid.price + bestAsk.price) / 2)
        : "—";
      parts.push(`\nCURRENT MARKET PRICE: Best bid ${bidCents}¢, Best ask ${askCents}¢ (midpoint: ${mid}¢)`);
    }

    parts.push(`
Estimate the probability this resolves YES.
Consider: base rates, current evidence strength, time until resolution.

Respond with ONLY this JSON:
{
  "estimate": <number 1-99, probability YES wins>,
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-3 sentences explaining your estimate>"
}`);

    return parts.join("\n");
  }

  // ─── LLM Call ───

  private async callLlm(prompt: string): Promise<{
    estimate: FairValueEstimate;
    reasoning: string;
  }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[sentiment-fv] Failed to parse JSON: ${text.slice(0, 200)}`);
      return {
        estimate: { yesCents: this.fallbackCents, confidence: 0.3 },
        reasoning: "Failed to parse LLM response",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      const yesCents = typeof parsed.estimate === "number"
        ? Math.max(1, Math.min(99, Math.round(parsed.estimate)))
        : this.fallbackCents;

      const confidenceMap: Record<string, number> = {
        high: 0.9,
        medium: 0.7,
        low: 0.4,
      };
      const confidence = confidenceMap[parsed.confidence] ?? 0.5;

      return {
        estimate: { yesCents, confidence },
        reasoning: parsed.reasoning || "",
      };
    } catch {
      const estimateMatch = text.match(/"estimate"\s*:\s*(\d+(?:\.\d+)?)/);
      const yesCents = estimateMatch
        ? Math.max(1, Math.min(99, Math.round(parseFloat(estimateMatch[1]))))
        : this.fallbackCents;

      return {
        estimate: { yesCents, confidence: 0.4 },
        reasoning: "Partial parse of LLM response",
      };
    }
  }

  // ─── Logging ───

  private logEstimate(
    snapshot: MarketSnapshot,
    result: { estimate: FairValueEstimate; reasoning: string },
  ) {
    const title = (snapshot.market.title || (snapshot.market as any).question || "Unknown").slice(0, 50);
    const id = snapshot.market.id.slice(0, 10);
    const fv = result.estimate.yesCents;
    const conf = result.estimate.confidence >= 0.8 ? "high"
      : result.estimate.confidence >= 0.6 ? "med" : "low";

    const bestBid = snapshot.orderbook.bids[0];
    const bestAsk = snapshot.orderbook.asks[0];
    const mid = bestBid && bestAsk
      ? Math.round((bestBid.price + bestAsk.price) / 2)
      : "—";

    console.log(
      `[sentiment-fv] ${title}... (${id}): FV=${fv}¢ (${conf}), mid=${mid}¢ — ${result.reasoning.slice(0, 80)}`,
    );
  }
}
