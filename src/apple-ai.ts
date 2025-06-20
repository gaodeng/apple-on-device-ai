import { getNativeModule } from "./native-loader";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CoreMessage, ModelMessage } from "ai";
import type { JSONSchema7 } from "json-schema";
import { Readable } from "stream";

// Lightweight opt-in logger: set APPLE_AI_DEBUG=1 to enable
function debug(...args: unknown[]) {
  if (process.env.APPLE_AI_DEBUG) console.debug("[apple-ai]", ...args);
}

function debugErr(...args: unknown[]) {
  if (process.env.APPLE_AI_DEBUG) console.error("[apple-ai]", ...args);
}

// Initialize native module using robust loader
const native = getNativeModule();

const toolBindings = {
  setToolCallback: native.setToolCallback as (
    callback: (err: Error | null, toolId: number, argsJson: string) => void
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
    cb: (err: unknown, chunk?: string | null) => void
  ) => void,
};

// ------------------ Shared Types ------------------

/**
 * Definition of an in-memory ("ephemeral") tool that can be exposed to the
 * on-device model during a single request.
 *
 *  • `schema` captures the expected argument structure using Zod.
 *  • `handler` is invoked with the validated, _typed_ argument object.
 *
 * By making the interface generic in `TSchema` (and, optionally, `TResult`) we
 * propagate rich typings to call-sites instead of falling back to `unknown`.
 */
export type EphemeralTool<TSchema extends JSONSchema7, TResult = unknown> = {
  /** Unique, model-visible name */
  name: string;
  /** Optional human-oriented description */
  description?: string;
  /** JSON schema describing the tool arguments */
  jsonSchema: TSchema;
  /** Implementation invoked with a fully-parsed, type-safe argument object */
  handler: (args: Record<string, unknown>) => PromiseLike<TResult>;
};

// ---------- Ephemeral tool invocation ----------

export async function chatWithEphemeralTools<
  TTools extends ReadonlyArray<EphemeralTool<any, any>>
