import { defineEventHandler } from "h3";

export const apiTags = defineEventHandler(async (event) => {
  // Return Ollama-compatible models list
  return {
    models: [
      {
        model: "apple-on-device",
        name: "apple-on-device",
        size: 0,
        digest: "sha256:apple-on-device",
        details: {
          parent_model: "",
          format: "gguf",
          family: "apple",
          families: ["apple"],
          parameter_size: "unknown",
          quantization_level: "unknown",
        },
        expires_at: "0001-01-01T00:00:00Z",
        size_vram: 0,
      },
    ],
  };
});
