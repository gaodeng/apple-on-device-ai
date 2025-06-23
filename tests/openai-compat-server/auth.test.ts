import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startServer } from "../../src/server";

describe("OpenAI-compatible Server Authentication", () => {
  let server: { url: string; port: number; stop: () => Promise<void> };
  const bearerToken = "test-secret-token-123";

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      bearerToken,
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  test("should reject requests without authorization header", async () => {
    const response = await fetch(`${server.url}/v1/models`);

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe("Unauthorized");
  });

  test("should reject requests with invalid token", async () => {
    const response = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: "Bearer wrong-token",
      },
    });

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe("Invalid token");
  });

  test("should reject requests with malformed authorization header", async () => {
    const response = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: "NotBearer token",
      },
    });

    expect(response.status).toBe(401);
    const data = (await response.json()) as any;
    expect(data.error).toBe("Unauthorized");
  });

  test("should accept requests with valid token", async () => {
    const response = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.object).toBe("list");
    expect(data.data).toBeArray();
  });

  test("should enforce auth on chat completions endpoint", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No auth header
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(response.status).toBe(401);
  });

  test("should allow chat completions with valid token", async () => {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        model: "apple-on-device",
        messages: [{ role: "user", content: "Say 'authenticated'" }],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.choices[0].message.content).toBeDefined();
  });

  test("health check should not require authentication", async () => {
    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.status).toBeOneOf(["ok", "error"]);
  });

  test("should handle auth with streaming requests", async () => {
    // Without auth
    const unauthorizedResponse = await fetch(
      `${server.url}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "apple-on-device",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      }
    );

    expect(unauthorizedResponse.status).toBe(401);

    // With auth
    const authorizedResponse = await fetch(
      `${server.url}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          model: "apple-on-device",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      }
    );

    expect(authorizedResponse.status).toBe(200);
    expect(authorizedResponse.headers.get("content-type")).toBe(
      "text/event-stream"
    );
  });

  test("should handle case-sensitive authorization header", async () => {
    // Test with lowercase 'bearer'
    const response = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: `bearer ${bearerToken}`, // lowercase
      },
    });

    expect(response.status).toBe(401);
  });
});
