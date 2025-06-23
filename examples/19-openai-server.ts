#!/usr/bin/env bun

import { startServer } from "../src/server";
import devcert from "devcert";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Starting Apple AI OpenAI-compatible server...\n");

  // Generate or retrieve a trusted cert for localhost
  const ssl = await devcert.certificateFor(["localhost"]);

  // Persist to disk so our server can read them
  const certDir = path.resolve(process.cwd(), "certs");
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir);
  }
  const certPath = path.join(certDir, "localhost.pem");
  const keyPath = path.join(certDir, "localhost-key.pem");
  fs.writeFileSync(certPath, ssl.cert);
  fs.writeFileSync(keyPath, ssl.key);

  // Start the server with various options
  const server = await startServer({
    port: 12345,
    host: "localhost",
    bearerToken: process.env.API_KEY, // Optional authentication
    // https: {
    //   cert: certPath,
    //   key: keyPath,
    // },
  });

  console.log(`\n✅ Server is running at ${server.url}`);
  console.log("\nAvailable endpoints:");
  console.log("  OpenAI-compatible:");
  console.log(`    GET  ${server.url}/health`);
  console.log(`    GET  ${server.url}/v1/models`);
  console.log(`    POST ${server.url}/v1/chat/completions`);
  console.log("  Ollama-compatible:");
  console.log(`    GET  ${server.url}/v1/api/tags`);
  console.log(`    POST ${server.url}/v1/api/show`);

  if (process.env.API_KEY) {
    console.log("\n🔒 Authentication enabled. Include this header:");
    console.log(`  Authorization: Bearer ${process.env.API_KEY}`);
  }

  console.log("\n📝 Example request:");
  console.log(`curl -X POST ${server.url}/v1/chat/completions \\
  -H "Content-Type: application/json" \\${
    process.env.API_KEY ? '\n  -H "Authorization: Bearer $API_KEY" \\' : ""
  }
  -d '{
    "model": "apple-on-device",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello! How are you?"}
    ],
    "stream": false
  }'`);

  console.log("\n📡 Example streaming request:");
  console.log(`curl -X POST ${server.url}/v1/chat/completions \\
  -H "Content-Type: application/json" \\${
    process.env.API_KEY ? '\n  -H "Authorization: Bearer $API_KEY" \\' : ""
  }
  -d '{
    "model": "apple-on-device",
    "messages": [
      {"role": "user", "content": "Tell me a short story."}
    ],
    "stream": true
  }'`);

  console.log("\n🧪 Testing with OpenAI Python client:");
  console.log(`from openai import OpenAI

client = OpenAI(
    base_url="${server.url}/v1",
    api_key="${process.env.API_KEY || "dummy"}"
)

response = client.chat.completions.create(
    model="apple-on-device",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`);

  console.log("\n🦙 Testing Ollama-compatible endpoints:");
  console.log(`# List models
curl ${server.url}/v1/api/tags

# Get model info
curl -X POST ${server.url}/v1/api/show \\
  -H "Content-Type: application/json" \\
  -d '{"model": "apple-on-device"}'`);

  console.log("\nPress Ctrl+C to stop the server...");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\nShutting down server...");
    await server.stop();
    console.log("Server stopped. Goodbye!");
    process.exit(0);
  });
}

main().catch(console.error);
