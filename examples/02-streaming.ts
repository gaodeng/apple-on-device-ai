/**
 * Streaming Text Generation with AI SDK
 *
 * This example demonstrates streaming text generation using the Apple AI provider
 * with the Vercel AI SDK.
 */

import { streamText } from "ai";
import { appleAI as appleAIProvider } from "../src/apple-ai-provider";

async function streamingExample() {
  console.log("🌊 Streaming Text Generation with AI SDK");
  console.log("========================================");

  try {
    console.log("\n1. Streaming a story:");
    console.log("Generating... (streaming output below)");
    console.log("---");

    const result = streamText({
      model: appleAIProvider("apple-on-device"),
      prompt: "Write a short story about a robot who learns to paint.",
      temperature: 0.8,
      maxOutputTokens: 200,
    });

    // Stream the response
    let fullText = "";
    for await (const textPart of result.textStream) {
      process.stdout.write(textPart);
      fullText += textPart;
    }

    console.log("\n---");
    console.log("Full story length:", fullText.length, "characters");

    console.log("\n2. Streaming with different temperature:");
    console.log("Generating technical explanation... (streaming output below)");
    console.log("---");

    const result2 = streamText({
      model: appleAIProvider("apple-on-device"),
      prompt: "Explain how neural networks work, step by step.",
      temperature: 0.2, // More deterministic
      maxOutputTokens: 150,
    });

    let explanationText = "";
    for await (const textPart of result2.textStream) {
      process.stdout.write(textPart);
      explanationText += textPart;
    }

    console.log("\n---");
    console.log("Explanation length:", explanationText.length, "characters");

    console.log("\n✅ Streaming examples completed!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run the example if this file is executed directly
if (import.meta.main) {
  streamingExample().catch(console.error);
}

export { streamingExample };
