import type {
  LanguageModelV1,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import type { ChatMessage } from "./apple-ai";
import { appleAISDK as appleAIInstance } from "./apple-ai";
import type { AppleAIModelId, AppleAISettings } from "./apple-ai-provider";

export interface AppleAIChatConfig {
  provider: string;
  headers: Record<string, string>;
  generateId: () => string;
}

export class AppleAIChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1";
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "json";

  private readonly settings: AppleAISettings;
  private readonly config: AppleAIChatConfig;

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

  async doGenerate(options: Parameters<LanguageModelV1["doGenerate"]>[0]) {
    const { prompt, responseFormat, mode, ...rest } = options;

    // Extract tools and toolChoice from mode (deprecated but still current interface)
    const tools = mode?.type === "regular" ? mode.tools : undefined;
    const toolChoice = mode?.type === "regular" ? mode.toolChoice : undefined;

    // Check Apple Intelligence availability
    const availability = await appleAIInstance.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Apple Intelligence not available: ${availability.reason}`
      );
    }

    // Convert AI SDK prompt to our format
    let messages = this.convertPromptToMessages(prompt);

    // Add tool definitions to the prompt if tools are provided
    if (tools && tools.length > 0) {
      const toolSystemMessage = this.createToolSystemMessage(tools, toolChoice);
      messages = [{ role: "system", content: toolSystemMessage }, ...messages];
    }

    // Prepare rawCall for metadata
    const rawCall = {
      rawPrompt: messages,
      rawSettings: {
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
      },
    };

    // Native structured generation path
    if (responseFormat?.type === "json" && responseFormat?.schema) {
      const schemaJson = JSON.stringify(responseFormat.schema);
      const promptStr = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const structured = await appleAIInstance.generateStructured({
        prompt: promptStr,
        schemaJson,
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
      });

      return {
        text: structured.text,
        object: structured.object,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
        },
        finishReason: "stop" as LanguageModelV1FinishReason,
        warnings: [] as LanguageModelV1CallWarning[],
        rawCall,
      };
    }

    // Regular text generation (including tool calls)
    const content = await appleAIInstance.generateResponseWithHistory(
      messages,
      {
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
      }
    );

    // Check if the response contains tool calls
    const parsedResponse = this.parseToolCalls(content, tools);

    return {
      text: parsedResponse.text || content,
      toolCalls: parsedResponse.toolCalls || [],
      usage: {
        promptTokens: 0,
        completionTokens: 0,
      },
      finishReason: "stop" as LanguageModelV1FinishReason,
      warnings: [] as LanguageModelV1CallWarning[],
      rawCall,
    };
  }

  async doStream(options: Parameters<LanguageModelV1["doStream"]>[0]) {
    const { prompt, responseFormat, mode, ...rest } = options;

    // Extract tools and toolChoice from mode (deprecated but still current interface)
    const tools = mode?.type === "regular" ? mode.tools : undefined;
    const toolChoice = mode?.type === "regular" ? mode.toolChoice : undefined;

    // Check Apple Intelligence availability
    const availability = await appleAIInstance.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Apple Intelligence not available: ${availability.reason}`
      );
    }

    // Convert AI SDK prompt to our format
    let messages = this.convertPromptToMessages(prompt);

    // Add tool definitions to the prompt if tools are provided
    if (tools && tools.length > 0) {
      const toolSystemMessage = this.createToolSystemMessage(tools, toolChoice);
      messages = [{ role: "system", content: toolSystemMessage }, ...messages];
    }

    // Prepare rawCall for metadata
    const rawCall = {
      rawPrompt: messages,
      rawSettings: {
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
      },
    };

    // For streaming, we'll use our existing streaming functionality
    const stream = appleAIInstance.streamChatCompletion(messages, {
      temperature: this.settings.temperature,
      maxTokens: this.settings.maxTokens,
    });

    // Convert async iterable to ReadableStream
    const self = this;
    let accumulatedContent = "";

    const readableStream = new ReadableStream<LanguageModelV1StreamPart>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.choices[0]?.delta?.content) {
              const deltaContent = chunk.choices[0].delta.content;
              accumulatedContent += deltaContent;

              controller.enqueue({
                type: "text-delta",
                textDelta: deltaContent,
              });
            }

            if (chunk.choices[0]?.finish_reason === "stop") {
              // Check for tool calls in the final accumulated content
              if (tools && tools.length > 0) {
                const parsedResponse = self.parseToolCalls(
                  accumulatedContent,
                  tools
                );
                if (
                  parsedResponse.toolCalls &&
                  parsedResponse.toolCalls.length > 0
                ) {
                  // Emit tool calls
                  for (const toolCall of parsedResponse.toolCalls) {
                    controller.enqueue({
                      type: "tool-call",
                      toolCallType: "function",
                      toolCallId: toolCall.toolCallId,
                      toolName: toolCall.toolName,
                      args: toolCall.args,
                    });
                  }
                }
              }

              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: {
                  promptTokens: 0,
                  completionTokens: 0,
                },
              });
              controller.close();
              return;
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      stream: readableStream,
      rawCall,
      warnings: [] as LanguageModelV1CallWarning[],
    };
  }

  private createToolSystemMessage(
    tools: Array<any> | undefined,
    toolChoice?: any
  ): string {
    if (!tools || tools.length === 0) {
      return "";
    }
    const toolDescriptions = tools
      .map((tool) => {
        return `Tool: ${tool.name}\nDescription: ${
          tool.description || "No description provided"
        }\nParameters: ${JSON.stringify(tool.parameters, null, 2)}`;
      })
      .join("\n\n");

    let systemMessage = `You are an AI assistant that can call external tools to solve the user's request.\n\nAvailable tools:\n\n${toolDescriptions}\n\nINSTRUCTIONS FOR CALLING TOOLS:\n1. If a tool is needed, respond using the format:\n   TOOL_CALL: <tool_name>\n   ARGUMENTS: <json_parameters>\n2. You can list multiple tool calls one after another.\n3. If tool results are already provided in the conversation (they will appear as messages from role=tool), you MUST use them to craft a final answer.\n4. After you have the information you need, answer the user DIRECTLY and DO NOT make any more tool calls.`;

    if (toolChoice) {
      if (toolChoice === "required") {
        systemMessage +=
          "\n\nA tool call is required to answer this request. Failure to call a tool will result in a failure to answer the request. Do not attempt to answer the request without calling a tool.";
      } else if (toolChoice === "none") {
        systemMessage += "\n\nDo NOT call any tools. Provide a direct answer.";
      } else if (typeof toolChoice === "object" && toolChoice.type === "tool") {
        systemMessage += `\n\nYou must use only the \"${toolChoice.toolName}\" tool. Do not use any other tools.`;
      }
    }

    return systemMessage;
  }

  private parseToolCalls(
    content: string,
    tools?: Array<any>
  ): {
    text?: string;
    toolCalls?: Array<{
      toolCallType: "function";
      toolCallId: string;
      toolName: string;
      args: any;
    }>;
  } {
    if (!tools || tools.length === 0) {
      return { text: content };
    }

    const toolCalls: Array<{
      toolCallType: "function";
      toolCallId: string;
      toolName: string;
      args: any;
    }> = [];

    // Look for our simple TOOL_CALL format (tolerates indentation / extra whitespace)
    const toolCallRegex =
      /TOOL_CALL:\s*(\w+)[\t ]*\n[\t ]*ARGUMENTS:\s*(\{[\s\S]*?\})(?:\n|$)/g;
    let match;
    let hasToolCalls = false;

    while ((match = toolCallRegex.exec(content)) !== null) {
      hasToolCalls = true;
      const toolName = match[1];
      const argsJson = match[2];

      if (!toolName || !argsJson) continue;

      try {
        // Keep args as string for AI SDK compatibility
        toolCalls.push({
          toolCallType: "function",
          toolCallId: `call_${Math.random().toString(36).substr(2, 9)}`,
          toolName,
          args: argsJson,
        });
      } catch (error) {
        console.warn(
          `Failed to parse tool arguments for ${toolName}:`,
          argsJson
        );
      }
    }

    if (hasToolCalls) {
      // If we found tool calls, remove them from the text content
      const cleanedContent = content.replace(toolCallRegex, "").trim();
      return {
        text: cleanedContent || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    // Fallback: try to parse as the old JSON format for backwards compatibility
    try {
      const parsed = JSON.parse(content);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        const legacyToolCalls = parsed.tool_calls.map((call: any) => ({
          toolCallType: "function" as const,
          toolCallId:
            call.id || `call_${Math.random().toString(36).substr(2, 9)}`,
          toolName: call.function.name,
          args:
            typeof call.function.arguments === "string"
              ? JSON.parse(call.function.arguments)
              : call.function.arguments,
        }));
        return { toolCalls: legacyToolCalls };
      }
    } catch (error) {
      // JSON parsing failed, treat as regular text
    }

    return { text: content };
  }

  private convertPromptToMessages(
    prompt: Parameters<LanguageModelV1["doGenerate"]>[0]["prompt"]
  ): ChatMessage[] {
    return prompt.map((message) => {
      if (message.role === "system") {
        return {
          role: "system",
          content: Array.isArray(message.content)
            ? message.content
                .map((part) =>
                  part.type === "text" ? part.text : "[unsupported content]"
                )
                .join("\n")
            : message.content,
        };
      }

      if (message.role === "user") {
        return {
          role: "user",
          content: Array.isArray(message.content)
            ? message.content
                .map((part) =>
                  part.type === "text" ? part.text : "[unsupported content]"
                )
                .join("\n")
            : message.content,
        };
      }

      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: Array.isArray(message.content)
            ? message.content
                .map((part) =>
                  part.type === "text" ? part.text : "[unsupported content]"
                )
                .join("\n")
            : message.content,
        };
      }

      // Handle tool / function role messages so the model can see results
      const msgAny = message as any;
      if (msgAny.role === "tool" || msgAny.role === "function") {
        const name = msgAny.name || "tool";
        const toolResult =
          typeof msgAny.content === "string"
            ? msgAny.content
            : JSON.stringify(msgAny.content);
        return {
          role: "assistant",
          content: `Result from ${name}: ${toolResult}`,
        };
      }

      // Default fallback
      return {
        role: "user",
        content: String((message as any).content),
      };
    });
  }
}
