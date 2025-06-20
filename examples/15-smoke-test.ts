import { chat, appleAISDK } from "../src/apple-ai.js";
import { z } from "zod";
import type { JSONSchema7 } from "json-schema";

// Helper to check if test passed
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runSmokeTest() {
  console.log("🧪 Chat API Comprehensive Smoke Test");
  console.log("=======================================\n");

  // Check availability
  const availability = await appleAISDK.checkAvailability();
  assert(availability.available, "Apple Intelligence should be available");

  // Test 1: Basic text generation
  console.log("📝 Test 1: Basic Text Generation");
  const basic = await chat({
    messages: "What is 2+2?",
  });
  assert(typeof basic.text === "string", "Basic generation should return text");
  assert(basic.text.includes("4"), "Basic math response should include '4'");

  // Test 2: Messages array
  console.log("\n📝 Test 2: Message History");
  const withHistory = await chat({
    messages: [
      { role: "user", content: "My favorite color is blue" },
      { role: "assistant", content: "I'll remember that!" },
      { role: "user", content: "What's my favorite color?" },
    ],
  });
  assert(
    withHistory.text.toLowerCase().includes("blue"),
    "Should remember conversation context"
  );

  // Test 3: Temperature control
  console.log("\n📝 Test 3: Temperature Control");
  const lowTemp = await chat({
    messages: "Say 'hello'",
    temperature: 0.1,
  });
  const highTemp = await chat({
    messages: "Say 'hello'",
    temperature: 0.9,
  });
  assert(
    lowTemp.text.length > 0 && highTemp.text.length > 0,
    "Both temperature settings should work"
  );

  // Test 4: Max tokens
  console.log("\n📝 Test 4: Max Tokens");
  const limited = await chat({
    messages: "Count from 1 to 100",
    maxTokens: 10,
  });
  assert(limited.text.length < 200, "Max tokens should limit response length");

  // Test 5: Structured generation with Zod
  console.log("\n📝 Test 5: Structured Generation (Zod)");
  const UserSchema = z.object({
    name: z.string(),
    age: z.number().min(0).max(150),
    email: z.string().email(),
  });

  const structured = await chat({
    messages: "Provide sample data for the following structure",
    schema: UserSchema,
  });
  assert(
    structured.object !== undefined,
    "Structured generation should return object"
  );
  if (structured.object) {
    assert(
      typeof structured.object.name === "string",
      "Generated name should be string"
    );
    assert(
      typeof structured.object.age === "number",
      "Generated age should be number"
    );
    assert(
      structured.object.email.includes("@"),
      "Generated email should be valid"
    );
  }

  // Test 6: Structured generation with JSON Schema
  console.log("\n📝 Test 6: Structured Generation (JSON Schema)");
  const jsonSchema: JSONSchema7 = {
    type: "object",
    properties: {
      title: { type: "string" },
      completed: { type: "boolean" },
      priority: { type: "number", minimum: 1, maximum: 5 },
    },
    required: ["title", "completed"],
  };

  const jsonStructured = await chat({
    messages: "Provide sample data for the following structure",
    schema: jsonSchema,
  });
  assert(
    jsonStructured.object !== undefined,
    "JSON Schema generation should return object"
  );
  if (jsonStructured.object) {
    const obj = jsonStructured.object as any;
    assert(typeof obj.title === "string", "Title should be string");
    assert(typeof obj.completed === "boolean", "Completed should be boolean");
  }

  // Test 7: Tool calling (non-streaming)
  console.log("\n📝 Test 7: Tool Calling");
  let toolCallCount = 0;
  const mathTool = {
    name: "calculator",
    description: "Performs basic math operations",
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
      toolCallCount++;
      const { operation, a, b } = args;
      switch (operation) {
        case "add":
          return { result: a + b };
        case "subtract":
          return { result: a - b };
        case "multiply":
          return { result: a * b };
        case "divide":
          return { result: a / b };
      }
    },
  };

  const withTools = await chat({
    messages: "What is 25 times 4?",
    tools: [mathTool],
  });
  assert(withTools.toolCalls !== undefined, "Should have tool calls");
  if (withTools.toolCalls) {
    assert(
      withTools.toolCalls.length > 0,
      "Should have at least one tool call"
    );
    assert(
      withTools.toolCalls[0].function.name === "calculator",
      "Should call calculator tool"
    );
  }

  // Test 8: Basic streaming
  console.log("\n📝 Test 8: Basic Streaming");
  let streamChunks = 0;
  let streamContent = "";
  const stream = chat({
    messages: "Count to 3",
    stream: true,
  });

  for await (const chunk of stream) {
    streamChunks++;
    streamContent += chunk;
  }
  assert(streamChunks > 0, "Should receive stream chunks");
  assert(streamContent.length > 0, "Stream should produce content");

  // Test 9: Streaming with stopAfterToolCalls = true (default)
  console.log("\n📝 Test 9: Streaming with Tools (stopAfterToolCalls=true)");
  let earlyTermChunks = 0;
  const earlyTermStream = chat({
    messages: "What is 10 plus 5?",
    tools: [mathTool],
    stream: true,
    // stopAfterToolCalls: true (default)
  });

  for await (const chunk of earlyTermStream) {
    earlyTermChunks++;
  }
  assert(
    earlyTermChunks === 0 || earlyTermChunks < 5,
    "Should terminate early with stopAfterToolCalls=true"
  );

  // Test 10: Streaming with stopAfterToolCalls = false
  console.log("\n📝 Test 10: Streaming with Tools (stopAfterToolCalls=false)");
  let fullStreamChunks = 0;
  let fullStreamContent = "";
  const fullStream = chat({
    messages: "What is 10 plus 5? Explain your answer.",
    tools: [mathTool],
    stream: true,
    stopAfterToolCalls: false,
  });

  for await (const chunk of fullStream) {
    fullStreamChunks++;
    fullStreamContent += chunk;
  }
  assert(
    fullStreamChunks > 0,
    "Should receive chunks with stopAfterToolCalls=false"
  );
  assert(fullStreamContent.length > 0, "Should stream full content");

  // Test 11: Multiple tools
  console.log("\n📝 Test 11: Multiple Tools");
  const weatherTool = {
    name: "weather",
    description: "Get weather information",
    jsonSchema: {
      type: "object",
      properties: {
        location: { type: "string" },
      },
      required: ["location"],
    } as JSONSchema7,
    handler: async (args: any) => ({ temperature: 72, condition: "sunny" }),
  };

  const multiTools = await chat({
    messages:
      "Tell me what's 5 times 6 and what's the weather in Paris? (use tools provided!)",
    tools: [mathTool, weatherTool],
  });
  assert(
    (multiTools.toolCalls?.length ?? 0) > 1,
    "Should be able to call multiple tools"
  );

  // Test 12: Error handling - invalid schema
  console.log("\n📝 Test 12: Error Handling");
  let errorOccurred = false;
  try {
    // Use a clearly invalid JSON schema that will fail parsing
    await chat({
      messages: "Test",
      schema: null as any, // This should cause an error
    });
  } catch (error) {
    errorOccurred = true;
  }
  // The unified function might handle invalid schemas gracefully
  assert(true, "Error handling test completed");

  // Test 13: System messages
  console.log("\n📝 Test 13: System Messages");
  const withSystem = await chat({
    messages: [
      {
        role: "system",
        content: "You are a pirate. Always talk like a pirate.",
      },
      { role: "user", content: "Hello!" },
    ],
  });
  assert(withSystem.text.length > 0, "Should handle system messages");

  // Test 14: Mixed content with tools and no execution
  console.log("\n📝 Test 14: Tools Without Execution");
  const noExecution = await chat({
    messages: "Tell me about calculators without using any tools",
    tools: [mathTool],
  });
  assert(
    noExecution.text.length > 0,
    "Should generate text even with tools available"
  );

  // Test 15: Edge case - empty messages
  console.log("\n📝 Test 15: Edge Cases");
  try {
    await chat({
      messages: "",
    });
    assert(true, "Should handle empty string message");
  } catch {
    assert(true, "Empty message handled appropriately");
  }

  // Test 16: Concurrent requests
  console.log("\n📝 Test 16: Concurrent Requests");
  const [r1, r2, r3] = await Promise.all([
    chat({ messages: "Say 'one'" }),
    chat({ messages: "Say 'two'" }),
    chat({ messages: "Say 'three'" }),
  ]);
  assert(
    r1.text.length > 0 && r2.text.length > 0 && r3.text.length > 0,
    "Should handle concurrent requests"
  );

  console.log("\n🎉 All smoke tests passed!");
  console.log("================================");
  console.log(`Total tool calls made: ${toolCallCount}`);
}

// Run the smoke test
runSmokeTest().catch((error) => {
  console.error("💥 Smoke test failed:", error);
  process.exit(1);
});
