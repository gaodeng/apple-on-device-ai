import { z } from "zod";
import { chatWithEphemeralTools } from "../src/apple-ai";

const AddArgs = z.object({ a: z.number(), b: z.number() });

const res = await chatWithEphemeralTools({
  messages: [{ role: "user" as const, content: "What is 2 plus 3?" }],
  tools: [
    {
      name: "add",
      description: "Adds two numbers and returns the sum",
      schema: AddArgs,
      handler: ({ a, b }) => a + b,
    },
  ],
  temperature: 0.2,
});
console.log(res);
