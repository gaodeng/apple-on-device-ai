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

async function main() {
  console.log("🚀 Apple Intelligence with Vercel AI SDK");
  console.log(
    "Demonstrating native early termination (default behavior with tools)\n"
  );

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
      calculator: tool({
        description: "Perform mathematical calculations",
        inputSchema: z.object({
          expression: z
            .string()
            .describe("Mathematical expression to evaluate"),
        }),
        execute: async ({ expression }) => {
          // Simple evaluation for demo purposes
          const result = eval(expression);
          return { expression, result };
        },
      }),
    },
    prompt:
      "What's the weather in San Francisco and Tokyo? Also calculate 25 * 4.",
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
        console.log(`\n🔧 Tool call: ${delta.toolName}`);
        console.log(`   Arguments: ${JSON.stringify(delta.input)}`);
        break;
      }

      case "tool-result": {
        const transformedDelta: ToolResultPart = {
          ...delta,
          output: { type: "json", value: delta.output },
        };
        toolResponses.push(transformedDelta);

        console.log(`✅ Tool result: ${JSON.stringify(delta.output)}`);
        break;
      }

      case "start-step": {
        console.log(`\n📝 Processing step...`);
        break;
      }
    }
  }

  console.log(`\n\n📊 Summary:`);
  console.log(`   • Tool calls made: ${toolCalls.length}`);
  console.log(`   • Final response: ${fullResponse.length} characters`);
  console.log(
    `   • Early termination: ${
      toolCalls.length > 0 ? "✅ Active (default)" : "❌ No tools called"
    }`
  );

  if (toolCalls.length > 0) {
    console.log(
      `\n💡 Apple Intelligence automatically terminates after tool execution,`
    );
    console.log(
      `   optimizing compute usage by default when tools are present.`
    );
  }
}

main().catch(console.error);
