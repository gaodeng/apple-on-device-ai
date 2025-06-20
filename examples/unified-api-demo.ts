import { chat, appleAISDK } from "../src/apple-ai.js";
import { z } from "zod";
import type { JSONSchema7 } from "json-schema";

async function main() {
  console.log("🍎 Chat API Demo - All Capabilities in One Function");
  console.log("======================================================\n");

  // Check availability first
  const availability = await appleAISDK.checkAvailability();
  if (!availability.available) {
    console.log("❌ Apple Intelligence not available:", availability.reason);
    return;
  }

  // 1. Basic text generation
  console.log("1️⃣  Basic Text Generation");
  console.log("--------------------------");
  try {
    const basic = await chat({
      messages: "What is the capital of France?",
      temperature: 0.7,
    });
    console.log("Response:", basic.text);
  } catch (error) {
    console.error("Error:", error);
  }

  // 2. Generation with message history
  console.log("\n2️⃣  Generation with Message History");
  console.log("------------------------------------");
  try {
    const withHistory = await chat({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "My name is Alice." },
        { role: "assistant", content: "Nice to meet you, Alice!" },
        { role: "user", content: "What's my name?" },
      ],
    });
    console.log("Response:", withHistory.text);
  } catch (error) {
    console.error("Error:", error);
  }

  // 3. Structured generation with Zod schema
  console.log("\n3️⃣  Structured Generation with Zod");
  console.log("-----------------------------------");
  const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
    city: z.string(),
  });

  try {
    const structured = await chat({
      messages: "Provide sample data for the following structure", // Guardrail-safe prompt
      schema: PersonSchema,
    });
    console.log("Generated object:", structured.object);
    console.log("Text representation:", structured.text);
  } catch (error) {
    console.error("Error:", error);
  }

  // 4. Tool calling
  console.log("\n4️⃣  Tool Calling");
  console.log("-----------------");
  try {
    const weatherTool = {
      name: "get_weather",
      description: "Get the current weather for a location",
      jsonSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      } as JSONSchema7,
      handler: async (args: any) => {
        return { temperature: 22, condition: "sunny", location: args.location };
      },
    };

    const withTools = await chat({
      messages: "What's the weather in Tokyo?",
      tools: [weatherTool],
    });
    console.log("Response:", withTools.text);
    if (withTools.toolCalls) {
      console.log("Tool calls:", JSON.stringify(withTools.toolCalls, null, 2));
    }
  } catch (error) {
    console.error("Error:", error);
  }

  // 5. Streaming
  console.log("\n5️⃣  Streaming Response");
  console.log("----------------------");
  try {
    console.log("Streaming: ");
    const stream = chat({
      messages: "Count from 1 to 5 slowly",
      stream: true,
    });

    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }
    console.log("\n");
  } catch (error) {
    console.error("Error:", error);
  }

  // 6. Advanced: Streaming with tools
  console.log("\n6️⃣  Advanced: Streaming with Tools");
  console.log("-----------------------------------");
  try {
    const mathTool = {
      name: "calculate",
      description: "Perform basic math operations",
      jsonSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["add", "subtract", "multiply", "divide"],
          },
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["operation", "a", "b"],
      } as JSONSchema7,
      handler: async (args: any) => {
        const { operation, a, b } = args;
        console.log("[Tool call] Operation:", operation, "A:", a, "B:", b);
        switch (operation) {
          case "add":
            return a + b;
          case "subtract":
            return a - b;
          case "multiply":
            return a * b;
          case "divide":
            return b !== 0 ? a / b : "Error: Division by zero";
        }
      },
    };

    console.log("Streaming with tools: ");
    const toolStream = chat({
      messages: "What is 15 multiplied by 7?",
      tools: [mathTool],
      stream: true,
      stopAfterToolCalls: true,
    });

    let chunkCount = 0;
    for await (const chunk of toolStream) {
      chunkCount++;
      process.stdout.write(chunk);
    }
    console.log(`\n(Received ${chunkCount} chunks)`);
  } catch (error) {
    console.error("Error:", error);
  }

  // 7. Test simple streaming without tools to compare
  console.log("\n7️⃣  Simple Streaming (no tools for comparison)");
  console.log("------------------------------------------------");
  try {
    console.log("Streaming: ");
    const simpleStream = chat({
      messages: "What is 15 multiplied by 7? Just give me the answer.",
      stream: true,
    });

    let chunkCount = 0;
    for await (const chunk of simpleStream) {
      chunkCount++;
      process.stdout.write(chunk);
    }
    console.log(`\n(Received ${chunkCount} chunks)`);
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("✅ Chat API demo complete!");
}

main().catch(console.error);
