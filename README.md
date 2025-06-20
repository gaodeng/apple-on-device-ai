# [Unofficial] Apple Foundation Models bindings for Bun/NodeJS

## 🔥 Supports [Vercel AI SDK](https://ai-sdk.dev/)

## Features

- 🍎 **Apple Intelligence Integration**: Direct access to Apple's on-device models
- 🧠 **Dual API Support**: Use either the native Apple AI interface or Vercel AI SDK
- 🌊 **Streaming Support**: Real-time response streaming with OpenAI-compatible chunks
- 🎯 **Object Generation**: Structured data generation with Zod schemas or JSON Schema
- 💬 **Chat Interface**: OpenAI-style chat completions with message history
- 🔧 **Tool Calling**: Function/tool calling with Zod or JSON Schema
- 🔄 **Cross-Platform**: Works with React, Next.js, Vue, Svelte, and Node.js (Apple Silicon)
- 📝 **TypeScript**: Full type safety and excellent DX

## Installation

```bash
# Using bun (recommended)
bun add @meridius-labs/apple-on-device-ai

# If you don't have these already
bun add ai zod
```

## Quick Start

### Native Apple AI Interface

```typescript
import { chat } from "@meridius-labs/apple-on-device-ai";

// Simple text generation
const response = await chat({ messages: "What is the capital of France?" });
console.log(response.text); // "Paris is the capital of France."

// Chat with message history
const chatResponse = await chat({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
});
console.log(chatResponse.text);

// Streaming responses
for await (const chunk of chat({ messages: "Tell me a story", stream: true })) {
  process.stdout.write(chunk);
}

// Structured object generation (Zod)
import { z } from "zod";
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});
const structured = await chat({
  messages: "Generate a user object",
  schema: UserSchema,
});
console.log(structured.object); // { name: "Alice", age: 30 }

// Tool calling
const mathTool = {
  name: "calculator",
  description: "Performs basic math operations",
  jsonSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["add", "subtract", "multiply", "divide"],
      },
      a: { type: "number" },
      b: { type: "number" },
    },
    required: ["operation", "a", "b"],
  },
  handler: async ({ operation, a, b }) => {
    switch (operation) {
      case "add":
        return { result: a + b };
      case "subtract":
        return { result: a - b };
      case "multiply":
        return { result: a * b };
      case "divide":
        return { result: a / b };
    }
  },
};
const withTools = await chat({
  messages: "What is 25 times 4?",
  tools: [mathTool],
});
console.log(withTools.toolCalls); // [{ function: { name: "calculator" }, ... }]
```

### Vercel AI SDK Integration

```typescript
import { appleAI } from "@meridius-labs/apple-on-device-ai";
import { generateText, streamText, generateObject } from "ai";
import { z } from "zod";

// Text generation
const { text } = await generateText({
  model: appleAI(),
  messages: [{ role: "user", content: "Explain quantum computing" }],
});
console.log(text);

// Streaming
const { textStream } = await streamText({
  model: appleAI(),
  messages: [{ role: "user", content: "Write a poem about technology" }],
});
for await (const delta of textStream) {
  process.stdout.write(delta);
}

// Structured object generation
const { object } = await generateObject({
  model: appleAI(),
  prompt: "Generate a chocolate chip cookie recipe",
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    }),
  }),
});
console.log(object);

// Tool calling
const { text, toolCalls } = await generateText({
  model: appleAI(),
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools: {
    weather: {
      description: "Get weather information",
      parameters: z.object({ location: z.string() }),
      execute: async ({ location }) => ({
        temperature: 72,
        condition: "sunny",
        location,
      }),
    },
  },
});
console.log(toolCalls);
```

### Tool Calling & Structured Generation with Vercel AI SDK

#### Tool Calling Example

You can define tools using the `tool` helper and provide an `inputSchema` (Zod) and an `execute` function. The model will call your tool when appropriate, and you can handle tool calls and streaming output as follows:

```typescript
import { appleAI } from "@meridius-labs/apple-on-device-ai";
import { streamText, tool } from "ai";
import { z } from "zod";

const result = streamText({
  model: appleAI(),
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools: {
    weather: tool({
      description: "Get weather information",
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({
        temperature: 72,
        condition: "sunny",
        location,
      }),
    }),
  },
});

for await (const delta of result.fullStream) {
  if (delta.type === "text") {
    process.stdout.write(delta.text);
  } else if (delta.type === "tool-call") {
    console.log(`\n🔧 Tool call: ${delta.toolName}`);
    console.log(`   Arguments: ${JSON.stringify(delta.input)}`);
  } else if (delta.type === "tool-result") {
    console.log(`✅ Tool result: ${JSON.stringify(delta.output)}`);
  }
}
```

#### Structured/Object Generation Example

You can generate structured objects directly from the model using Zod schemas:

```typescript
import { appleAI } from "@meridius-labs/apple-on-device-ai";
import { generateObject } from "ai";
import { z } from "zod";

const { object } = await generateObject({
  model: appleAI(),
  prompt: "Generate a user profile",
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
  }),
});
console.log(object); // { name: "Alice", age: 30, email: "alice@example.com" }
```

## Requirements

- **macOS 26+** with Apple Intelligence enabled
- **Apple Silicon**: M1, M2, M3, or M4 chips
- **Device Language**: Set to supported language (English, Spanish, French, etc.)
- **Sufficient Storage**: At least 4GB available space for model files
- **Bun**: Use Bun for best compatibility (see workspace rules)

## API Reference

### Native API

#### `chat({ messages, schema?, tools?, stream?, ...options })`

- `messages`: string or array of chat messages (`{ role, content }`)
- `schema`: Zod schema or JSON Schema for structured/object output (optional)
- `tools`: Array of tool definitions (see above) (optional)
- `stream`: boolean for streaming output (optional)
- `temperature`, `maxTokens`, etc.: generation options (optional)
- Returns: `{ text, object?, toolCalls? }` or async iterator for streaming

#### `appleAISDK.checkAvailability()`

Check if Apple Intelligence is available.

#### `appleAISDK.getSupportedLanguages()`

Get list of supported languages.

### Vercel AI SDK Provider

#### `createAppleAI(options?)`

Returns a model provider for use with Vercel AI SDK (`generateText`, `streamText`, `generateObject`).

#### `generateText({ model, messages, tools?, ... })`

Text generation with optional tool calling.

#### `streamText({ model, messages, tools?, ... })`

Streaming text generation with optional tool calling.

#### `generateObject({ model, prompt, schema })`

Structured/object generation.

## Examples

See the `/examples` directory for comprehensive tests and usage:

- `15-smoke-test.ts`: Native API, tool calling, streaming, structured output
- `16-smoke-test.ts`: Vercel AI SDK compatibility, tool calling, streaming, object generation

## Error Handling

- All methods throw on fatal errors (e.g., invalid schema, unavailable model)
- Streaming can be aborted with an `AbortController` (see Vercel AI SDK example)
- Tool handler errors are surfaced in the result

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## License

MIT License - see LICENSE file for details.
