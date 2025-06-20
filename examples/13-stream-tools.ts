import { z } from "zod";
import { streamChatWithEphemeralTools } from "../src/apple-ai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JSONSchema7 } from "json-schema";

async function main() {
  console.log(
    "🔄 Streaming with tools example\n==============================="
  );

  const iterator = streamChatWithEphemeralTools({
    messages: [
      {
        role: "user" as const,
        content: "Use add to add 10 and 15, stream the answer.",
      },
    ],
    tools: [
      {
        name: "add",
        jsonSchema: zodToJsonSchema(
          z.object({ a: z.number(), b: z.number() })
        ) as JSONSchema7,
        handler: async (args: Record<string, unknown>) => {
          const { a, b } = args as { a: number; b: number };
          console.log("Tool result:", a + b);
          return a + b;
        },
      } as const,
    ],
    temperature: 0.2,
  } as const);

  for await (const chunk of iterator) {
    process.stdout.write(chunk);
  }
  console.log("\n(done)");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
