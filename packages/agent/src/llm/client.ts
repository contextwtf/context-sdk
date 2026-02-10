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

// ─── Factory ───

/** Create an LLM client based on the model string. gemini-* → Gemini, else → Anthropic. */
export function createLlmClient(model: string, apiKey?: string): LlmClient {
  if (model.startsWith("gemini-")) {
    return new GeminiLlmClient(apiKey);
  }
  return new AnthropicLlmClient(apiKey);
}
