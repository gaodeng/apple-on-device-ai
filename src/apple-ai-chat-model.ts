import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Message,
  LanguageModelV2ResponseMetadata,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  SharedV2Headers,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider";
import type { ChatCompletionChunk, ChatMessage } from "./apple-ai";
import {
  appleAISDK as appleAIInstance,
  chatWithEphemeralTools,
  streamChatForVercelAISDK,
} from "./apple-ai";
import type { AppleAIModelId, AppleAISettings } from "./apple-ai-provider";
import assert from "assert";

export interface AppleAIChatConfig {
  provider: string;
  headers: Record<string, string>;
  generateId: () => string;
}

export class AppleAIChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2";
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "json";

  private readonly settings: AppleAISettings;
  private readonly config: AppleAIChatConfig;

  supportsImageUrls: boolean = false;
  supportsStructuredOutputs: boolean = true;

  constructor(
    modelId: AppleAIModelId,
    settings: AppleAISettings,
    config: AppleAIChatConfig
  ) {
    this.provider = config.provider;
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
  }
  supportedUrls:
    | Record<string, RegExp[]>
    | PromiseLike<Record<string, RegExp[]>> = {};
  doGenerate(options: LanguageModelV2CallOptions): PromiseLike<{
    content: Array<LanguageModelV2Content>;
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    providerMetadata?: SharedV2ProviderMetadata;
    request?: { body?: unknown };
    response?: LanguageModelV2ResponseMetadata & {
      headers?: SharedV2Headers;
      body?: unknown;
    };
    warnings: Array<LanguageModelV2CallWarning>;
  }> {
    throw new Error("Method not implemented.");
  }

  supportsUrl?(url: URL): boolean {
    return true;
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
  }> {
    const { prompt, tools } = options;

    // Check Apple Intelligence availability
    const availability = await appleAIInstance.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Apple Intelligence not available: ${availability.reason}`
      );
    }

    // Convert AI SDK prompt to our format
    let messages = this.convertPromptToMessages(prompt);

    if (tools && tools.length > 0) {
      return this.createToolEnabledStream(messages, tools);
    } else {
      return this.createRegularStream(messages);
    }
  }

  private createToolEnabledStream(
    messages: any[],
    tools: LanguageModelV2CallOptions["tools"]
  ): Promise<{ stream: ReadableStream<LanguageModelV2StreamPart> }> {
    // Build ephemeral tools for native layer
    const epTools = tools!.map((t) => {
      if (t.type !== "function") {
        throw new Error(`Unsupported tool type: ${t?.type ?? "unknown"}`);
      }
      return {
        name: t.name,
        description: t.description,
        jsonSchema: t.inputSchema,
        handler: async (args: Record<string, unknown>) => {
          // Placeholder - Vercel AI SDK will handle execution
          return {};
        },
      };
    });

    // Use the Vercel AI SDK specific streaming function
    const nativeStream = streamChatForVercelAISDK({
      messages,
      tools: epTools,
      temperature: this.settings.temperature,
    });

    const stream = this.createStreamFromEvents(nativeStream);
    return Promise.resolve({ stream });
  }

  private createRegularStream(
    messages: any[]
  ): Promise<{ stream: ReadableStream<LanguageModelV2StreamPart> }> {
    const streamNoTools = appleAIInstance.streamChatCompletion(messages, {
      temperature: this.settings.temperature,
      maxTokens: this.settings.maxTokens,
    });

    const stream = this.createStreamFromChunks(streamNoTools);
    return Promise.resolve({ stream });
  }

  private createStreamFromEvents(
    nativeStream: AsyncIterableIterator<
      | { type: "text"; text: string }
      | {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
        }
    >
  ): ReadableStream<LanguageModelV2StreamPart> {
    const finishStream = this.finishStream; // Capture method reference
    return new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          for await (const event of nativeStream) {
            if (event.type === "text") {
              controller.enqueue({ type: "text", text: event.text });
            } else if (event.type === "tool-call") {
              controller.enqueue({
                type: "tool-call",
                toolCallType: "function",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: JSON.stringify(event.args),
              });
            }
          }
          finishStream(controller);
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  private createStreamFromChunks(
    streamNoTools: AsyncIterableIterator<any>
  ): ReadableStream<LanguageModelV2StreamPart> {
    const finishStream = this.finishStream; // Capture method reference
    return new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          for await (const chunk of streamNoTools) {
            let text = "";
            if (typeof chunk === "string") text = chunk;
            else text = chunk.choices?.[0]?.delta?.content ?? "";
            if (text) controller.enqueue({ type: "text", text });
          }
          finishStream(controller);
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  private finishStream(
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): void {
    controller.enqueue({
      type: "finish",
      finishReason: "stop",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    });
    controller.close();
  }

  private convertPromptToMessages(
    prompt: Parameters<LanguageModelV2["doGenerate"]>[0]["prompt"]
  ): ChatMessage[] {
    return prompt.map((message) => {
      switch (message.role) {
        case "system":
          return this.convertSystemMessage(message);
        case "user":
          return this.convertUserMessage(message);
        case "assistant":
          return this.convertAssistantMessage(message);
        case "tool":
          return this.convertToolMessage(message);
        default:
          return this.convertFallbackMessage(message);
      }
    });
  }

  private convertSystemMessage(
    message: Extract<LanguageModelV2Message, { role: "system" }>
  ): ChatMessage {
    return {
      role: "system" as const,
      content: Array.isArray(message.content)
        ? message.content
            .map((part: any) => {
              switch (part.type) {
                case "text":
                  return part.text;
                case "tool-call":
                  return JSON.stringify(part.tool_calls);
                case "tool-result":
                  return JSON.stringify(part.output);
                case "start-step":
                  return JSON.stringify(part.step);
                default:
                  return `[unsupported content - ${part.type}]`;
              }
            })
            .join("\n")
        : message.content,
    };
  }

  private convertUserMessage(
    message: Extract<LanguageModelV2Message, { role: "user" }>
  ): ChatMessage {
    return {
      role: "user" as const,
      content: Array.isArray(message.content)
        ? message.content
            .map((part) =>
              part.type === "text" ? part.text : "[unsupported content]"
            )
            .join("\n")
        : message.content,
    };
  }

  private convertAssistantMessage(
    message: Extract<LanguageModelV2Message, { role: "assistant" }>
  ): ChatMessage {
    if (Array.isArray(message.content)) {
      const toolCalls = message.content.filter(
        (part) => part.type === "tool-call"
      );
      const textParts = message.content.filter((part) => part.type === "text");

      if (toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: textParts.map((part) => part.text).join("\n") || "",
          tool_calls: toolCalls.map((part) => ({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input),
            },
          })),
        };
      }

      // Regular assistant message with content array
      return {
        role: "assistant" as const,
        content: message.content
          .map((part) => {
            switch (part.type) {
              case "text":
              case "reasoning":
                return part.text;
              default:
                return `[unsupported content - ${part.type}]`;
            }
          })
          .join("\n"),
      };
    }

    // Simple string content
    return {
      role: "assistant" as const,
      content: message.content || "",
    };
  }

  private convertToolMessage(
    message: Extract<LanguageModelV2Message, { role: "tool" }>
  ): ChatMessage {
    assert(
      message.content.every((part) => part.type === "tool-result"),
      "Tool message must contain only tool-result parts"
    );

    const toolCalls = message.content
      .map((part) => {
        if (part.type === "tool-result") {
          return {
            id: part.toolCallId,
            toolName: part.toolName,
            segments: [{ type: "text", text: JSON.stringify(part.output) }],
          };
        }
        return null;
      })
      .filter(Boolean);

    const convertedMessage = {
      role: "tool" as const,
      content: JSON.stringify({ tool_calls: toolCalls }),
    };

    return convertedMessage;
  }

  private convertFallbackMessage(
    message: Extract<
      LanguageModelV2Message,
      { role: "user" | "assistant" | "tool" }
    >
  ): ChatMessage {
    return {
      role: "user" as const,
      content: String(message.content || ""),
    };
  }
}
