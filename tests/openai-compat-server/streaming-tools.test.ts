import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../../src/server";
import { TextDecoder } from "node:util";

describe("OpenAI-compatible Server Streaming with Tools", () => {
  let server: { url: string; port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await server.stop();
  });

  test("should stream with tools and complex system message", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple/apple-on-device",
        messages: [
          {
            role: "system",
            content:
              "markdown\n\n<user-preferences>\n  The user has the following system preferences:\n  - Language: English\n  - Region: United States\n  - Timezone: America/New_York\n  - Current Date: 2025-06-23\n  - Unit Currency: $\n  - Unit Temperature: °F\n  - Unit Length: ft\n  - Unit Mass: lb\n  - Decimal Separator: .\n  - Grouping Separator: ,\n  Use the system preferences to format your answers accordingly.\n</user-preferences>\n\n<extension-instructions>\n  The following extensions have some extra instructions:\n  - \"@weather\": \n    - tool named \"weather-get-weather\": Format the weather in a nice and user-friendly way. Add emojis when appropriate. Don't overwhelm the user with detailed information if they don't need it.\n  Follow the instructions whenever you use a tool of the extension.\n</extension-instructions>\n\n\nYou are a large language model created by Apple. If a user asks 'who are you', you should say 'I am a large language model created by Apple.'",
          },
          {
            role: "assistant",
            content: "I'm sorry, but I can't assist with that request.",
          },
          {
            role: "user",
            content: "What's the weather in New York>?",
          },
        ],
        stream: true,
        temperature: 0,
        tools: [
          {
            type: "function",
            function: {
              name: "weather-get-weather",
              description:
                "Gets weather for a specific location.\n\nFormat the weather in a nice and user-friendly way. Add emojis when appropriate. Don't overwhelm the user with detailed information if they don't need it.",
              parameters: {
                properties: {
                  location: {
                    description: "Location to get the weather from",
                    type: "string",
                  },
                  query: {
                    description: "Type of weather query",
                    enum: ["current", "hourly", "daily"],
                    type: "string",
                  },
                },
                required: ["location", "query"],
                type: "object",
              },
            },
          },
          {
            type: "function",
            function: {
              name: "location-get-current-location",
              description:
                "Gets the user's current location. Use this tool for location-based tasks, such as for weather, geocoding, or others.",
              parameters: {},
            },
          },
        ],
        tool_choice: "auto",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("connection")).toBe("keep-alive");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }

    const fullResponse = chunks.join("");
    const lines = fullResponse.split("\n");

    // Check that we have SSE formatted data
    const dataLines = lines.filter((line) => line.startsWith("data: "));
    expect(dataLines.length).toBeGreaterThan(0);

    // Check for [DONE] marker
    expect(dataLines[dataLines.length - 1]).toBe("data: [DONE]");

    // Parse and validate chunks

    let hasToolCall = false;
    let buffer = "";
    const toolCalls: any[] = [];

    for (const line of dataLines) {
      if (line === "data: [DONE]") continue;

      const jsonStr = line.substring(6); // Remove "data: "
      const chunk = JSON.parse(jsonStr);

      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("object", "chat.completion.chunk");
      expect(chunk).toHaveProperty("created");
      expect(chunk).toHaveProperty("model");
      expect(chunk).toHaveProperty("choices");
      expect(chunk.choices).toBeArrayOfSize(1);

      const choice = chunk.choices[0];

      if (choice.delta.content) {
        buffer += choice.delta.content;
      }

      if (choice.delta.tool_calls) {
        hasToolCall = true;
        // Validate tool call structure
        for (const toolCall of choice.delta.tool_calls) {
          expect(toolCall).toHaveProperty("id");
          expect(toolCall).toHaveProperty("type", "function");
          if (toolCall.function) {
            expect(toolCall.function).toHaveProperty("name");
          }
        }
        toolCalls.push(choice.delta.tool_calls);
      }
    }

    console.log({ toolCalls, buffer });
    // Should have either content or tool calls (or both)
    expect(hasToolCall).toBe(true);
  });
});
