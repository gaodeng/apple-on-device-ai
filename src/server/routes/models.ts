import { defineEventHandler } from "h3";

export const models = defineEventHandler(async (event) => {
  // Return OpenAI-compatible models list
  return {
    object: "list",
    data: [
      {
        id: "apple-on-device",
        object: "model",
        created: 1686935002,
        owned_by: "apple",
        permission: [
          {
            id: "modelperm-apple-on-device",
            object: "model_permission",
            created: 1686935002,
            allow_create_engine: false,
            allow_sampling: true,
            allow_logprobs: false,
            allow_search_indices: false,
            allow_view: true,
            allow_fine_tuning: false,
            organization: "*",
            group: null,
            is_blocking: false,
          },
        ],
        root: "apple-on-device",
        parent: null,
      },
    ],
  };
});
