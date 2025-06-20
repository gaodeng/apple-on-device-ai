/**
 * Comprehensive AI SDK Example
 *
 * This example demonstrates all features of the Apple AI provider
 * working with the Vercel AI SDK.
 */

import { generateText, streamText, generateObject } from "ai";
import { z } from "zod";
import { appleAI as appleAIProvider } from "../src/apple-ai-provider";

// Schema for a comprehensive AI assistant response
const analysisSchema = z.object({
  topic: z.string().describe("The main topic analyzed"),
  keyPoints: z.array(z.string()).describe("Key points about the topic"),
  sentiment: z
    .enum(["positive", "negative", "neutral"])
    .describe("Overall sentiment"),
  complexity: z
    .enum(["beginner", "intermediate", "advanced"])
    .describe("Complexity level"),
  relatedTopics: z.array(z.string()).describe("Related topics to explore"),
  summary: z.string().describe("Brief summary of the analysis"),
});

async function comprehensiveExample() {
  console.log("🚀 Comprehensive AI SDK Integration Example");
  console.log("===========================================");

  try {
    const userQuery =
      "Explain quantum computing and its potential impact on cryptography";

    // 1. Basic text generation
    console.log("\n🎯 1. Basic Analysis:");
    const { text: basicResponse } = await generateText({
      model: appleAIProvider("apple-on-device"),
      prompt: `Provide a detailed explanation: ${userQuery}`,
      temperature: 0.5,
      maxOutputTokens: 200,
    });
    console.log(basicResponse);

    // 2. Structured analysis
    console.log("\n🧩 2. Structured Analysis:");
    const { object: analysis } = await generateObject({
      model: appleAIProvider("apple-on-device"),
      schema: analysisSchema,
      prompt: `Analyze this topic and provide structured insights: ${userQuery}`,
      temperature: 0.3,
    });

    console.log("Topic:", analysis.topic);
    console.log("Complexity:", analysis.complexity);
    console.log("Sentiment:", analysis.sentiment);
    console.log("\\nKey Points:");
    analysis.keyPoints.forEach((point, i) => {
      console.log(`  ${i + 1}. ${point}`);
    });
    console.log("\\nRelated Topics:", analysis.relatedTopics.join(", "));
    console.log("\\nSummary:", analysis.summary);

    // 3. Streaming detailed explanation
    console.log("\\n🌊 3. Streaming Detailed Explanation:");
    console.log("Generating detailed explanation... (streaming output below)");
    console.log("---");

    const streamResult = await streamText({
      model: appleAIProvider("apple-on-device"),
      prompt: `Based on the analysis, provide a comprehensive, easy-to-understand explanation of ${analysis.topic}. Focus on practical implications and real-world examples.`,
      temperature: 0.7,
      maxOutputTokens: 300,
    });

    let streamedContent = "";
    for await (const textPart of streamResult.textStream) {
      process.stdout.write(textPart);
      streamedContent += textPart;
    }

    console.log("\\n---");
    console.log(
      "Streamed content length:",
      streamedContent.length,
      "characters"
    );

    // 4. Follow-up questions generation
    console.log("\\n❓ 4. Follow-up Questions:");
    const { text: followUp } = await generateText({
      model: appleAIProvider("apple-on-device"),
      prompt: `Based on our discussion about ${analysis.topic}, generate 3 thoughtful follow-up questions that would help someone understand the topic better.`,
      temperature: 0.6,
      maxOutputTokens: 150,
    });
    console.log(followUp);

    // 5. Performance summary
    console.log("\\n📊 5. Session Summary:");
    console.log("- Generated basic analysis");
    console.log(
      "- Created structured analysis with",
      analysis.keyPoints.length,
      "key points"
    );
    console.log(
      "- Streamed detailed explanation of",
      streamedContent.length,
      "characters"
    );
    console.log("- Generated follow-up questions");
    console.log("- Used different temperature settings for different tasks");

    console.log("\\n✅ Comprehensive example completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
    console.error(
      "Stack:",
      error instanceof Error ? error.stack : "Unknown error"
    );
  }
}

// Run the example if this file is executed directly
if (import.meta.main) {
  comprehensiveExample().catch(console.error);
}

export { comprehensiveExample };
