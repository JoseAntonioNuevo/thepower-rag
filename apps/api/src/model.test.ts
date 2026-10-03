import { describe, expect, it } from "vite-plus/test";
import { modelOptions } from "./model";

describe("modelos por función", () => {
  it("mantiene Luna priority y fija Gemini estándar sin proveedor alternativo", () => {
    expect(modelOptions("openai/gpt-6-luna")).toMatchObject({
      reasoning: { effort: "none" },
      extraBody: {
        service_tier: "priority",
        provider: { only: ["openai/fast"], allow_fallbacks: false },
      },
    });
    expect(modelOptions("google/gemini-3.8-flash")).toEqual({
      reasoning: { effort: "low" },
      extraBody: { provider: { only: ["google-ai-studio"], allow_fallbacks: false } },
    });
  });
});
