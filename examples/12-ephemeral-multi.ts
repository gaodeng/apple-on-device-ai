import { z } from "zod";
import { chatWithEphemeralTools } from "../src/apple-ai";

async function main() {
  console.log(
    "🌐 Ephemeral multi-tool example\n==============================="
  );

  const res = await chatWithEphemeralTools({
    messages: [
      { role: "user" as const, content: "Add 7 and 8, then multiply 2 and 5." },
    ],
    tools: [
      {
        name: "add",
        description: "Adds two numbers",
        schema: z.object({ a: z.number(), b: z.number() }),
        handler: ({ a, b }) => a + b,
      },
      {
        name: "multiply",
        description: "Multiplies two numbers",
        schema: z.object({ x: z.number(), y: z.number() }),
        handler: ({ x, y }) => x * y,
      },
    ],
    temperature: 0.2,
  });

  console.log(res);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
