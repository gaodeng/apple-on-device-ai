import { defineEventHandler, readBody } from "h3";
import { appleAISDK, chat } from "../../apple-ai";
import type { ChatMessage, EphemeralTool } from "../../apple-ai";
import type { JSONSchema7 } from "json-schema";
import type {
  ChatCompletionCreateParams,
  ChatCompletionChunk,
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionTool,
} from "openai/resources/chat";

function convertMessages(
  openAIMessages: ChatCompletionCreateParams["messages"]
): ChatMessage[] {
  return openAIMessages.map((msg) => ({
    role: msg.role as "system" | "user" | "assistant" | "tool" | "tool_calls",
    content:
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content),
    name: "name" in msg ? msg.name : undefined,
    tool_calls:
      msg.role === "assistant" && "tool_calls" in msg
        ? msg.tool_calls
        : undefined,
    tool_call_id:
      msg.role === "tool" && "tool_call_id" in msg
        ? msg.tool_call_id
        : undefined,
  }));
}

function createChatCompletionMessage(
  role: "assistant",
  content: string | null,
  tool_calls?: ChatCompletionMessage["tool_calls"]
): ChatCompletionMessage {
  const message: ChatCompletionMessage = {
    role,
    content,
    refusal: null,
  };

  if (tool_calls) {
    message.tool_calls = tool_calls;
  }

  return message;
}

export const chatCompletions = defineEventHandler(async (event) => {
  if (event.node.req.method !== "POST") {
    event.node.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const body = await readBody<ChatCompletionCreateParams>(event);
  const {
    messages,
    temperature: rawTemperature,
    max_tokens: rawMaxTokens,
    stream = false,
    tools,
    response_format,
  } = body;

  // Validate that messages is present and an array
  if (!Array.isArray(messages)) {
    event.node.res.statusCode = 400;
    return { error: "'messages' field is required and must be an array" };
  }

  // Convert null values to undefined for our API
  const temperature = rawTemperature !== null ? rawTemperature : undefined;
  const maxTokens = rawMaxTokens !== null ? rawMaxTokens : undefined;

  // Check Apple Intelligence availability
  const availability = await appleAISDK.checkAvailability();
  if (!availability.available) {
    event.node.res.statusCode = 503;
    return {
      error: {
        message: `Apple Intelligence not available: ${availability.reason}`,
        type: "service_unavailable",
        code: "apple_intelligence_unavailable",
      },
    };
  }

  const convertedMessages = convertMessages(messages);

  if (stream) {
    // Handle streaming response
    event.node.res.setHeader("Content-Type", "text/event-stream");
    event.node.res.setHeader("Cache-Control", "no-cache");
    event.node.res.setHeader("Connection", "keep-alive");
    event.node.res.setHeader("X-Accel-Buffering", "no");

    const res = event.node.res;

    try {
      const streamId = `chatcmpl-${crypto.randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      if (tools && tools.length > 0) {
        // Convert tools to our format
        const ephemeralTools: EphemeralTool<JSONSchema7>[] = tools.map(
          (tool: ChatCompletionTool) => ({
            name: tool.function.name,
            description: tool.function.description || "",
            jsonSchema: (tool.function.parameters || {}) as JSONSchema7,
            handler: async (args: Record<string, unknown>) => ({}), // Dummy handler
          })
        );

        // Use chat with tools and streaming
        const result = chat({
          messages: convertedMessages,
          tools: ephemeralTools,
          temperature,
          maxTokens,
          stream: true,
        });

        for await (const chunk of result) {
          const data: ChatCompletionChunk = {
            id: streamId,
            object: "chat.completion.chunk",
            created,
            model: "apple-on-device",
            choices: [
              {
                index: 0,
                delta: {
                  content: chunk,
                },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } else if (
        response_format?.type === "json_schema" &&
        response_format.json_schema
      ) {
        // Structured output - use chat with schema
        const result = await chat({
          messages: convertedMessages,
          schema: response_format.json_schema.schema,
          temperature,
          maxTokens,
        });

        // For structured output, we send the result as a single chunk
        const data: ChatCompletionChunk = {
          id: streamId,
          object: "chat.completion.chunk",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              delta: {
                content: JSON.stringify(result.object),
              },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } else {
        // Regular streaming
        const iterator = appleAISDK.streamChatCompletion(convertedMessages, {
          temperature,
          maxTokens,
        });

        for await (const chunk of iterator) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }

      // Send final done message
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      const errorData = {
        error: {
          message: (error as Error).message,
          type: "internal_error",
          code: "stream_error",
        },
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }
  } else {
    // Handle non-streaming response
    try {
      if (tools && tools.length > 0) {
        // Convert tools to our format
        const ephemeralTools: EphemeralTool<JSONSchema7>[] = tools.map(
          (tool: ChatCompletionTool) => ({
            name: tool.function.name,
            description: tool.function.description || "",
            jsonSchema: (tool.function.parameters || {}) as JSONSchema7,
            handler: async (args: Record<string, unknown>) => ({}), // Dummy handler
          })
        );

        const result = await chat({
          messages: convertedMessages,
          tools: ephemeralTools,
          temperature,
          maxTokens,
        });

        const completionId = `chatcmpl-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        if (result.toolCalls && result.toolCalls.length > 0) {
          // Format tool calls response
          const response: ChatCompletion = {
            id: completionId,
            object: "chat.completion",
            created,
            model: "apple-on-device",
            choices: [
              {
                index: 0,
                message: createChatCompletionMessage(
                  "assistant",
                  result.text || null,
                  result.toolCalls
                ),
                finish_reason: "tool_calls",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          };
          return response;
        } else {
          // Regular text response
          const response: ChatCompletion = {
            id: completionId,
            object: "chat.completion",
            created,
            model: "apple-on-device",
            choices: [
              {
                index: 0,
                message: createChatCompletionMessage(
                  "assistant",
                  result.text || ""
                ),
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          };
          return response;
        }
      } else if (
        response_format?.type === "json_schema" &&
        response_format.json_schema
      ) {
        // Structured output
        const result = await chat({
          messages: convertedMessages,
          schema: response_format.json_schema.schema,
          temperature,
          maxTokens,
        });

        const completionId = `chatcmpl-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        const response: ChatCompletion = {
          id: completionId,
          object: "chat.completion",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              message: createChatCompletionMessage(
                "assistant",
                JSON.stringify(result.object)
              ),
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };
        return response;
      } else {
        // Regular chat completion
        const responseText = await appleAISDK.generateResponseWithHistory(
          convertedMessages,
          {
            temperature,
            maxTokens,
          }
        );

        const completionId = `chatcmpl-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        const response: ChatCompletion = {
          id: completionId,
          object: "chat.completion",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              message: createChatCompletionMessage("assistant", responseText),
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };
        return response;
      }
    } catch (error) {
      event.node.res.statusCode = 500;
      return {
        error: {
          message: (error as Error).message,
          type: "internal_error",
          code: "completion_error",
        },
      };
    }
  }
});
