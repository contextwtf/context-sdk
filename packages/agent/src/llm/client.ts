/**
 * LLM Client Abstraction
 *
 * Wraps Anthropic and Google AI behind a common interface so strategies can
 * switch models without changing calling code. Model routing is automatic:
 * model strings starting with "gemini-" use Google AI, everything else uses Anthropic.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Common Types ───

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  hasToolCalls: boolean;
  /** The full assistant message for conversation history. */
  message: ChatMessage;
  usage: { inputTokens: number; outputTokens: number };
}

// ─── Client Interface ───

export interface LlmClient {
  chat(options: ChatOptions): Promise<ChatResponse>;
}

// ─── Anthropic Implementation ───

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const params: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : m.content.map((b) => {
              if (b.type === "text") return { type: "text" as const, text: b.text };
              if (b.type === "tool_use") return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
              if (b.type === "tool_result") return { type: "tool_result" as const, tool_use_id: b.tool_use_id, content: b.content };
              return b as any;
            }),
      })),
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      }));
    }

    const response = await this.client.messages.create(params);

    // Extract text and tool calls from content blocks
    let text = "";
    const toolCalls: ToolCall[] = [];
    const contentBlocks: ContentBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
        contentBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        contentBlocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      hasToolCalls: toolCalls.length > 0,
      message: { role: "assistant", content: contentBlocks },
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

// ─── Gemini Implementation ───

export class GeminiLlmClient implements LlmClient {
  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    this.genAI = new GoogleGenerativeAI(key);
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const model = this.genAI.getGenerativeModel({
      model: options.model,
      systemInstruction: options.system,
    });

    // Convert messages to Gemini format
    const history = options.messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("") }],
    }));

    const lastMessage = options.messages[options.messages.length - 1];
    const lastText = typeof lastMessage.content === "string"
      ? lastMessage.content
      : lastMessage.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");

    const chat = model.startChat({
      history,
      generationConfig: { maxOutputTokens: options.maxTokens ?? 1024 },
    });

    const result = await chat.sendMessage(lastText);
    const response = result.response;
    const text = response.text();

    // Gemini doesn't support tool_use in the same way — return text only
    return {
      text,
      toolCalls: [],
      hasToolCalls: false,
      message: { role: "assistant", content: text },
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}

// ─── OpenAI-Compatible Implementation (Kimi K2.5, OpenRouter, etc.) ───

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseURL?: string;
}

export class OpenAICompatibleLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY || "";
    this.baseURL = options.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL || "https://api.openai.com/v1";
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    // Convert to OpenAI chat completions format
    const messages: any[] = [
      { role: "system", content: options.system },
    ];

    for (const msg of options.messages) {
      if (typeof msg.content === "string") {
        messages.push({ role: msg.role, content: msg.content });
      } else {
        // Convert Anthropic content blocks to OpenAI format
        const parts: any[] = [];
        const toolCalls: any[] = [];
        const toolResults: any[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          } else if (block.type === "tool_result") {
            toolResults.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }

        if (msg.role === "assistant") {
          const assistantMsg: any = { role: "assistant" };
          if (parts.length > 0) assistantMsg.content = parts.join("\n");
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
            // Kimi K2.5 thinking mode requires reasoning_content on assistant
            // messages with tool calls. Replay stored reasoning or use empty string.
            assistantMsg.reasoning_content = (msg as any)._reasoning_content ?? "";
          }
          messages.push(assistantMsg);
        } else {
          // User message with tool results
          if (toolResults.length > 0) {
            for (const tr of toolResults) {
              messages.push(tr);
            }
          } else if (parts.length > 0) {
            messages.push({ role: "user", content: parts.join("\n") });
          }
        }
      }
    }

    // Build request body
    const body: any = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
    };

    // Add tools in OpenAI format
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenAI-compatible API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("No choices in OpenAI-compatible response");
    }

    // Extract text and tool calls
    let text = choice.message?.content ?? "";
    const toolCalls: ToolCall[] = [];
    const contentBlocks: ContentBlock[] = [];

    if (text) {
      contentBlocks.push({ type: "text", text });
    }

    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type === "function") {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            // If arguments aren't valid JSON, pass as string
            input = { raw: tc.function.arguments };
          }
          toolCalls.push({ id: tc.id, name: tc.function.name, input });
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
    }

    // Capture reasoning_content from thinking models (e.g. Kimi K2.5)
    // so it can be replayed when this message is sent back in multi-turn
    const reasoningContent = choice.message?.reasoning_content ?? "";
    const message: any = {
      role: "assistant",
      content: contentBlocks.length > 0 ? contentBlocks : text,
    };
    if (reasoningContent) {
      message._reasoning_content = reasoningContent;
    }

    return {
      text,
      toolCalls,
      hasToolCalls: toolCalls.length > 0,
      message,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

// ─── Factory ───

/**
 * Create an LLM client based on the model string.
 *
 * Routing:
 *   gemini-*       → Google Gemini
 *   kimi-*, moonshot-* → OpenAI-compatible (Moonshot AI / Kimi K2.5)
 *   openrouter-*   → OpenAI-compatible (OpenRouter)
 *   else           → Anthropic
 *
 * For OpenAI-compatible models, set env vars:
 *   KIMI_API_KEY / MOONSHOT_API_KEY — for Kimi K2.5
 *   OPENROUTER_API_KEY              — for OpenRouter
 *   OPENAI_API_KEY                  — for OpenAI
 *   OPENAI_COMPATIBLE_API_KEY + OPENAI_COMPATIBLE_BASE_URL — custom endpoint
 */
export function createLlmClient(model: string, apiKey?: string): LlmClient {
  if (model.startsWith("gemini-")) {
    return new GeminiLlmClient(apiKey);
  }

  if (model.startsWith("kimi-") || model.startsWith("moonshot-") || model.startsWith("moonshot/")) {
    return new OpenAICompatibleLlmClient({
      apiKey: apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "",
      baseURL: "https://api.moonshot.ai/v1",
    });
  }

  if (model.startsWith("openrouter-") || model.includes("/")) {
    // OpenRouter uses model IDs like "moonshotai/kimi-k2.5" or "anthropic/claude-sonnet"
    return new OpenAICompatibleLlmClient({
      apiKey: apiKey || process.env.OPENROUTER_API_KEY || "",
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  return new AnthropicLlmClient(apiKey);
}
