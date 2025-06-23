import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startServer } from "../../src/server";
import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

describe("OpenAI-compatible Chat Completions", () => {
  let server: { url: string; port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await server.stop();
  });

  test("should handle basic chat completion", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say 'test passed'" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    expect(data.object).toBe("chat.completion");
    expect(data.model).toBe("apple-on-device");
    expect(data.choices[0].message.role).toBe("assistant");
    expect(data.choices[0].message.content).toBeDefined();
    expect(data.choices[0].finish_reason).toBe("stop");
  });

  test("should handle conversation history", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [
          { role: "user", content: "The peach is on the table" },
          { role: "assistant", content: "Thank you for the information" },
          { role: "user", content: "Where is the peach?" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    expect(data.choices[0].message.content.toLowerCase()).toContain("table");
  });

  test("should handle temperature parameter", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Say 'hello'" }],
        temperature: 0.1,
        max_tokens: 20,
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.choices[0].message.content).toBeDefined();
  });

  test("should handle tool/function calls", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "What's the weather in London?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather in a location",
              parameters: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA",
                  },
                },
                required: ["location"],
              },
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    // The model might or might not call the tool depending on its training
    if (data.choices[0].finish_reason === "tool_calls") {
      expect(data.choices[0].message.tool_calls).toBeDefined();
      expect(Array.isArray(data.choices[0].message.tool_calls)).toBe(true);
    } else {
      expect(data.choices[0].message.content).toBeDefined();
    }
  });

  test("should handle structured output", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [
          { role: "user", content: "Generate a person with name and age" },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Person",
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
              required: ["name", "age"],
            },
          },
        },
      } satisfies ChatCompletionCreateParams),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    // The content should be a valid JSON string
    const parsed = JSON.parse(data.choices[0].message.content);
    expect(parsed).toHaveProperty("name");
    expect(parsed).toHaveProperty("age");
    expect(typeof parsed.name).toBe("string");
    expect(typeof parsed.age).toBe("number");
  });

  test("should reject invalid requests", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        // Missing required messages field
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("should handle GET request with 405", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "GET",
    });

    expect(response.status).toBe(405);
    const data = (await response.json()) as any;
    expect(data.error).toBe("Method not allowed");
  });

  test("should handle empty messages array", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [],
      }),
    });

    // Should either return an error or handle it gracefully
    const data = (await response.json()) as any;
    if (response.status === 200) {
      expect(data.choices[0].message.content).toBeDefined();
    } else {
      expect(data.error).toBeDefined();
    }
  });
});
