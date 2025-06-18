import { getNativeModule } from "./native-loader";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CoreMessage } from "ai";

// Lightweight opt-in logger: set APPLE_AI_DEBUG=1 to enable
function debug(...args: any[]) {
  if (process.env.APPLE_AI_DEBUG) console.debug("[apple-ai]", ...args);
}

function debugErr(...args: any[]) {
  if (process.env.APPLE_AI_DEBUG) console.error("[apple-ai]", ...args);
}

// Initialize native module using robust loader
const native = getNativeModule();

// Register binding helpers we added in Rust
type ToolHandler = (args: any) => Promise<any> | any;

const toolBindings = {
  setToolCallback: native.setToolCallback as (
    callback: (err: any, toolId: number, argsJson: string) => void
  ) => void,
  clearToolCallback: native.clearToolCallback as () => void,
  toolResult: native.toolResult as (toolId: number, resultJson: string) => void,
  generateResponseWithToolsNative: native.generateResponseWithToolsNative as (
    messagesJson: string,
    toolsJson: string,
    temperature?: number,
    maxTokens?: number
  ) => Promise<string>,
  generateResponseWithToolsStream: native.generateResponseWithToolsStream as (
    messagesJson: string,
    toolsJson: string,
    temperature: number | undefined,
    maxTokens: number | undefined,
    cb: (err: any, chunk?: string | null) => void
  ) => void,
};

// ---------- Ephemeral tool invocation ----------

export async function chatWithEphemeralTools(options: {
  messages: CoreMessage[];
  tools?:
    | Array<{
        name: string;
        description?: string;
        schema: z.ZodType<any>;
        handler: (args: any) => any;
      }>
    | Record<string, any>;
  temperature?: number;
  stream?: boolean;
}): Promise<{ content?: string; error?: string }> {
  const { messages, tools = {}, temperature = 0.7, stream = false } = options;

  const toolMap = new Map<number, { tool: any; schema: any }>();

  try {
    // 1. Setup tools if provided
    if (
      (Array.isArray(tools) && tools.length > 0) ||
      (!Array.isArray(tools) && Object.keys(tools).length > 0)
    ) {
      let toolId = 1;

      if (Array.isArray(tools)) {
        // Handle array format: [{ name, schema, handler }]
        for (const tool of tools) {
          const jsonSchema = {
            id: toolId,
            name: tool.name,
            description: tool.description || "",
            parameters: zodToJsonSchema(tool.schema),
          };

          toolMap.set(toolId, {
            tool: { execute: tool.handler },
            schema: jsonSchema,
          });
          toolId++;
        }
      } else {
        // Handle object format: { name: { parameters, execute } }
        for (const [name, tool] of Object.entries(tools)) {
          const jsonSchema = {
            id: toolId,
            name: name,
            description: "",
            parameters: tool.parameters
              ? tool.parameters instanceof z.ZodSchema
                ? zodToJsonSchema(tool.parameters)
                : tool.parameters
              : { type: "object", properties: {} },
          };

          toolMap.set(toolId, { tool, schema: jsonSchema });
          toolId++;
        }
      }
    }

    // Setup global tool callback once for all tools
    if (toolMap.size > 0) {
      toolBindings.setToolCallback(
        async (err: any, toolId: number, argsJson: string) => {
          if (err) {
            debugErr("Tool callback error:", err);
            return;
          }
          debug(
            "Callback received - toolId:",
            toolId,
            `(type: ${typeof toolId})`,
            "argsJson:",
            argsJson
          );
          const tool = toolMap.get(toolId)?.tool;
          if (!tool) {
            debug(
              `Tool ${toolId} not found in map. Available tools:`,
              Array.from(toolMap.keys())
            );
            toolBindings.toolResult(toolId, "{}");
            return;
          }

          try {
            const args = JSON.parse(argsJson);
            debug(`Tool ${toolId} called with args:`, args);
            const result = await tool.execute(args);
            debug(`Tool ${toolId} returned:`, result);
            toolBindings.toolResult(toolId, JSON.stringify(result));
          } catch (error) {
            debugErr(`Tool ${toolId} error:`, error);
            toolBindings.toolResult(toolId, "{}");
          }
        }
      );
    }

    // Log what we're sending to Swift
    const toolSchemas = Array.from(toolMap.values()).map((t) => t.schema);
    debug("Sending tools to Swift", JSON.stringify(toolSchemas));

    // 2. Generate response
    if (stream) {
      return new Promise((resolve, reject) => {
        let fullContent = "";
        toolBindings.generateResponseWithToolsStream(
          JSON.stringify(messages),
          JSON.stringify(toolSchemas),
          temperature,
          undefined, // maxTokens
          (err: any, chunk?: string | null) => {
            if (err) {
              reject(err);
              return;
            }
            if (chunk === null || chunk === "") {
              resolve({ content: fullContent });
              return;
            }
            fullContent += chunk;
          }
        );
      });
    } else {
      const result = await toolBindings.generateResponseWithToolsNative(
        JSON.stringify(messages),
        JSON.stringify(toolSchemas),
        temperature,
        undefined // maxTokens
      );
      return { content: JSON.parse(result).text };
    }
  } finally {
    // Cleanup happens automatically when request completes
  }
}

