import { appleAI } from "./src/apple-ai.js";

async function main() {
  console.log("🍎 Apple AI - On-Device Foundation Models");
  console.log("==========================================");

  try {
    // Check if Apple Intelligence is available
    const availability = await appleAI.checkAvailability();
    console.log("Availability:", availability);

    if (!availability.available) {
      console.log("Apple Intelligence not available:", availability.reason);
      return;
    }

    // Get supported languages
    console.log("Supported languages:", appleAI.getSupportedLanguages());
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
