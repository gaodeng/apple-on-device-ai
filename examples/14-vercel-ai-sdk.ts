import {
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart,
} from "ai";
import { z } from "zod";
import { appleAI } from "../src/apple-ai-provider";

const messages: ModelMessage[] = [];

async function main() {
  let toolResponseAvailable = false;

  const result = streamText({
    model: appleAI("apple-on-device"),
    stopWhen: stepCountIs(3),
    tools: {
      weather: tool({
        description: "Get the weather in a location",
        inputSchema: z.object({
          location: z.string().describe("The location to get the weather for"),
        }),
        execute: async ({ location }) => {
          return Promise.resolve({
            location,
            temperature: location === "San Francisco" ? 49 : 20,
          });
        },
      }),
    },
    prompt: "What is the weather in San Francisco and Tokyo?",
    maxOutputTokens: 1000,
  });

  let fullResponse = "";
  const toolCalls: ToolCallPart[] = [];
  const toolResponses: ToolResultPart[] = [];

  for await (const delta of result.fullStream) {
    switch (delta.type) {
      case "text": {
        fullResponse += delta.text;
        process.stdout.write(delta.text);
        break;
      }

      case "tool-call": {
        toolCalls.push(delta);

        console.log(
          `\nTool call: '${delta.toolName}' ${JSON.stringify(delta.input)}`
        );
        break;
      }

      case "tool-result": {
        // Transform to new format
        const transformedDelta: ToolResultPart = {
          ...delta,
          output: { type: "json", value: delta.output },
        };
        toolResponses.push(transformedDelta);

        console.log(
          `\nTool response: '${delta.toolName}' ${JSON.stringify(delta.output)}`
        );
        break;
      }
      case "start-step": {
        console.log("[start-step]", delta);
        break;
      }
    }
  }
  process.stdout.write("\n\n");

  messages.push({
    role: "assistant",
    content: [{ type: "text", text: fullResponse }, ...toolCalls],
  });

  if (toolResponses.length > 0) {
    messages.push({ role: "tool", content: toolResponses });
  }

  toolResponseAvailable = toolCalls.length > 0;
}

main().catch(console.error);
