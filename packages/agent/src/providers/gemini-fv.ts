/**
 * Gemini Fair Value Provider
 *
 * General-purpose FV for non-sports markets using Gemini with Google Search grounding.
 * Reads market question, description, resolution criteria, and oracle signals to estimate
 * probability. Designed for markets like politics, crypto, entertainment, tech, geopolitics.
 *
 * Key behaviors:
 * - Initial FV set via Gemini 3 Pro with search grounding on first call
 * - Recalculates via LLM once per hour (not every cycle)
 * - Between recalculations, FV adjusts to order flow (fill-based drift)
 * - Hourly recalculations blend LLM signal + accumulated flow signal (doesn't reset)
 * - Skips sports markets (detected by league extraction)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Fill } from "@context-markets/sdk";
import type { FairValueProvider, FairValueEstimate } from "../fair-value.js";
import type { MarketSnapshot } from "../strategy.js";
import { extractLeagueFromQuestion } from "../signals/espn.js";

// ─── Types ───

interface GeminiFvCache {
  /** LLM-derived fair value (cents) */
  llmFV: number;
  /** LLM confidence (0-1) */
  llmConfidence: number;
  /** LLM reasoning for logging */
  reasoning: string;
  /** Current effective FV after flow adjustments (cents) */
  effectiveFV: number;
  /** Accumulated flow pressure: positive = buy pressure (pushes FV up), negative = sell */
  flowPressure: number;
  /** Number of fills since last LLM recalculation */
  fillsSinceRecalc: number;
  /** Timestamp of last LLM call */
  lastLlmCall: number;
}

export interface GeminiFairValueOptions {
  /** Google AI API key. Falls back to GEMINI_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Default: "gemini-3-pro-preview" */
  model?: string;
  /** How often to recalculate via LLM (ms). Default: 3600000 (1 hour). */
  recalcIntervalMs?: number;
  /** How much each fill shifts FV (cents per contract). Default: 0.02 */
  flowImpactPerContract?: number;
  /** Maximum FV drift from flow between recalculations (cents). Default: 8 */
  maxFlowDriftCents?: number;
  /** How much weight the LLM gets vs accumulated flow on recalculation (0-1). Default: 0.7 */
  llmWeightOnRecalc?: number;
  /** Fallback FV if LLM fails (cents). Default: 50 */
  fallbackCents?: number;
  /** Minimum ms between Gemini API calls across all markets (stagger). Default: 20000 (20s). */
  minCallIntervalMs?: number;
}

// ─── Provider ───

export class GeminiFairValue implements FairValueProvider {
  readonly name = "Gemini Fair Value";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly recalcIntervalMs: number;
  private readonly flowImpactPerContract: number;
  private readonly maxFlowDriftCents: number;
  private readonly llmWeightOnRecalc: number;
  private readonly fallbackCents: number;

  /** Per-market FV cache */
  private readonly cache = new Map<string, GeminiFvCache>();

  /** Pending fills to process (buffered between cycles) */
  private readonly pendingFills: Fill[] = [];

  /** Global rate limiter: timestamp of last Gemini API call */
  private lastGeminiCallTime = 0;
  /** True while a Gemini call is in flight — blocks other markets from calling */
  private geminiCallInFlight = false;
  /** Minimum ms between Gemini API calls (stagger across markets). Default: 20s */
  private readonly minCallIntervalMs: number;

  /** Per-market timeout tracking: marketId → { lastTimeout, consecutiveTimeouts } */
  private readonly timeoutHistory = new Map<string, { lastTimeout: number; consecutive: number }>();
  /** Base cooldown after a timeout (ms). Doubles for each consecutive timeout. */
  private readonly timeoutCooldownBaseMs = 5 * 60 * 1000; // 5 minutes
  /** Max cooldown cap (ms). */
  private readonly timeoutCooldownMaxMs = 30 * 60 * 1000; // 30 minutes

