import { z } from "zod";
import { structured } from "../src/apple-ai";

async function main() {
  console.log(
    "🥙 Zod nested structured example\n==============================="
  );

  const Ingredient = z.object({
    name: z.string(),
    amount: z.string(),
    unit: z.string().optional(),
  });

  const Recipe = z.object({
    title: z.string(),
    cookingTime: z.number(),
    servings: z.number(),
    ingredients: z.array(Ingredient),
    steps: z.array(z.string()),
  });

  const res = await structured({
    prompt: "Generate a simple pancake recipe.",
    schema: Recipe,
    temperature: 0.8,
    maxTokens: 400,
  });

  console.dir(res.object, { depth: null });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
