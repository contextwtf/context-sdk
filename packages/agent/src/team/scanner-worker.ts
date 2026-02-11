/**
 * scanner-worker.ts — Stateless one-shot LLM research function.
 *
 * NOT an agent with a loop. Chief dispatches it fire-and-forget:
 *   dispatchScanner(dispatch, llmClient).then(result => queue.push(scanner_result))
 *
 * Uses LlmClient.chat() directly for structured tool calling.
 * Returns structured JSON findings.
 */

import type { LlmClient, ToolDefinition, ChatMessage } from "../llm/client.js";
import type { ScannerDispatch, ScannerResult, ScannerFinding } from "./types-v2.js";

// ─── Types ───

export interface MarketContext {
  id: string;
  name: string;
  resolutionCriteria?: string;
  category?: string;
}

// ─── System Prompt ───

const SCANNER_SYSTEM = `You are a fast research scanner for a prediction market making desk.

Your ONLY job: search the web for facts about prediction markets, then return structured JSON findings.

## Workflow
1. Read the market questions below
2. Use web_search to find current facts (scores, prices, news, data)
3. Return ONE JSON object with your findings

## CRITICAL: Output Format

You MUST end your response with exactly this JSON structure:
{"findings":[{"marketId":"...","type":"...","data":{...},"confidence":0.0,"source":"...","suggestedFairValue":50}]}

Field definitions:
- marketId: the exact market ID string given to you
- type: one of "score_update", "correction", "verification", "news", "data_release"
- data: object with key facts (e.g. {"score":"Lakers 110, Celtics 98","quarter":"Q4"})
- confidence: 0.0 to 1.0 — how sure you are of the facts
- source: URL or name of source (e.g. "ESPN", "Reuters", "BLS.gov")
- suggestedFairValue: probability in cents 1-99 (e.g. 75 means 75% likely YES). ONLY include if you found concrete evidence.

## Example

For a market "Will Lakers beat Celtics tonight?":
{"findings":[{"marketId":"0xabc123","type":"score_update","data":{"score":"Lakers 95, Celtics 88","quarter":"Q3 4:32","source_url":"https://espn.com/nba/game/123"},"confidence":0.9,"source":"ESPN","suggestedFairValue":82}]}

## Rules
- Search for EACH market separately if they are unrelated topics
- If a market question is unclear from the name, search for the exact market name
- Always return valid JSON — no markdown, no code fences, no explanation after the JSON
- If you find nothing for a market, include it with type "verification", confidence 0.3, and no suggestedFairValue
- Be fast: 1-2 searches per market, move on`;

// ─── Core ───

/**
 * Dispatch a scanner task. Runs LLM with tools, returns structured findings.
 *
 * @param dispatch — what to research (markets, focus, tools, limits)
 * @param llmClient — LLM client to use
 * @param tools — tool definitions available to the scanner
 * @param executeTool — function that executes a tool call and returns result string
 * @param marketContexts — optional market names/details so scanner can search effectively
 */
