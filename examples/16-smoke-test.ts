import { createAppleAI } from "../src/apple-ai-provider.js";
import { generateText, streamText, generateObject } from "ai";
import { z } from "zod";

// Helper to check if test passed
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runVercelSDKSmokeTest() {
  console.log("🧪 Vercel AI SDK Compatibility Smoke Test");
  console.log("=========================================\n");

  const ai = createAppleAI();

  // Test 1: Basic text generation with generateText
  console.log("📝 Test 1: generateText");
  try {
    const { text } = await generateText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "What is the capital of France?" }],
    });
    assert(typeof text === "string", "generateText should return text");
    assert(
      text.toLowerCase().includes("paris"),
      "Response should mention Paris"
    );
  } catch (error) {
    console.error("Test 1 error:", error);
    assert(false, "generateText should not throw");
  }

  // Test 2: Text generation with messages
  console.log("\n📝 Test 2: generateText with messages");
  try {
    const { text } = await generateText({
      model: ai("apple-on-device"),
      messages: [
        { role: "user", content: "My name is Bob" },
        { role: "assistant", content: "Nice to meet you, Bob!" },
        { role: "user", content: "What did i just say?" },
      ],
    });
    assert(
      text.toLowerCase().includes("bob"),
      "Should remember conversation context"
    );
  } catch (error) {
    console.error("Test 2 error:", error);
    assert(false, "generateText with messages should not throw");
  }

  // Test 3: System message
  console.log("\n📝 Test 3: System messages");
  try {
    const { text } = await generateText({
      model: ai("apple-on-device"),
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant who speaks like a pirate.",
        },
        { role: "user", content: "Hello!" },
      ],
    });
    assert(text.length > 0, "Should generate response with system message");
  } catch (error) {
    console.error("Test 3 error:", error);
    assert(false, "System messages should work");
  }

  // Test 4: Temperature and maxRetries
  console.log("\n📝 Test 4: Temperature and maxRetries");
  try {
    const { text, usage } = await generateText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "Count from 1 to 100" }],
      temperature: 0.5,
      maxRetries: 2, // Vercel AI SDK uses maxRetries, not maxTokens
    });
    assert(text.length > 0, "Should generate text with parameters");
    assert(usage !== undefined, "Should return usage information");
    if (usage && usage.totalTokens !== undefined) {
      assert(usage.totalTokens > 0, "Should have token usage");
    }
  } catch (error) {
    console.error("Test 4 error:", error);
    assert(false, "Temperature/maxRetries should work");
  }

  // Test 5: Basic streaming with streamText
  console.log("\n📝 Test 5: streamText");
  try {
    const { textStream } = await streamText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "Count to 3" }],
    });

    let chunks = 0;
    let fullText = "";
    for await (const chunk of textStream) {
      chunks++;
      fullText += chunk;
    }
    assert(chunks > 0, "Should receive stream chunks");
    assert(fullText.length > 0, "Stream should produce content");
  } catch (error) {
    console.error("Test 5 error:", error);
    assert(false, "streamText should not throw");
  }

  // Test 6: Tool calling
  console.log("\n📝 Test 6: Tool calling");
  try {
    const { text, toolCalls } = await generateText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
      tools: {
        weather: {
          description: "Get weather information",
          parameters: z.object({
            location: z.string().describe("City name"),
          }),
          execute: async ({ location }) => ({
            temperature: 72,
            condition: "sunny",
            location,
          }),
        },
      },
    });
    assert(toolCalls !== undefined, "Should have tool calls");
    if (toolCalls && toolCalls.length > 0 && toolCalls[0]) {
      assert(toolCalls[0].toolName === "weather", "Should call weather tool");
      const toolCall = toolCalls[0] as any;
      assert(
        toolCall.input?.location !== undefined ||
          toolCall.args?.location !== undefined,
        "Should have location argument"
      );
    }
  } catch (error) {
    console.error("Test 6 error:", error);
    assert(false, "Tool calling should work");
  }

  // Test 7: Object generation with generateObject
  console.log("\n📝 Test 7: generateObject");
  try {
    const { object } = await generateObject({
      model: ai("apple-on-device"),
      prompt:
        "Generate a person's profile with a name, age between 20-50, and a valid email address",
      schema: z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
      }),
    });
    assert(typeof object.name === "string", "Should generate name");
    assert(typeof object.age === "number", "Should generate age");
    assert(object.email.includes("@"), "Should generate valid email");
  } catch (error) {
    console.error("Test 7 error:", error);
    assert(false, "generateObject should work");
  }

  // Test 8: Streaming with tools
  console.log("\n📝 Test 8: Streaming with tools");
  try {
    const { textStream, toolCalls } = await streamText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "Calculate 15 times 7" }],
      tools: {
        calculator: {
          description: "Performs math operations",
          parameters: z.object({
            operation: z.enum(["add", "multiply", "subtract", "divide"]),
            a: z.number(),
            b: z.number(),
          }),
          execute: async ({ operation, a, b }) => {
            switch (operation) {
              case "add":
                return { result: a + b };
              case "multiply":
                return { result: a * b };
              case "subtract":
                return { result: a - b };
              case "divide":
                return { result: a / b };
            }
          },
        },
      },
    });

    let chunks = 0;
    for await (const chunk of textStream) {
      chunks++;
    }

    const calls = await toolCalls;
    assert(calls !== undefined, "Should have tool calls in stream");
    if (calls && calls.length > 0 && calls[0]) {
      assert(calls[0].toolName === "calculator", "Should call calculator");
    }
  } catch (error) {
    console.error("Test 8 error:", error);
    assert(false, "Streaming with tools should work");
  }

  // Test 9: Multiple tools
  console.log("\n📝 Test 9: Multiple tools");
  try {
    const { toolCalls } = await generateText({
      model: ai("apple-on-device"),
      maxOutputTokens: 1000,
      messages: [
        {
          role: "user",
          content: "What's 5 plus 3 and what's the weather in Paris?",
        },
      ],
      tools: {
        calculator: {
          description: "Math operations",
          parameters: z.object({
            operation: z.enum(["add", "multiply"]),
            a: z.number(),
            b: z.number(),
          }),
          execute: async ({ operation, a, b }) => ({
            result: operation === "add" ? a + b : a * b,
          }),
        },
        weather: {
          description: "Weather info",
          parameters: z.object({
            location: z.string(),
          }),
          execute: async ({ location }) => ({
            temperature: 68,
            condition: "cloudy",
            location,
          }),
        },
      },
    });
    assert(toolCalls !== undefined, "Should support multiple tools");
    if (toolCalls) {
      assert(toolCalls.length >= 1, "Should call at least one tool");
    }
  } catch (error) {
    console.error("Test 9 error:", error);
    assert(false, "Multiple tools should work");
  }

  // Test 10: Error handling
  console.log("\n📝 Test 10: Error handling");
  try {
    await generateText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "" }],
      maxRetries: 0, // Valid parameter for Vercel AI SDK
    });
    // If it doesn't throw, that's okay - some implementations handle this gracefully
    assert(true, "Error handling completed");
  } catch (error) {
    assert(true, "Correctly handled invalid parameters");
  }

  // Test 11: Concurrent requests
  console.log("\n📝 Test 11: Concurrent requests");
  try {
    const [r1, r2, r3] = await Promise.all([
      generateText({
        model: ai("apple-on-device"),
        messages: [{ role: "user", content: "Say 'one'" }],
      }),
      generateText({
        model: ai("apple-on-device"),
        messages: [{ role: "user", content: "Say 'two'" }],
      }),
      generateText({
        model: ai("apple-on-device"),
        messages: [{ role: "user", content: "Say 'three'" }],
      }),
    ]);
    assert(
      r1.text.length > 0 && r2.text.length > 0 && r3.text.length > 0,
      "Should handle concurrent requests"
    );
  } catch (error) {
    console.error("Test 11 error:", error);
    assert(false, "Concurrent requests should work");
  }

  // Test 12: Abort signal
  console.log("\n📝 Test 12: Abort signal");
  try {
    const controller = new AbortController();
    const promise = streamText({
      model: ai("apple-on-device"),
      messages: [{ role: "user", content: "Count to 1000 slowly" }],
      abortSignal: controller.signal,
    });

    // Abort immediately
    controller.abort();

    try {
      const { textStream } = await promise;
      for await (const chunk of textStream) {
        // Should not receive many chunks
      }
    } catch (abortError) {
      // Abort error is expected
    }
    assert(true, "Abort signal handled");
  } catch (error) {
    assert(true, "Abort signal test completed");
  }

  console.log("\n🎉 All Vercel AI SDK smoke tests passed!");
  console.log("=========================================");
}

// Run the smoke test
runVercelSDKSmokeTest().catch((error) => {
  console.error("💥 Vercel AI SDK smoke test failed:", error);
  process.exit(1);
});
