import { readFileSync } from "node:fs";
import type { App, H3Event } from "h3";
import { createApp, defineEventHandler, toNodeListener } from "h3";
import { createServer as createHttpServer, createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Server } from "node:net";

export interface ServerOptions {
  host?: string;
  port?: number;
  https?:
    | false
    | {
        cert: string;
        key: string;
        port?: number; // Optional separate port for HTTPS
      };
  bearerToken?: string;
  onError?: (error: Error) => void;
}

/**
 * Authentication middleware
 */
export function createAuthMiddleware(bearerToken?: string) {
  return defineEventHandler(async (event: H3Event) => {
    if (!bearerToken) return; // No auth required

    // Skip auth for health check
    if (event.node.req.url === "/health") return;

    const authHeader = event.node.req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      event.node.res.statusCode = 401;
      event.node.res.setHeader("Content-Type", "application/json");
      event.node.res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const token = authHeader.substring(7);
    if (token !== bearerToken) {
      event.node.res.statusCode = 401;
      event.node.res.setHeader("Content-Type", "application/json");
      event.node.res.end(JSON.stringify({ error: "Invalid token" }));
      return;
    }
  });
}

/**
 * Setup routes for the app
 */
function setupRoutes(app: App, options: ServerOptions) {
  // Import route handlers
  const { models } = require("./routes/models");
  const { chatCompletions } = require("./routes/chat-completions");
  const { health } = require("./routes/health");
  const { apiTags } = require("./routes/api-tags");
  const { apiShow } = require("./routes/api-show");

  // Add authentication middleware if token is provided
  if (options.bearerToken) {
    app.use(createAuthMiddleware(options.bearerToken));
  }

  // Setup routes
  app.use("/v1/models", models);
  app.use("/v1/chat/completions", chatCompletions);
  app.use("/health", health);

  // Ollama-compatible API routes
  app.use("/v1/api/tags", apiTags);
  app.use("/v1/api/show", apiShow);

  // Error handler
  app.use(
    defineEventHandler((event: H3Event) => {
      if (options.onError && event.node.res.statusCode >= 400) {
        options.onError(
          new Error(`${event.node.res.statusCode}: ${event.node.req.url}`)
        );
      }
      event.node.res.statusCode = 404;
      event.node.res.setHeader("Content-Type", "application/json");
      event.node.res.end(JSON.stringify({ error: "Not found" }));
    })
  );
}

/**
 * Start the OpenAI-compatible server
 */
export async function startServer(opts: ServerOptions = {}) {
  const host = opts.host ?? "localhost";
  let port = opts.port ?? 8080;
  if (port === 0) {
    port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Port is 0, but failed to get random port"));
        }
        server.close();
      });
    });
  }
  const httpsConf = opts.https; // may be false or object

  // create the shared H3 app & routes once
  const app = createApp();
  setupRoutes(app, opts);

  let server: Server;
  let httpsServer: Server | undefined;

  if (httpsConf) {
    // If HTTPS is enabled, create HTTPS server and optionally HTTP on different port
    const creds =
      typeof httpsConf === "object"
        ? {
            cert: readFileSync(httpsConf.cert, "utf8"),
            key: readFileSync(httpsConf.key, "utf8"),
          }
        : undefined;

    if (!creds) {
      throw new Error(
        "HTTPS credentials are required, pass them in the https object"
      );
    }

    // Determine ports for HTTP and HTTPS
    const httpPort = port; // HTTP always uses the main port
    const httpsPort =
      typeof httpsConf === "object" && httpsConf.port
        ? httpsConf.port
        : port + 1;

    httpsServer = createHttpsServer(creds, toNodeListener(app));
    await new Promise<void>((resolve) => {
      httpsServer!.listen(httpsPort, host, () => resolve());
    });

    // Also start HTTP server
    const httpServer = createHttpServer(toNodeListener(app));
    await new Promise<void>((resolve) => {
      httpServer.listen(httpPort, host, () => resolve());
    });

    server = httpsServer;

    const urls = {
      http: `http://${host}:${httpPort}`,
      https: `https://${host}:${httpsPort}`,
    };

    async function stop() {
      await Promise.all([
        new Promise<void>((r) => httpsServer!.close(() => r())),
        new Promise<void>((r) => httpServer.close(() => r())),
      ]);
    }

    return { urls, url: urls.https, stop, port: httpPort, httpsPort };
  } else {
    // HTTP only
    server = createHttpServer(toNodeListener(app));
    await new Promise<void>((resolve) => {
      server.listen(port, host, () => resolve());
    });

    const urls = {
      http: `http://${host}:${port}`,
      https: undefined,
    };

    async function stop() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    return { urls, url: urls.http, stop, port };
  }
}
