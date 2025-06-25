import { defineEventHandler } from "h3";
import { appleAISDK } from "../../apple-ai";

export const health = defineEventHandler(async (_event) => {
  try {
    const availability = await appleAISDK.checkAvailability();
    return {
      status: "ok",
      apple_intelligence: availability,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    };
  }
});