  constructor(options: GeminiFairValueOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || "gemini-3-pro-preview";
    this.recalcIntervalMs = options.recalcIntervalMs ?? 60 * 60 * 1000; // 1 hour
    this.flowImpactPerContract = options.flowImpactPerContract ?? 0.02;
    this.maxFlowDriftCents = options.maxFlowDriftCents ?? 8;
    this.llmWeightOnRecalc = options.llmWeightOnRecalc ?? 0.7;
    this.fallbackCents = options.fallbackCents ?? 50;
    this.minCallIntervalMs = options.minCallIntervalMs ?? 20_000;
  }

  async estimate(snapshot: MarketSnapshot): Promise<FairValueEstimate> {
    const { market } = snapshot;
    const title = market.title || (market as any).question || "";

    // Skip sports markets — those use VegasFairValue
    const league = extractLeagueFromQuestion(title);
    if (league) {
      return { yesCents: this.fallbackCents, confidence: 0 };
    }

    // Process any buffered fills for this market
    this.processPendingFills(market.id);

    const cached = this.cache.get(market.id);
    const now = Date.now();

    // Check if we need an LLM recalculation
    const needsRecalc = !cached || (now - cached.lastLlmCall >= this.recalcIntervalMs);

    if (needsRecalc) {
      // Timeout cooldown: if this market timed out recently, skip it to let others get slots.
      const timeoutInfo = this.timeoutHistory.get(market.id);
      if (timeoutInfo) {
        const cooldownMs = Math.min(
          this.timeoutCooldownBaseMs * Math.pow(2, timeoutInfo.consecutive - 1),
          this.timeoutCooldownMaxMs,
        );
        const elapsed = now - timeoutInfo.lastTimeout;
        if (elapsed < cooldownMs) {
          const remainMin = ((cooldownMs - elapsed) / 60_000).toFixed(1);
          if (cached) {
            return { yesCents: cached.effectiveFV, confidence: cached.llmConfidence * 0.8 };
          }
          const bestBid = snapshot.orderbook.bids?.[0]?.price ?? 0;
          const bestAsk = snapshot.orderbook.asks?.[0]?.price ?? 0;
          const mid = bestBid && bestAsk ? Math.round((bestBid + bestAsk) / 2) : this.fallbackCents;
          console.log(`[gemini-fv] COOLDOWN: ${title.slice(0, 45)}... (${timeoutInfo.consecutive}x timeout, ${remainMin}min left, using mid=${mid}¢)`);
          return { yesCents: mid, confidence: 0.2 };
        }
      }

      // Rate limit: only 1 Gemini call at a time + minimum interval between calls.
      // Gemini Pro can take 20-30s, so we block other markets while one is in flight.
      const timeSinceLastCall = now - this.lastGeminiCallTime;
      if (this.geminiCallInFlight || timeSinceLastCall < this.minCallIntervalMs) {
        // Another call is running or too soon — use cached FV or midpoint fallback
        if (cached) {
          return { yesCents: cached.effectiveFV, confidence: cached.llmConfidence * 0.9 };
        }
        const bestBid = snapshot.orderbook.bids?.[0]?.price ?? 0;
        const bestAsk = snapshot.orderbook.asks?.[0]?.price ?? 0;
        const mid = bestBid && bestAsk ? Math.round((bestBid + bestAsk) / 2) : this.fallbackCents;
        console.log(`[gemini-fv] DEFERRED: ${title.slice(0, 45)}... (waiting for slot, using mid=${mid}¢)`);
        return { yesCents: mid, confidence: 0.2 };
      }

      this.geminiCallInFlight = true;
      let result: { yesCents: number; confidence: number; reasoning: string } | null = null;
      try {
        result = await this.callGemini(snapshot, cached);
      } finally {
        this.geminiCallInFlight = false;
        this.lastGeminiCallTime = Date.now(); // Set AFTER call completes to enforce cooldown between calls
      }

      if (result) {
        // Successful call — clear any timeout cooldown for this market
        this.timeoutHistory.delete(market.id);

        // Blend LLM result with accumulated flow (if we have prior state)
        let effectiveFV: number;
        if (cached && cached.fillsSinceRecalc > 0) {
          // Hourly recalc: blend new LLM estimate with flow-adjusted FV
          const flowAdjustedFV = cached.effectiveFV;
          effectiveFV = Math.round(
            this.llmWeightOnRecalc * result.yesCents +
            (1 - this.llmWeightOnRecalc) * flowAdjustedFV,
          );
          console.log(
            `[gemini-fv] RECALC BLEND: ${title.slice(0, 45)}... LLM=${result.yesCents}¢ flow-adjusted=${flowAdjustedFV}¢ → blended=${effectiveFV}¢`,
          );
        } else {
          effectiveFV = result.yesCents;
          console.log(
            `[gemini-fv] INITIAL: ${title.slice(0, 45)}... → FV=${effectiveFV}¢ (${result.reasoning.slice(0, 80)})`,
          );
        }

        const entry: GeminiFvCache = {
          llmFV: result.yesCents,
          llmConfidence: result.confidence,
          reasoning: result.reasoning,
          effectiveFV: clamp(effectiveFV, 1, 99),
          flowPressure: 0, // Reset flow pressure after recalc
          fillsSinceRecalc: 0,
          lastLlmCall: now,
        };
        this.cache.set(market.id, entry);

        return { yesCents: entry.effectiveFV, confidence: entry.llmConfidence };
      }

      // LLM failed — use cached if available, otherwise fallback
      if (cached) {
        return { yesCents: cached.effectiveFV, confidence: cached.llmConfidence * 0.8 };
      }
      return { yesCents: this.fallbackCents, confidence: 0.2 };
    }

    // Between recalculations: return flow-adjusted FV
    return { yesCents: cached!.effectiveFV, confidence: cached!.llmConfidence };
  }

