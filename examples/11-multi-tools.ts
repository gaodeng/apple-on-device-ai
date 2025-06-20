import { z } from "zod";
import { chat } from "../src/apple-ai";
import zodToJsonSchema from "zod-to-json-schema";
import type { JSONSchema7 } from "json-schema";

async function main() {
  console.log(
    "🔧 Multiple native tools example\n=============================="
  );

  const AddArgs = z.object({ a: z.number(), b: z.number() });
  const MultiplyArgs = z.object({ x: z.number(), y: z.number() });

  const res = await chat({
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
        jsonSchema: zodToJsonSchema(AddArgs, "jsonSchema7") as JSONSchema7,
        handler: async (args: Record<string, unknown>) => {
          const parsed = args as z.infer<typeof AddArgs>;
          console.log("Tool used: add");
          return parsed.a + parsed.b;
        },
      },
      {
        name: "multiply",
        description: "Multiplies two numbers",
        jsonSchema: zodToJsonSchema(MultiplyArgs, "jsonSchema7") as JSONSchema7,
        handler: async (args: Record<string, unknown>) => {
          const parsed = args as z.infer<typeof MultiplyArgs>;
          console.log("Tool used: multiply");
          return parsed.x * parsed.y;
        },
      },
    ],
    temperature: 0.2,
    stopAfterToolCalls: true,
  });

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