export async function dispatchScanner(
  dispatch: ScannerDispatch,
  llmClient: LlmClient,
  tools: ToolDefinition[],
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>,
  marketContexts?: MarketContext[],
): Promise<ScannerResult> {
  const startTime = Date.now();
  let toolCallsUsed = 0;

  const userPrompt = buildUserPrompt(dispatch, marketContexts);

  const messages: ChatMessage[] = [
    { role: "user", content: userPrompt },
  ];

  // Multi-turn tool loop
  for (let turn = 0; turn < dispatch.maxToolCalls + 1; turn++) {
    // Check timeout
    if (Date.now() - startTime > dispatch.timeout) {
      console.log(`[scanner] Task ${dispatch.taskId} timed out after ${dispatch.timeout}ms`);
      break;
    }

    const response = await llmClient.chat({
      model: "kimi-k2.5", // Scanner always uses routine model
      system: SCANNER_SYSTEM,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      maxTokens: 2048,
    });

    // If no tool calls, we have the final response
    if (!response.hasToolCalls) {
      const findings = parseFindings(response.text, dispatch.markets);
      return {
        taskId: dispatch.taskId,
        findings,
        toolCallsUsed,
        durationMs: Date.now() - startTime,
      };
    }

    // Execute tool calls
    messages.push(response.message);

    const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];

    for (const tc of response.toolCalls) {
      toolCallsUsed++;
      if (toolCallsUsed > dispatch.maxToolCalls) {
        // Still respond to ALL tool calls (Kimi requires it), but skip execution
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: "Tool call limit reached. Provide your findings now.",
        });
        continue; // Don't break — must respond to every tool_call_id
      }

      try {
        const result = await executeTool(tc.name, tc.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result.slice(0, 4000), // Cap tool result length
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // If we exhausted turns without a final response, return empty
  return {
    taskId: dispatch.taskId,
    findings: [],
    toolCallsUsed,
    durationMs: Date.now() - startTime,
  };
}

// ─── Helpers ───

function buildUserPrompt(dispatch: ScannerDispatch, contexts?: MarketContext[]): string {
  const contextMap = new Map<string, MarketContext>();
  if (contexts) {
    for (const ctx of contexts) contextMap.set(ctx.id, ctx);
  }

  const lines = [
    `## Research Task`,
    `${dispatch.focus}`,
    ``,
    `## Markets to Research`,
  ];

  for (const marketId of dispatch.markets) {
    const ctx = contextMap.get(marketId);
    if (ctx) {
      lines.push(`- ID: ${marketId}`);
      lines.push(`  Question: "${ctx.name}"`);
      if (ctx.resolutionCriteria) lines.push(`  Resolution: ${ctx.resolutionCriteria}`);
      if (ctx.category) lines.push(`  Category: ${ctx.category}`);
    } else {
      lines.push(`- ID: ${marketId}`);
    }
  }

  lines.push(``);
  lines.push(`Use web_search to find current facts for each market. ${dispatch.maxToolCalls} tool calls max.`);
  lines.push(``);
  lines.push(`IMPORTANT: End your response with a single JSON object: {"findings":[...]}`);
  lines.push(`Include one finding per market. Use the exact market ID in each finding.`);

  return lines.join("\n");
}

function parseFindings(text: string, marketIds: string[]): ScannerFinding[] {
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    console.log(`[scanner] Could not extract JSON from response (${text.length} chars). First 200: ${text.slice(0, 200)}`);
    return [];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const findings = parsed.findings ?? (Array.isArray(parsed) ? parsed : []);

    return findings
      .filter((f: any) => f && typeof f === "object")
      .map((f: any): ScannerFinding => ({
        marketId: f.marketId ?? f.market_id ?? marketIds[0] ?? "unknown",
        type: f.type ?? "verification",
        data: f.data ?? {},
        confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
        source: f.source ?? "unknown",
        suggestedFairValue: typeof f.suggestedFairValue === "number"
          ? Math.max(1, Math.min(99, Math.round(f.suggestedFairValue)))
          : typeof f.suggested_fair_value === "number"
            ? Math.max(1, Math.min(99, Math.round(f.suggested_fair_value)))
            : undefined,
      }));
  } catch (err) {
    console.log(`[scanner] JSON parse error: ${err instanceof Error ? err.message : err}`);
    console.log(`[scanner] Attempted to parse: ${jsonStr.slice(0, 300)}`);
    return [];
  }
}

/** Extract JSON from LLM output. Tries multiple patterns. */
function extractJson(text: string): string | null {
  // 1. Code fence: ```json ... ```
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Code fence without language: ``` ... ```
  const plainFenceMatch = text.match(/```\s*([\s\S]*?)```/);
  if (plainFenceMatch) {
    const inner = plainFenceMatch[1].trim();
    if (inner.startsWith("{") || inner.startsWith("[")) return inner;
  }

  // 3. Raw JSON object with "findings" key anywhere in text
  const findingsMatch = text.match(/(\{"findings"\s*:\s*\[[\s\S]*\][\s\S]*?\})/);
  if (findingsMatch) return findingsMatch[1];

  // 4. Last JSON object in the text (scanner was told to end with JSON)
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace >= 0) {
    // Walk backwards to find the matching opening brace
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      if (text[i] === "{") depth--;
      if (depth === 0) {
        const candidate = text.slice(i, lastBrace + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // Not valid JSON, keep looking
        }
        break;
      }
    }
  }

  // 5. Try the whole text as JSON
  try {
    JSON.parse(text.trim());
    return text.trim();
  } catch {
    // Not JSON
  }

  return null;
}