>(options: {
  messages: ModelMessage[];
  tools?: TTools;
  temperature?: number;
  stream?: boolean;
}): Promise<{ content?: string; error?: string; toolCalls?: any[] }> {
  const { messages, tools = {}, temperature = 0.7, stream = false } = options;

  const toolMap = new Map<
    number,
    {
      tool: { execute: (args: unknown) => unknown | Promise<unknown> };
      schema: unknown;
    }
  >();

  try {
    // 1. Setup tools if provided
    if (Array.isArray(tools) && tools.length > 0) {
      let toolId = 1;

      // Handle array format: [{ name, schema, handler }]
      for (const tool of tools) {
        const jsonSchema = {
          id: toolId,
          name: tool.name,
          description: tool.description || "",
          parameters: tool.jsonSchema,
        };

        toolMap.set(toolId, {
          tool: { execute: tool.handler },
          schema: jsonSchema,
        });
        toolId++;
      }
    }

    // Setup global tool callback once for all tools
    if (toolMap.size > 0) {
      toolBindings.setToolCallback(
        async (err: Error | null, toolId: number, argsJson: string) => {
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
            const args: unknown = JSON.parse(argsJson);
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
    debug("Sending tools to Swift");

    // 2. Generate response
    if (stream) {
      return new Promise((resolve, reject) => {
        let fullContent = "";
        toolBindings.generateResponseWithToolsStream(
          JSON.stringify(messages),
          JSON.stringify(toolSchemas),
          temperature,
          undefined, // maxTokens
          (err: unknown, chunk?: string | null) => {
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
      const raw = await toolBindings.generateResponseWithToolsNative(
        JSON.stringify(messages),
        JSON.stringify(toolSchemas),
        temperature,
        undefined // maxTokens
      );
      const parsed = JSON.parse(raw) as { text: string; toolCalls?: any[] };
      return {
        content: parsed.text,
        ...(parsed.toolCalls ? { toolCalls: parsed.toolCalls } : {}),
      };
    }
  } finally {
    if (toolBindings.clearToolCallback) toolBindings.clearToolCallback();
  }
}

// Types for our Apple AI library
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "tool_calls";
  content: string;
  name?: string;
  tool_call_id?: string; // OpenAI-compatible snake_case
  tool_calls?: Array<{
    // OpenAI-compatible structure for assistant messages
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
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
    let pendingReject: ((reason?: unknown) => void) | null = null;

    let error: unknown = null;

    // Push-based native callback
    const handleChunk = (err: unknown, chunk?: string | null) => {
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
      async throw(err?: unknown): Promise<IteratorResult<ChatCompletionChunk>> {
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
    let pendingReject: ((reason?: unknown) => void) | null = null;

    let error: unknown = null;

    // Push-based native callback
    const handleChunk = (err: unknown, chunk?: string | null) => {
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
      async throw(err?: unknown): Promise<IteratorResult<string>> {
        done = true;
        throw err;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  /** Generate a structured object based on a Zod/JSON schema */
  async generateStructured<T = unknown>(params: {
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

    let parsed: unknown;
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

export async function generateStructuredFromZod<T = unknown>(params: {
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

export function streamChatWithEphemeralTools<
  TTools extends ReadonlyArray<EphemeralTool<JSONSchema7>>
>(options: {
  messages: ModelMessage[];
  tools: TTools;
  temperature?: number;
}): AsyncIterableIterator<string> {
  // Build mapping → schema in one pass
  const toolMap = new Map<number, EphemeralTool<JSONSchema7>>();
  const toolSchemas = options.tools.map((tool, idx) => {
    const id = idx + 1;
    toolMap.set(id, tool);
    return {
      id,
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.jsonSchema,
    };
  });

  // Global callback that invokes the correct handler and returns result back to Swift
  toolBindings.setToolCallback(async (err, id, argsJson) => {
    if (err) return;
    const tool = toolMap.get(id);
    if (!tool) {
      toolBindings.toolResult(id, "{}");
      return;
    }
    try {
      const result = await tool.handler(JSON.parse(argsJson));
      toolBindings.toolResult(id, JSON.stringify(result ?? null));
    } catch {
      toolBindings.toolResult(id, "{}");
    }
  });

  const messagesJson = JSON.stringify(options.messages);
  const schemasJson = JSON.stringify(toolSchemas);

  // Use a Node/Bun Readable stream (object-mode) to bridge callback → async
  // iterator in the most compact form.
  const readable = new Readable({ read() {}, objectMode: true });

  // Clear callback only after native layer tells us the stream is finished.
  const clear = () => toolBindings.clearToolCallback?.();

  toolBindings.generateResponseWithToolsStream(
    messagesJson,
    schemasJson,
    options.temperature ?? undefined,
    undefined,
    (err, chunk) => {
      if (err) {
        readable.destroy(err as Error);
        clear();
        return;
      }
      if (chunk === null || chunk === "") {
        readable.push(null); // EOS
        clear();
        return;
      }
      readable.push(chunk);
    }
  );

  // Expose the stream as an async iterator of strings
  return readable[Symbol.asyncIterator]() as AsyncIterableIterator<string>;
}

/**
 * Stream chat with external tool orchestration - emits tool-call events
 * and accepts tool results to be injected back into the stream.
 */
export function streamChatWithExternalTools<
  TTools extends ReadonlyArray<EphemeralTool<JSONSchema7>>
>(options: {
  messages: ModelMessage[];
  tools: TTools;
  temperature?: number;
}): {
  textStream: AsyncIterableIterator<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }
  >;
  injectToolResult: (toolCallId: string, result: unknown) => void;
} {
  // Build tool schemas for the native layer
  const toolSchemas = options.tools.map((tool, idx) => ({
    id: idx + 1,
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.jsonSchema,
  }));

  // Map to track pending tool calls and their resolve functions
  const pendingToolCalls = new Map<
    string,
    {
      toolId: number;
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  // Set up tool callback to emit tool-call events and wait for external results
  toolBindings.setToolCallback(async (err, id, argsJson) => {
    if (err) {
      // Resume Swift continuation to avoid leaks, even if an error occurred
      toolBindings.toolResult(id, "{}");
      return;
    }

    const tool = options.tools[id - 1]; // toolIds are 1-based
    if (!tool) {
      toolBindings.toolResult(id, "{}");
      return;
    }

    const toolCallId = `tool-call-${crypto.randomUUID()}`;

    try {
      const args = JSON.parse(argsJson);

      // Create a promise that will be resolved by external tool result injection
      const toolExecutionPromise = new Promise<unknown>((resolve, reject) => {
        pendingToolCalls.set(toolCallId, {
          toolId: id,
          resolve,
          reject,
        });

        // Emit the tool-call event to the stream
        readable.push({
          type: "tool-call",
          toolCallId,
          toolName: tool.name,
          args,
        });
      });

      // Wait for external execution to complete
      const result = await toolExecutionPromise;
      toolBindings.toolResult(id, JSON.stringify(result ?? null));
    } catch (error) {
      toolBindings.toolResult(id, JSON.stringify({ error: String(error) }));
    }
  });

  const messagesJson = JSON.stringify(options.messages);
  const schemasJson = JSON.stringify(toolSchemas);

  const readable = new Readable({ read() {}, objectMode: true });

  const clear = () => toolBindings.clearToolCallback?.();

  toolBindings.generateResponseWithToolsStream(
    messagesJson,
    schemasJson,
    options.temperature ?? undefined,
    undefined,
    (err, chunk) => {
      if (err) {
        readable.destroy(err as Error);
        clear();
        return;
      }
      if (chunk === null || chunk === "") {
        readable.push(null); // EOS
        clear();
        return;
      }
      readable.push({ type: "text", text: chunk });
    }
  );

  const textStream = readable[Symbol.asyncIterator]() as AsyncIterableIterator<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }
  >;

  // Function to inject tool results from external execution
  const injectToolResult = (toolCallId: string, result: unknown) => {
    const pendingCall = pendingToolCalls.get(toolCallId);
    if (pendingCall) {
      pendingCall.resolve(result);
      pendingToolCalls.delete(toolCallId);
    }
  };

  return {
    textStream,
    injectToolResult,
  };
}

/**
 * Stream chat that properly integrates with Vercel AI SDK's multi-step tool calling.
 * This function emits tool-call events and ends the stream, allowing the SDK to
 * orchestrate tool execution and restart generation with updated messages.
 *
 * Early termination is enabled by default when tools are present, saving compute
 * resources by stopping the Swift streaming loop after tool calls complete.
 */
export function streamChatForVercelAISDK<
  TTools extends ReadonlyArray<EphemeralTool<JSONSchema7>>
>(options: {
  messages: ModelMessage[];
  tools: TTools;
  temperature?: number;
}): AsyncIterableIterator<
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
> {
  // Build tool schemas for the native layer
  const toolSchemas = options.tools.map((tool, idx) => ({
    id: idx + 1,
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.jsonSchema,
  }));

  // Collect all tool calls that occur during generation
  const collectedToolCalls: Array<{
    id: number;
    toolName: string;
    args: Record<string, unknown>;
  }> = [];

  const readable = new Readable({ read() {}, objectMode: true });

  // Set up tool callback to collect tool calls
  toolBindings.setToolCallback(async (err, id, argsJson) => {
    if (err) {
      // Always provide a result to avoid hanging
      toolBindings.toolResult(id, "{}");
      return;
    }

    const tool = options.tools[id - 1]; // toolIds are 1-based
    if (!tool) {
      // Always provide a result to avoid hanging
      toolBindings.toolResult(id, "{}");
      return;
    }

    try {
      const args = JSON.parse(argsJson);

      // Collect tool call for post-processing
      collectedToolCalls.push({
        id,
        toolName: tool.name,
        args,
      });

      // Immediately provide placeholder result to Swift to avoid hanging
      toolBindings.toolResult(id, "{}");
    } catch (error) {
      // Always provide a result to avoid hanging
      toolBindings.toolResult(id, "{}");
    }
  });

  const messagesJson = JSON.stringify(options.messages);
  const schemasJson = JSON.stringify(toolSchemas);

  let generationComplete = false;

  // Helper to emit tool calls and close stream
  const finishWithToolCalls = () => {
    if (generationComplete) return;
    generationComplete = true;

    // Emit all collected tool calls
    for (const call of collectedToolCalls) {
      readable.push({
        type: "tool-call",
        toolCallId: `tool-call-${crypto.randomUUID()}`,
        toolName: call.toolName,
        args: call.args,
      });
    }

    readable.push(null);
    toolBindings.clearToolCallback?.();
  };

  // Use the standard streaming function (early termination is now default)
  toolBindings.generateResponseWithToolsStream(
    messagesJson,
    schemasJson,
    options.temperature ?? undefined,
    undefined, // maxTokens
    (err, chunk) => {
      if (err) {
        readable.destroy(err as Error);
        toolBindings.clearToolCallback?.();
        return;
      }

      if (chunk === null || chunk === "") {
        finishWithToolCalls();
        return;
      }

      // Stream text content
      readable.push({ type: "text", text: chunk });
    }
  );

  return readable[Symbol.asyncIterator]() as AsyncIterableIterator<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }
  >;
}
