import { createAppleAI } from "../src/apple-ai-provider.js";
import { generateText } from "ai";
import { appleAISDK, unified } from "../src/apple-ai.js";

async function debugVercelSDK() {
  console.log("🔍 Debugging Vercel AI SDK compatibility");

  try {
    // First check availability
    console.log("Checking Apple Intelligence availability...");
    const availability = await appleAISDK.checkAvailability();
    console.log("Availability:", availability);

    if (!availability.available) {
      console.error(
        "❌ Apple Intelligence not available:",
        availability.reason
      );
      return;
    }

    console.log("Testing unified API directly...");
    const unifiedResult = await unified({
      messages: "Say hello",
      temperature: 0.5,
    });
    console.log("✅ Unified API works:", unifiedResult);

    console.log("Testing Vercel AI SDK...");
    const ai = createAppleAI();
    const model = ai("apple-on-device");

    const { text } = await generateText({
      model,
      messages: [{ role: "user", content: "Say hello" }],
    });

    console.log("✅ Success! Response:", text);
  } catch (error) {
    console.error("❌ Error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
}

debugVercelSDK();
