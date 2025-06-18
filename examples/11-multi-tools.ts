import { z } from "zod";
import { chatWithEphemeralTools } from "../src/apple-ai";

async function main() {
  console.log(
    "🔧 Multiple native tools example\n=============================="
  );

  const res = await chatWithEphemeralTools({
    messages: [
      {
        role: "user" as const,
        content:
          "Use the add tool to add 4 and 5, then use the multiply tool to multiply 3 and 6. Only respond after calling the tools. You must use tools provided.",
      },
    ],
    tools: [
      {
        name: "add",
        description: "Adds two numbers",
        schema: z.object({ a: z.number(), b: z.number() }),
        handler: ({ a, b }) => {
          console.log("Tool used: add");
          return a + b;
        },
      },
      {
        name: "multiply",
        description: "Multiplies two numbers",
        schema: z.object({ x: z.number(), y: z.number() }),
        handler: ({ x, y }) => {
          console.log("Tool used: multiply");
          return x * y;
        },
      },
    ],
    temperature: 0.2,
  });
  console.log(res);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
