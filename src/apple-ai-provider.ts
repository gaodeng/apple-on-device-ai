import { generateId, loadApiKey } from "@ai-sdk/provider-utils";
import { AppleAIChatLanguageModel } from "./apple-ai-chat-model";

// Supported model IDs for Apple's on-device models
export type AppleAIModelId = "apple-on-device" | (string & {});

// Model settings
export interface AppleAISettings {
  temperature?: number;
  maxTokens?: number;
}

// Provider interface
export interface AppleAIProvider {
  (
    modelId: AppleAIModelId,
    settings?: AppleAISettings
  ): AppleAIChatLanguageModel;

  // explicit method for targeting chat models
  chat(
    modelId: AppleAIModelId,
    settings?: AppleAISettings
  ): AppleAIChatLanguageModel;
}

// Provider settings
export interface AppleAIProviderSettings {
  /**
   * Custom headers to include in the requests.
   */
  headers?: Record<string, string>;

  /**
   * Custom ID generation function
   */
  generateId?: () => string;
}

// Provider factory function
export function createAppleAI(
  options: AppleAIProviderSettings = {}
): AppleAIProvider {
  const createModel = (
    modelId: AppleAIModelId,
    settings: AppleAISettings = {}
  ) =>
    new AppleAIChatLanguageModel(modelId, settings, {
      provider: "localhost",
      headers: options.headers ?? {},
      generateId: options.generateId ?? generateId,
    });

  const provider = function (
    modelId: AppleAIModelId,
    settings?: AppleAISettings
  ) {
    if (new.target) {
      throw new Error(
        "The Apple AI provider function cannot be called with the new keyword."
      );
    }

    return createModel(modelId, settings);
  };

  provider.chat = createModel;

  return provider;
}

/**
 * Default Apple AI provider instance.
 */
export const appleAI = createAppleAI();
