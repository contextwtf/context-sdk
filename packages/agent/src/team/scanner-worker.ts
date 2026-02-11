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

// ─── System Prompt ───

const SCANNER_SYSTEM = `You are a research scanner for a prediction market making desk.

Your job: quickly gather facts about specific markets and return structured findings.
You have tools to search the web and check data sources.

## Output Format

After using tools, return your findings as JSON:
\`\`\`json
{
  "findings": [
    {
      "marketId": "the-market-id",
      "type": "score_update" | "correction" | "verification" | "news" | "data_release",
      "data": { "key facts here" },
      "confidence": 0.0-1.0,
      "source": "where you got this",
      "suggestedFairValue": 50
    }
  ]
}
\`\`\`

## Rules
- Be fast. Use minimum tool calls to get the answer.
- Always cite your source.
- If you can't find anything, return empty findings array.
- suggestedFairValue is in cents (1-99). Only include if you have high confidence.
- Distinguish between verified facts and speculation.`;

// ─── Core ───

/**
 * Dispatch a scanner task. Runs LLM with tools, returns structured findings.
 *
 * @param dispatch — what to research (markets, focus, tools, limits)
 * @param llmClient — LLM client to use
 * @param tools — tool definitions available to the scanner
 * @param executeTool — function that executes a tool call and returns result string
 */
export async function dispatchScanner(
  dispatch: ScannerDispatch,
  llmClient: LlmClient,
  tools: ToolDefinition[],
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>,
): Promise<ScannerResult> {
  const startTime = Date.now();
  let toolCallsUsed = 0;

  const userPrompt = buildUserPrompt(dispatch);

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
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: "Tool call limit reached. Provide your findings now.",
        });
        break;
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

function buildUserPrompt(dispatch: ScannerDispatch): string {
  const lines = [
    `## Research Task: ${dispatch.focus}`,
    ``,
    `Markets to research:`,
  ];

  for (const marketId of dispatch.markets) {
    lines.push(`- ${marketId}`);
  }

  lines.push(``);
  lines.push(`Be fast and focused. Use ${dispatch.maxToolCalls} tool calls maximum.`);
  lines.push(`Return your findings as structured JSON.`);

  return lines.join("\n");
}

function parseFindings(text: string, marketIds: string[]): ScannerFinding[] {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*"findings"[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    const findings = parsed.findings ?? [];

    return findings
      .filter((f: any) => f && typeof f === "object")
      .map((f: any): ScannerFinding => ({
        marketId: f.marketId ?? marketIds[0] ?? "unknown",
        type: f.type ?? "verification",
        data: f.data ?? {},
        confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
        source: f.source ?? "unknown",
        suggestedFairValue: typeof f.suggestedFairValue === "number" ? f.suggestedFairValue : undefined,
      }));
  } catch {
    return [];
  }
}