  onFill(fill: Fill): void {
    this.pendingFills.push(fill);
  }

  // ─── Flow Processing ───

  private processPendingFills(marketId: string): void {
    const cached = this.cache.get(marketId);
    if (!cached) return;

    // Process fills for this market
    const marketFills = this.pendingFills.filter(
      (f) => f.order.marketId === marketId,
    );

    if (marketFills.length === 0) return;

    for (const fill of marketFills) {
      const size = fill.fillSize || 1;
      const isBuy = fill.order.side === "buy";
      const isYes = fill.order.outcome === "yes";

      // Determine directional pressure on YES price
      // Buy YES or Sell NO → upward pressure
      // Sell YES or Buy NO → downward pressure
      const direction = (isBuy === isYes) ? 1 : -1;
      cached.flowPressure += direction * size * this.flowImpactPerContract;
      cached.fillsSinceRecalc++;
    }

    // Clamp flow drift
    cached.flowPressure = clamp(
      cached.flowPressure,
      -this.maxFlowDriftCents,
      this.maxFlowDriftCents,
    );

    // Update effective FV
    cached.effectiveFV = clamp(
      Math.round(cached.llmFV + cached.flowPressure),
      1,
      99,
    );

    if (marketFills.length > 0) {
      console.log(
        `[gemini-fv] FLOW: ${marketId.slice(0, 8)}... ${marketFills.length} fills → pressure=${cached.flowPressure > 0 ? "+" : ""}${cached.flowPressure.toFixed(1)}¢ effectiveFV=${cached.effectiveFV}¢`,
      );
    }

    // Remove processed fills
    for (let i = this.pendingFills.length - 1; i >= 0; i--) {
      if (this.pendingFills[i].order.marketId === marketId) {
        this.pendingFills.splice(i, 1);
      }
    }
  }

  // ─── Gemini LLM Call ───

