// Original Apple AI Library
export * from "./apple-ai";

// AI SDK Provider Interface
export * from "./apple-ai-provider";
export * from "./apple-ai-chat-model";

// Re-export the default instance for convenience
export { appleAISDK } from "./apple-ai";
export { appleAI as createAppleAI } from "./apple-ai-provider";

// OpenAI-compatible server
export { startServer } from "./server";
export type { ServerOptions } from "./server";
