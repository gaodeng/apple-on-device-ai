import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../../src/server";
import { TextDecoder } from "util";

describe("OpenAI-compatible Server Streaming", () => {
  let server: { url: string; port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer({ port: 0 });
  });

  afterAll(async () => {
    await server.stop();
  });

  test("should stream chat completions", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Say 'Hello'" }],
        stream: true,
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
    let hasContent = false;
    for (const line of dataLines) {
      if (line === "data: [DONE]") continue;

      const jsonStr = line.substring(6); // Remove "data: "
      const chunk = JSON.parse(jsonStr);

      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("object", "chat.completion.chunk");
      expect(chunk).toHaveProperty("created");
      expect(chunk).toHaveProperty("model", "apple-on-device");
      expect(chunk).toHaveProperty("choices");
      expect(chunk.choices).toBeArrayOfSize(1);

      if (chunk.choices[0].delta.content) {
        hasContent = true;
      }
    }

    expect(hasContent).toBe(true);
  });

  test("should handle streaming errors gracefully", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [], // Invalid empty messages
        stream: true,
      }),
    });

    // The server might return an error before streaming starts
    // or during streaming. Both are valid behaviors.
    if (response.headers.get("content-type") === "text/event-stream") {
      // Error during streaming
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let errorFound = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text.includes('"error"')) {
          errorFound = true;
          break;
        }
      }

      expect(errorFound).toBe(true);
    } else {
      // Error before streaming
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  test("should stream with temperature parameter", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Say 'Hi'" }],
        stream: true,
        temperature: 0.7,
        max_tokens: 10,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // Just verify we get some streaming response
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(value).toBeDefined();
    reader.cancel();
  });

  test("should handle non-streaming requests", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Say 'Hello'" }],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = (await response.json()) as any;

    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("object", "chat.completion");
    expect(data).toHaveProperty("created");
    expect(data).toHaveProperty("model", "apple-on-device");
    expect(data).toHaveProperty("choices");
    expect(data.choices).toBeArrayOfSize(1);
    expect(data.choices[0]).toHaveProperty("message");
    expect(data.choices[0].message).toHaveProperty("role", "assistant");
    expect(data.choices[0].message).toHaveProperty("content");
    expect(data.choices[0]).toHaveProperty("finish_reason", "stop");
  });
});