  private async callGemini(
    snapshot: MarketSnapshot,
    prior: GeminiFvCache | undefined,
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

    // Prior context (if recalculating)
    const priorContext = prior
      ? `\nYour previous estimate was ${prior.llmFV}¢ (${prior.reasoning.slice(0, 200)}).
Since then, order flow has shifted the effective price by ${prior.flowPressure > 0 ? "+" : ""}${prior.flowPressure.toFixed(1)}¢ (${prior.fillsSinceRecalc} fills).
The current market midpoint is ${midpoint}¢.
Consider whether flow information and market price movement suggest your previous estimate should shift.`
      : "";

    const prompt = `You are a probability analyst for prediction markets. Your job is to estimate the probability that a market question resolves YES.

MARKET QUESTION: ${title}
${description ? `DESCRIPTION/RESOLUTION CRITERIA: ${description}` : ""}

ORACLE EVIDENCE:
${oracleEvidence}

CURRENT MARKET PRICE: ${midpoint}¢ (out of 100¢)
${priorContext}

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

      // Race the Gemini call against a 90s timeout
      const geminiPromise = model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16384,
        },
        // Enable Google Search grounding
        tools: [{ googleSearch: {} }] as any,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 90_000),
      );
      const result = await Promise.race([geminiPromise, timeoutPromise]);

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
      if (error?.message === "GEMINI_TIMEOUT") {
        // Record timeout for cooldown tracking
        const prev = this.timeoutHistory.get(market.id);
        const consecutive = (prev?.consecutive ?? 0) + 1;
        this.timeoutHistory.set(market.id, { lastTimeout: Date.now(), consecutive });
        const cooldownMin = Math.min(
          this.timeoutCooldownBaseMs * Math.pow(2, consecutive - 1),
          this.timeoutCooldownMaxMs,
        ) / 60_000;
        console.error(`[gemini-fv] Call timed out after 90s: ${title.slice(0, 50)} (${consecutive}x → cooldown ${cooldownMin.toFixed(0)}min)`);
      } else {
        console.error("[gemini-fv] API error:", error);
      }
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
        // Look for any JSON-like object with yesCents
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
      // Gemini 3 Pro with search grounding often returns analysis text instead of JSON.
      const probMatch =
        // "yesCents": 15 or yesCents: 15
        text.match(/yesCents[:\s"]+(\d{1,2})/i)
        // "estimated to be **1%**" or "estimated at 15%"
        || text.match(/estimated\s+(?:to be\s+|at\s+)\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%/i)
        // "N% probability/chance/likely/likelihood"
        || text.match(/\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%\s*\*?\*?\s*(?:probability|chance|likely|likelihood)/i)
        // "probability/chance of N%" or "probability is N%"
        || text.match(/(?:probability|chance|likelihood)\s+(?:of\s+|is\s+|at\s+|=\s*)?\*?\*?(\d{1,2})(?:\.\d+)?\*?\*?\s*%/i)
        // "N% chance" anywhere
        || text.match(/(\d{1,2})(?:\.\d+)?%\s*chance/i)
        // Bold percentage: **N%** (common Gemini pattern)
        || text.match(/\*\*(\d{1,2})(?:\.\d+)?%\*\*/);

      if (probMatch) {
        const yesCents = clamp(parseInt(probMatch[1]), 1, 99);
        console.log(`[gemini-fv] Extracted from text: ${yesCents}¢`);
        return { yesCents, confidence: 0.5, reasoning: text.slice(0, 200) };
      }

      // Ultimate fallback: if there's exactly one percentage in the entire response, use it
      const allPercents = [...text.matchAll(/\b(\d{1,2})(?:\.\d+)?%/g)];
      if (allPercents.length === 1) {
        const yesCents = clamp(parseInt(allPercents[0][1]), 1, 99);
        console.log(`[gemini-fv] Extracted lone percentage: ${yesCents}¢`);
        return { yesCents, confidence: 0.4, reasoning: text.slice(0, 200) };
      }

      // Log more context for debugging
      console.error("[gemini-fv] Failed to parse response. First 300 chars:", text.slice(0, 300));
      console.error("[gemini-fv] Last 300 chars:", text.slice(-300));
      return null;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
