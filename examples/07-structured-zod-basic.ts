import { z } from "zod";
import { structured } from "../src/apple-ai";

async function main() {
  console.log("🧩 Zod basic structured example\n===========================");

  const PersonSchema = z.object({
    name: z.string().describe("Full name"),
    age: z.number().int().describe("Age in years"),
  });

  const res = await structured({
    prompt: "Generate a random person as JSON.",
    schema: PersonSchema,
    temperature: 0.7,
  });

  console.log("Object:", res.object);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
