import { generateObject, generateText, streamText, tool } from "ai";
import { defineEventHandler, readBody } from "h3";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  ChatCompletionTool,
} from "openai/resources/chat";
import { z } from "zod";
import { appleAI } from "../../apple-ai-provider";

// Helper to convert OpenAI messages to simple format for AI SDK
function convertOpenAIMessages(
  messages: ChatCompletionCreateParams["messages"]
) {
  return messages.map((msg) => {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

    return {
      role: msg.role as "system" | "user" | "assistant",
      content,
    };
  });
}

// Helper to convert JSON Schema to Zod schema
function jsonSchemaToZod(schema: Record<string, any>): z.ZodType<any> {
  if (schema.type === "object" && schema.properties) {
    const zodFields: Record<string, z.ZodType<any>> = {};

    for (const [key, value] of Object.entries(
      schema.properties as Record<string, any>
    )) {
      let fieldSchema: z.ZodType<any>;

      if (value.type === "string") {
        fieldSchema = z.string();
      } else if (value.type === "number") {
        fieldSchema = z.number();
      } else if (value.type === "integer") {
        fieldSchema = z.number().int();
      } else if (value.type === "boolean") {
        fieldSchema = z.boolean();
      } else if (value.type === "array") {
        fieldSchema = z.array(z.any());
      } else {
        fieldSchema = z.any();
      }

      if (value.description) {
        fieldSchema = fieldSchema.describe(value.description);
      }

      if (!schema.required?.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }

      zodFields[key] = fieldSchema;
    }

    return z.object(zodFields);
  }

  return z.any();
}

// Helper to convert OpenAI tools to AI SDK tools
function convertOpenAITools(openAITools: ChatCompletionTool[]) {
  const tools: Record<string, any> = {};

  for (const openAITool of openAITools) {
    const toolName = openAITool.function.name;
    const inputSchema = jsonSchemaToZod(openAITool.function.parameters || {});

    tools[toolName] = tool({
      description: openAITool.function.description || "",
      inputSchema,
    });
  }

  return tools;
}

// Helper to create OpenAI-compatible chat completion message
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
    stream = false,
    tools,
    response_format,
  } = body;

  // Validate required fields
  if (!Array.isArray(messages)) {
    event.node.res.statusCode = 400;
    return { error: "'messages' field is required and must be an array" };
  }

  // Validate messages array is not empty
  if (messages.length === 0) {
    event.node.res.statusCode = 400;
    return { error: "messages array cannot be empty" };
  }

  // Convert null values to undefined for our API
  const temperature = rawTemperature !== null ? rawTemperature : undefined;
  const maxOutputTokens =
    body.max_completion_tokens ?? body.max_tokens ?? undefined;

  // Create Apple AI model
  const appleAIModel = appleAI("apple-on-device", { temperature });
  const convertedMessages = convertOpenAIMessages(messages);
  const aiSDKTools = tools ? convertOpenAITools(tools) : undefined;

  // Test availability by trying a simple call
  try {
    await generateText({
      model: appleAIModel,
      prompt: "test",
      maxOutputTokens: 1,
    });
  } catch (error) {
    event.node.res.statusCode = 503;
    return {
      error: {
        message: `Apple Intelligence not available: ${
          (error as Error).message
        }`,
        type: "service_unavailable",
        code: "apple_intelligence_unavailable",
      },
    };
  }

  if (stream) {
    // Streaming response using AI SDK
    event.node.res.setHeader("Content-Type", "text/event-stream");
    event.node.res.setHeader("Cache-Control", "no-cache");
    event.node.res.setHeader("Connection", "keep-alive");
    event.node.res.setHeader("X-Accel-Buffering", "no");

    const res = event.node.res;
    const streamId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    try {
      if (
        response_format?.type === "json_schema" &&
        response_format.json_schema?.schema
      ) {
        // Structured output streaming using AI SDK generateObject
        const zodSchema = jsonSchemaToZod(response_format.json_schema.schema);

        const result = await generateObject({
          model: appleAIModel,
          messages: convertedMessages,
          schema: zodSchema,
          temperature,
          maxOutputTokens,
        });

        // Send structured result as single chunk
        const data: ChatCompletionChunk = {
          id: streamId,
          object: "chat.completion.chunk",
          created,
          model: "apple-on-device",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: JSON.stringify(result.object),
              },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } else {
        // Regular streaming with optional tools using AI SDK
        const { fullStream } = streamText({
          model: appleAIModel,
          messages: convertedMessages,
          tools: aiSDKTools,
          temperature,
          maxOutputTokens,
        });

        let sentRole = false;

        // Stream content and handle tool calls
        for await (const chunk of fullStream) {
          if (chunk.type === "text") {
            const delta: Record<string, unknown> = {};

            if (!sentRole) {
              delta.role = "assistant";
              sentRole = true;
            }

            if (chunk.text) {
              delta.content = chunk.text;
            }

            const data: ChatCompletionChunk = {
              id: streamId,
              object: "chat.completion.chunk",
              created,
              model: "apple-on-device",
              choices: [
                {
                  index: 0,
                  delta,
                  finish_reason: null,
                },
              ],
            };

            res.write(`data: ${JSON.stringify(data)}\n\n`);
          } else if (chunk.type === "tool-call") {
            // Stream tool calls
            const toolCallDelta: ChatCompletionChunk = {
              id: streamId,
              object: "chat.completion.chunk",
              created,
              model: "apple-on-device",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: chunk.toolCallId,
                        type: "function",
                        function: {
                          name: chunk.toolName,
                          arguments: JSON.stringify(chunk.input),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(toolCallDelta)}\n\n`);
          }
          // Note: tool-result chunks are handled by the AI SDK internally
        }
      }

      // Send final chunk
      const finalData: ChatCompletionChunk = {
        id: streamId,
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
      res.write(`data: ${JSON.stringify(finalData)}\n\n`);
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
    // Non-streaming response using AI SDK
    try {
      if (
        response_format?.type === "json_schema" &&
        response_format.json_schema?.schema
      ) {
        // Structured output using AI SDK generateObject
        const zodSchema = jsonSchemaToZod(response_format.json_schema.schema);

        const result = await generateObject({
          model: appleAIModel,
          messages: convertedMessages,
          schema: zodSchema,
          temperature,
          maxOutputTokens,
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
            prompt_tokens: result.usage?.inputTokens ?? 0,
            completion_tokens: result.usage?.outputTokens ?? 0,
            total_tokens: result.usage?.totalTokens ?? 0,
          },
        };
        return response;
      } else {
        // Regular generation with optional tools using AI SDK
        const result = await generateText({
          model: appleAIModel,
          messages: convertedMessages,
          tools: aiSDKTools,
          temperature,
          maxOutputTokens,
        });

        const completionId = `chatcmpl-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        // Check for tool calls
        const toolCalls = result.toolCalls?.map((call) => ({
          id: call.toolCallId,
          type: "function" as const,
          function: {
            name: call.toolName,
            arguments: JSON.stringify(call.input),
          },
        }));

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
                toolCalls && toolCalls.length > 0 ? toolCalls : undefined
              ),
              finish_reason:
                toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: result.usage?.inputTokens ?? 0,
            completion_tokens: result.usage?.outputTokens ?? 0,
            total_tokens: result.usage?.totalTokens ?? 0,
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
