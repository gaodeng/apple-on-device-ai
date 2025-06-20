import { createAppleAI } from "../src/apple-ai-provider";
import { generateText } from "ai";

async function debugVercelSDK() {
  console.log("🔍 Debugging Vercel AI SDK compatibility");

  try {
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
