import { describe, expect, test } from "bun:test";
import { startServer } from "../../src/server";

describe("OpenAI-compatible Server Lifecycle", () => {
  test("should start and stop server successfully", async () => {
    const server = await startServer({ port: 0 }); // Use port 0 for random port

    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(server.port).toBeGreaterThan(0);
    expect(typeof server.stop).toBe("function");

    await server.stop();
  });

  test("should handle multiple start/stop cycles", async () => {
    for (let i = 0; i < 3; i++) {
      const server = await startServer({ port: 0 });
      expect(server.port).toBeGreaterThan(0);
      await server.stop();
    }
  });

  test("should accept custom host", async () => {
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
    });

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await server.stop();
  });

  test("should handle bearer token configuration", async () => {
    const bearerToken = "test-token-123";
    const server = await startServer({
      port: 0,
      bearerToken,
    });

    // Test unauthorized request
    const response = await fetch(`${server.url}/v1/models`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });

    // Test authorized request
    const authResponse = await fetch(`${server.url}/v1/models`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });
    expect(authResponse.status).toBe(200);

    await server.stop();
  });

  test("health check should not require authentication", async () => {
    const server = await startServer({
      port: 0,
      bearerToken: "test-token",
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);

    const health = (await response.json()) as {
      status: string;
      timestamp: string;
      apple_intelligence?: any;
    };
    expect(health.status).toBeOneOf(["ok", "error"]);
    expect(health.timestamp).toBeDefined();

    await server.stop();
  });

  test("should handle server already running", async () => {
    const server1 = await startServer({ port: 0 });
    const port = server1.port;

    // Starting another server should stop the first one
    const server2 = await startServer({ port: 0 });
    expect(server2.port).not.toBe(port);

    await server2.stop();
  });
});
