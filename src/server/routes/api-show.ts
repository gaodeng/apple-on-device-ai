import { defineEventHandler, readBody, createError } from "h3";

export const apiShow = defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { model } = body;

  if (!model) {
    throw createError({
      statusCode: 400,
      statusMessage: "Model name is required",
    });
  }

  // For now, we only support the apple-on-device model
  if (model !== "apple-on-device") {
    throw createError({
      statusCode: 404,
      statusMessage: "Model not found",
    });
  }

  // Return detailed model information
  return {
    modelfile: `# Modelfile for Apple On-Device AI
FROM apple-on-device

PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"

SYSTEM """You are a helpful assistant."""`,
    parameters: 'stop                           ["<|im_end|>", "<|im_start|>"]',
    template: `{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
`,
    details: {
      parent_model: "",
      format: "gguf",
      family: "apple",
      families: ["apple"],
      parameter_size: "unknown",
      quantization_level: "unknown",
    },
    model_info: {
      "general.architecture": "apple",
      "general.basename": "apple-on-device",
      "general.description": "Apple On-Device AI Model",
      "general.license": "Apple",
      "general.name": "Apple On-Device AI",
      "general.parameter_count": 3000000000,
      "general.size_label": "3B",
      "apple.context_length": 8192,
      "apple.embedding_length": 4096,
      "apple.block_count": 32,
      "apple.attention.head_count": 32,
      "apple.attention.key_length": 128,
      "apple.attention.value_length": 128,
      "apple.feed_forward_length": 11008,
    },
    capabilities: ["vision", "tools"],
    modified_at: new Date().toISOString(),
  };
});
