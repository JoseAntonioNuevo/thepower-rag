import { describe, expect, it } from "vite-plus/test";
import { anthropicProviderOptions } from "./model";

describe("opciones de Claude Haiku 5.5", () => {
  it("fija effort low y no envía muestreo", () => {
    expect(anthropicProviderOptions).toEqual({ anthropic: { effort: "low" } });
    expect(anthropicProviderOptions).not.toHaveProperty("temperature");
  });
});
