import { z } from "zod";
import { structured } from "../src/apple-ai";

async function main() {
  console.log("🎨 Zod enum / union example\n===========================");

  const Color = z.enum(["red", "green", "blue"]);
  const Shape = z.enum(["circle", "square", "triangle"]);

  const Item = z.object({
    color: Color,
    shape: Shape,
  });

  const res = await structured({
    prompt: "Generate a random colored shape object.",
    schema: Item,
    temperature: 0.6,
  });

  console.log(res.object);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
