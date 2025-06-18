import { z } from "zod";
import { streamChatWithEphemeralTools } from "../src/apple-ai";

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
        schema: z.object({ a: z.number(), b: z.number() }),
        handler: ({ a, b }) => a + b,
      },
    ],
    temperature: 0.2,
  });

  for await (const chunk of iterator) {
    process.stdout.write(chunk);
  }
  console.log("\n(done)");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
