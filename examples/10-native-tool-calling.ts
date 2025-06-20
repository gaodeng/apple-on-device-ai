import { z } from "zod";
import { chat } from "../src/apple-ai";
import zodToJsonSchema from "zod-to-json-schema";
import type { JSONSchema7 } from "json-schema";

const AddArgs = z.object({ a: z.number(), b: z.number() });

const res = await chat({
  messages: [
    {
      role: "user" as const,
      content: "What is 2 plus 3? You MUST use the tool.",
    },
  ],
  tools: [
    {
      name: "add",
      description: "Adds two numbers and returns the sum",
      jsonSchema: zodToJsonSchema(AddArgs, "jsonSchema7") as JSONSchema7,
      handler: async (args: Record<string, unknown>) => {
        console.log("[TOOL CALLED]", args);
        const parsed = args as z.infer<typeof AddArgs>;

        return parsed.a + parsed.b;
      },
    },
  ],
  temperature: 0.2,
});
console.log(res.text);
