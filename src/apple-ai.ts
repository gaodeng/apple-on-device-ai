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

// Add unified function bindings
const unifiedBindings = {
  generateUnified: native.generateUnified as (
    messagesJson: string,
    toolsJson?: string | null,
    schemaJson?: string | null,
    temperature?: number,
    maxTokens?: number,
    stopAfterToolCalls?: boolean
  ) => Promise<string>,
  generateUnifiedStream: native.generateUnifiedStream as (
    messagesJson: string,
    toolsJson: string | null | undefined,
    schemaJson: string | null | undefined,
    temperature: number | undefined,
    maxTokens: number | undefined,
    stopAfterToolCalls: boolean | undefined,
    cb: (err: unknown, chunk?: string | null) => void
  ) => void,
};

const toolBindings = {
  setToolCallback: native.setToolCallback as (
    callback: (err: Error | null, toolId: number, argsJson: string) => void
  ) => void,
  clearToolCallback: native.clearToolCallback as () => void,
  toolResult: native.toolResult as (toolId: number, resultJson: string) => void,
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
    // Convert prompt to messages format
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const messagesJson = JSON.stringify(messages);

    const result = await unifiedBindings.generateUnified(
      messagesJson,
      null, // no tools
      null, // no schema
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      true // stopAfterToolCalls default
    );

    // Parse result and extract text
    const parsed = JSON.parse(result);
    return parsed.text || result;
  }

  /** Generate a response using conversation history */
  async generateResponseWithHistory(
    messages: ChatMessage[],
    options: GenerationOptions = {}
  ): Promise<string> {
    const messagesJson = JSON.stringify(messages);

    const result = await unifiedBindings.generateUnified(
      messagesJson,
      null, // no tools
      null, // no schema
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      true // stopAfterToolCalls default
    );

    // Parse result and extract text
    const parsed = JSON.parse(result);
    return parsed.text || result;
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

    // Use unified streaming
    const messagesJson = JSON.stringify(messages);
    unifiedBindings.generateUnifiedStream(
      messagesJson,
      null, // no tools
      null, // no schema
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      true, // stopAfterToolCalls default
      handleChunk
    );

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

    // Convert prompt to messages and use unified streaming
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const messagesJson = JSON.stringify(messages);

    unifiedBindings.generateUnifiedStream(
      messagesJson,
      null, // no tools
      null, // no schema
      options.temperature ?? undefined,
      options.maxTokens ?? undefined,
      true, // stopAfterToolCalls default
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

    // Convert prompt to messages format
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const messagesJson = JSON.stringify(messages);

    const raw = await unifiedBindings.generateUnified(
      messagesJson,
      null, // no tools
      schemaJson,
      temperature ?? undefined,
      maxTokens ?? undefined
    );

    if (!raw) {
      throw new Error("apple_ai_generate_unified returned null");
    }

    // Check if the response is an error string from the native layer
    if (raw.startsWith("Error: ")) {
      throw new Error(raw.slice(7)); // Remove "Error: " prefix and throw
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

/**
 * Unified structured generation that accepts either Zod schemas or JSON Schema
 */
export async function structured<T = unknown>(options: {
  prompt: string;
  schema: z.ZodType<T> | JSONSchema7;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; object: T }> {
  const { prompt, schema, temperature, maxTokens } = options;

  let jsonSchemaString: string;

  // Auto-detect Zod vs JSON Schema
  if (typeof schema === "object" && schema !== null && "parse" in schema) {
    // It's a Zod schema
    const jsonSchemaObj = zodToJsonSchema(schema as z.ZodType<T>, "Root");
    jsonSchemaString = JSON.stringify(jsonSchemaObj);
  } else {
    // It's already a JSON Schema
    jsonSchemaString = JSON.stringify(schema);
  }

  return appleAISDK.generateStructured({
    prompt,
    schemaJson: jsonSchemaString,
    temperature,
    maxTokens,
  });
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

  // Use unified streaming with tools
  unifiedBindings.generateUnifiedStream(
    messagesJson,
    schemasJson,
    null, // no schema
    options.temperature ?? undefined,
    undefined, // maxTokens
    true, // stopAfterToolCalls default (OpenAI behavior)
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

/**
 * Unified generation function that exposes all capabilities
 */
export async function chat<T = unknown>(options: {
  messages: ChatMessage[] | string;
  tools?: EphemeralTool<JSONSchema7>[];
  schema?: z.ZodType<T> | JSONSchema7;
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean; // defaults to true (OpenAI behavior)
  stream?: false;
}): Promise<{ text: string; object?: T; toolCalls?: any[] }>;

export function chat<T = unknown>(options: {
  messages: ChatMessage[] | string;
  tools?: EphemeralTool<JSONSchema7>[];
  schema?: z.ZodType<T> | JSONSchema7;
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean; // defaults to true (OpenAI behavior)
  stream: true;
}): AsyncIterableIterator<string>;

export function chat<T = unknown>(options: {
  messages: ChatMessage[] | string;
  tools?: EphemeralTool<JSONSchema7>[];
  schema?: z.ZodType<T> | JSONSchema7;
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean; // defaults to true (OpenAI behavior)
  stream?: boolean;
}):
  | Promise<{ text: string; object?: T; toolCalls?: any[] }>
  | AsyncIterableIterator<string> {
  const {
    messages,
    tools,
    schema,
    temperature,
    maxTokens,
    stopAfterToolCalls = true, // default to true for OpenAI compatibility
    stream = false,
  } = options;

  // Normalize messages
  const normalizedMessages: ChatMessage[] =
    typeof messages === "string"
      ? [{ role: "user", content: messages }]
      : messages;
  const messagesJson = JSON.stringify(normalizedMessages);

  // Prepare tools JSON if provided
  let toolsJson: string | null = null;
  const toolMap = new Map<number, EphemeralTool<JSONSchema7>>();

  if (tools && tools.length > 0) {
    const toolSchemas = tools.map((tool, idx) => {
      const id = idx + 1;
      toolMap.set(id, tool);
      return {
        id,
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.jsonSchema,
      };
    });
    toolsJson = JSON.stringify(toolSchemas);

    // Setup tool callback
    toolBindings.setToolCallback(async (err, id, argsJson) => {
      if (err) {
        toolBindings.toolResult(id, "{}");
        return;
      }
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
  }

  // Prepare schema JSON if provided (and no tools)
  let schemaJson: string | null = null;
  if (!tools && schema) {
    if (typeof schema === "object" && schema !== null && "parse" in schema) {
      // It's a Zod schema
      const jsonSchemaObj = zodToJsonSchema(schema as z.ZodType<T>, "Root");
      schemaJson = JSON.stringify(jsonSchemaObj);
    } else {
      // It's already a JSON Schema
      schemaJson = JSON.stringify(schema);
    }
  }

  if (stream) {
    // Streaming mode
    const readable = new Readable({ read() {}, objectMode: true });

    unifiedBindings.generateUnifiedStream(
      messagesJson,
      toolsJson,
      schemaJson,
      temperature,
      maxTokens,
      stopAfterToolCalls,
      (err, chunk) => {
        if (err) {
          readable.destroy(err as Error);
          if (toolMap.size > 0) toolBindings.clearToolCallback?.();
          return;
        }
        if (chunk === null || chunk === "") {
          readable.push(null);
          if (toolMap.size > 0) toolBindings.clearToolCallback?.();
          return;
        }
        readable.push(chunk);
      }
    );

    return readable[Symbol.asyncIterator]() as AsyncIterableIterator<string>;
  } else {
    // Non-streaming mode
    return (async () => {
      try {
        const raw = await unifiedBindings.generateUnified(
          messagesJson,
          toolsJson,
          schemaJson,
          temperature,
          maxTokens,
          stopAfterToolCalls
        );

        // Check if the response is an error string from the native layer
        console.log("DEBUG: Raw response from chat:", raw, typeof raw);
        if (raw && raw.startsWith("Error: ")) {
          throw new Error(raw.slice(7)); // Remove "Error: " prefix and throw
        }

        // Parse the result
        const parsed = JSON.parse(raw);

        if (schemaJson && parsed.object) {
          // Structured generation result
          return {
            text: parsed.text,
            object: parsed.object as T,
          };
        } else if (parsed.toolCalls) {
          // Tool calling result
          return {
            text: parsed.text,
            toolCalls: parsed.toolCalls,
          };
        } else {
          // Basic generation result
          return {
            text: parsed.text,
          };
        }
      } finally {
        if (toolMap.size > 0) toolBindings.clearToolCallback?.();
      }
    })();
  }
}