// Types for our Apple AI library
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ModelAvailability {
  available: boolean;
  reason: string;
}

// OpenAI-compatible response types
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
}

/**
 * Apple AI library for accessing on-device foundation models
 */
export class AppleAISDK {
  /** Check availability of Apple Intelligence */
  async checkAvailability(): Promise<ModelAvailability> {
    return native.checkAvailability();
  }

  /** Get supported languages */
  getSupportedLanguages(): string[] {
    return native.getSupportedLanguages();
  }

  /** Generate a response for a prompt */
  async generateResponse(
    prompt: string,
    options: GenerationOptions = {}
  ): Promise<string> {
    return native.generateResponse(
      prompt,
      options.temperature ?? undefined,
      options.maxTokens ?? undefined
    );
  }

  /** Generate a response using conversation history */
  async generateResponseWithHistory(
    messages: ChatMessage[],
    options: GenerationOptions = {}
  ): Promise<string> {
    const messagesJson = JSON.stringify(messages);
    return native.generateResponseWithHistory(
      messagesJson,
      options.temperature ?? undefined,
      options.maxTokens ?? undefined
    );
  }

  /**
   * Stream chat completion as async generator yielding OpenAI-compatible chunks
   */
  streamChatCompletion(
    messages: ChatMessage[],
    options: GenerationOptions = {}
  ): AsyncIterableIterator<ChatCompletionChunk> {
    const completionId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    const queue: ChatCompletionChunk[] = [];
    let done = false;
    let isFirstChunk = true;

    // Pending promise controls for consumer awaiting next chunk
    let pendingResolve:
      | ((value: IteratorResult<ChatCompletionChunk>) => void)
      | null = null;
    let pendingReject: ((reason?: any) => void) | null = null;

    let error: any = null;

    // Push-based native callback
    const handleChunk = (err: any, chunk?: string | null) => {
      if (err) {
        error = err;
        done = true;
        if (pendingReject) {
          pendingReject(err);
          pendingResolve = null;
          pendingReject = null;
        }
        return;
      }

      let chatChunk: ChatCompletionChunk;

      if (chunk == null || chunk === "") {
        // Final chunk
        chatChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        };
        done = true;
      } else {
        // Content chunk
        chatChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              delta: {
                ...(isFirstChunk ? { role: "assistant" as const } : {}),
                content: chunk,
              },
              finish_reason: null,
            },
          ],
        };
        isFirstChunk = false;
      }

      // If the consumer is waiting, resolve immediately; otherwise buffer
      if (pendingResolve) {
        pendingResolve({ value: chatChunk, done: false });
        pendingResolve = null;
        pendingReject = null;
      } else {
        queue.push(chatChunk);
      }
    };

    // Use the existing streaming mechanism but with messages
    const messagesJson = JSON.stringify(messages);
    native.generateResponseStreamWithHistory?.(
      messagesJson,
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      handleChunk
    ) ??
      (() => {
        // Fallback: if streaming with history isn't available, convert the prompt and use regular streaming
        const prompt =
          messages.map((m) => `${m.role}: ${m.content}`).join("\n") +
          "\nassistant:";
        native.generateResponseStream(
          prompt,
          options.temperature ?? undefined,
          options.maxTokens ?? undefined,
          handleChunk
        );
      })();

    return {
      next(): Promise<IteratorResult<ChatCompletionChunk>> {
        if (queue.length > 0) {
          const value = queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        if (error) {
          return Promise.reject(error);
        }
        // Wait for the next chunk
        return new Promise<IteratorResult<ChatCompletionChunk>>(
          (resolve, reject) => {
            pendingResolve = resolve;
            pendingReject = reject;
          }
        );
      },
      async return(): Promise<IteratorResult<ChatCompletionChunk>> {
        done = true;
        return { value: undefined, done: true };
      },
      async throw(err?: any): Promise<IteratorResult<ChatCompletionChunk>> {
        done = true;
        throw err;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** OpenAI-style helper with streaming support */
  createChatCompletion<T extends boolean = false>(params: {
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    model?: string;
    stream?: T;
  }): T extends true
    ? AsyncIterableIterator<ChatCompletionChunk>
    : Promise<ChatCompletionResponse>;

  // Overload for explicit non-streaming
  createChatCompletion(params: {
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    model?: string;
    stream?: false;
  }): Promise<ChatCompletionResponse>;

  // Overload for explicit streaming
  createChatCompletion(params: {
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    model?: string;
    stream: true;
  }): AsyncIterableIterator<ChatCompletionChunk>;

  // Implementation
  createChatCompletion(params: {
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    model?: string;
    stream?: boolean;
  }):
    | Promise<ChatCompletionResponse>
    | AsyncIterableIterator<ChatCompletionChunk> {
    if (params.stream === true) {
      return this.streamChatCompletion(params.messages, {
        temperature: params.temperature,
        maxTokens: params.max_tokens,
      });
    }

    // Non-streaming response
    return this.generateResponseWithHistory(params.messages, {
      temperature: params.temperature,
      maxTokens: params.max_tokens,
    }).then((content) => ({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion" as const,
      created: Math.floor(Date.now() / 1000),
      model: "apple-on-device",
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content },
          finish_reason: "stop",
        },
      ],
    }));
  }

  /**
   * Stream response as async generator yielding string chunks (deltas)
   */
  streamResponse(
    prompt: string,
    options: GenerationOptions = {}
  ): AsyncIterableIterator<string> {
    const queue: string[] = [];
    let done = false;

    // Pending promise controls for consumer awaiting next chunk
    let pendingResolve: ((value: IteratorResult<string>) => void) | null = null;
    let pendingReject: ((reason?: any) => void) | null = null;

    let error: any = null;

    // Push-based native callback
    const handleChunk = (err: any, chunk?: string | null) => {
      if (err) {
        error = err;
        done = true;
        if (pendingReject) {
          pendingReject(err);
          pendingResolve = null;
          pendingReject = null;
        }
        return;
      }

      if (chunk == null || chunk === "") {
        done = true;
        if (pendingResolve) {
          pendingResolve({ value: undefined, done: true });
          pendingResolve = null;
        }
        return;
      }

      // If the consumer is waiting, resolve immediately; otherwise buffer
      if (pendingResolve) {
        pendingResolve({ value: chunk!, done: false });
        pendingResolve = null;
      } else {
        queue.push(chunk!);
      }
    };

    native.generateResponseStream(
      prompt,
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      handleChunk
    );

    return {
      next(): Promise<IteratorResult<string>> {
        if (queue.length > 0) {
          const value = queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        if (error) {
          return Promise.reject(error);
        }
        // Wait for the next chunk
        return new Promise<IteratorResult<string>>((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
      },
      async return(): Promise<IteratorResult<string>> {
        done = true;
        return { value: undefined, done: true };
      },
      async throw(err?: any): Promise<IteratorResult<string>> {
        done = true;
        throw err;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Generate a structured object based on a Zod/JSON schema */
  async generateStructured<T = any>(params: {
    prompt: string;
    schemaJson: string; // JSON Schema as string
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; object: T }> {
    const { prompt, schemaJson, temperature, maxTokens } = params;
    const raw = await native.generateResponseStructured(
      prompt,
      schemaJson,
      temperature ?? undefined,
      maxTokens ?? undefined
    );

    if (!raw) {
      throw new Error(
        "apple_ai_generate_response_structured symbol not found in native module"
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON returned from native: ${raw}`);
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`Unexpected response shape: ${raw}`);
    }

    return parsed as { text: string; object: T };
  }
}

export const appleAISDK = new AppleAISDK();

export async function generateStructuredFromZod<T = any>(params: {
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; object: T }> {
  const { schema, ...rest } = params;
  const jsonSchemaObj = zodToJsonSchema(schema, "Root");
  return appleAISDK.generateStructured({
    ...rest,
    schemaJson: JSON.stringify(jsonSchemaObj),
  });
}

export function streamChatWithEphemeralTools(options: {
  messages: CoreMessage[];
  tools: Array<{
    name: string;
    description?: string;
    schema: z.ZodType<any>;
    handler: (args: any) => any;
  }>;
  temperature?: number;
}): AsyncIterableIterator<string> {
  let toolId = 1;
  const toolMap = new Map<number, { tool: any; schema: any }>();

  for (const tool of options.tools) {
    toolMap.set(toolId, {
      tool: { execute: tool.handler },
      schema: {
        id: toolId,
        name: tool.name,
        description: tool.description || "",
        parameters: zodToJsonSchema(tool.schema),
      },
    });
    toolId++;
  }

  // Register global callback
  toolBindings.setToolCallback((err, id, argsJson) => {
    if (err) return;
    const entry = toolMap.get(id);
    if (!entry) {
      toolBindings.toolResult(id, "{}");
      return;
    }
    Promise.resolve()
      .then(() => entry.tool.execute(JSON.parse(argsJson)))
      .then((res) => toolBindings.toolResult(id, JSON.stringify(res ?? null)))
      .catch(() => toolBindings.toolResult(id, "{}"));
  });

  const schemas = JSON.stringify(
    Array.from(toolMap.values()).map((v) => v.schema)
  );

  const queue: string[] = [];
  let done = false;
  let error: any = null;
  let pendingResolve: ((value: IteratorResult<string>) => void) | null = null;

  toolBindings.generateResponseWithToolsStream(
    JSON.stringify(options.messages),
    schemas,
    options.temperature ?? undefined,
    undefined,
    (err, chunk) => {
      if (err) {
        error = err;
        done = true;
        if (pendingResolve) pendingResolve({ value: undefined, done: true });
        return;
      }
      if (chunk === null || chunk === "") {
        done = true;
        if (pendingResolve) pendingResolve({ value: undefined, done: true });
        toolBindings.clearToolCallback?.();
        return;
      }
      if (pendingResolve) {
        pendingResolve({ value: chunk!, done: false });
        pendingResolve = null;
      } else {
        queue.push(chunk!);
      }
    }
  );

  return {
    next(): Promise<IteratorResult<string>> {
      if (queue.length)
        return Promise.resolve({ value: queue.shift()!, done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      if (error) return Promise.reject(error);
      return new Promise((resolve) => (pendingResolve = resolve));
    },
    async return() {
      toolBindings.clearToolCallback?.();
      return { value: undefined, done: true };
    },
    async throw(e) {
      toolBindings.clearToolCallback?.();
      throw e;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
