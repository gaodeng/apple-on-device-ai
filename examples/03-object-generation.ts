/**
 * Object Generation with AI SDK
 *
 * This example demonstrates structured object generation using the Apple AI provider
 * with the Vercel AI SDK and Zod schemas.
 */

import { z } from "zod";
import { structured } from "../src/apple-ai";

// Define schemas for structured data
const recipeSchema = z.object({
  name: z.string(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      amount: z.string(),
      unit: z.string().optional(),
    })
  ),
  instructions: z.array(z.string()),
  cookingTime: z.number(),
  servings: z.number(),
});

const profileSchema = z.object({
  name: z.string(),
  age: z.number(),
  occupation: z.string(),
  hobbies: z.array(z.string()),
  location: z.object({
    city: z.string(),
    country: z.string(),
  }),
  bio: z.string(),
});

async function objectGenerationExample() {
  console.log("🧩 Structured Object Generation");
  console.log("===============================");

  try {
    console.log("\n1. Generating a recipe:");
    const recipeRes = await structured({
      prompt: "Generate a recipe for a healthy breakfast smoothie.",
      schema: recipeSchema,
      temperature: 0.7,
    });
    const recipe = recipeRes.object;

    console.log("Recipe:", recipe);

    console.log("\n2. Generating a character profile:");
    const profileRes = await structured({
      prompt:
        "Create a character profile for a tech entrepreneur from San Francisco.",
      schema: profileSchema,
      temperature: 0.8,
    });
    const profile = profileRes.object;

    console.log("Profile:", profile);

    console.log("\n✅ Structured object generation completed!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  objectGenerationExample();
}

export { objectGenerationExample };
