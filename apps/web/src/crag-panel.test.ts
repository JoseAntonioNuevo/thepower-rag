import { describe, expect, it } from "vite-plus/test";
import { acceptScenarioChange, discardedRowKey } from "./crag-panel";

describe("panel CRAG", () => {
  it("da una clave distinta a cada descarte repetido y no cambia el guion ocupado", () => {
    const rows = [
      { chunkId: "s16", attempt: 1 },
      { chunkId: "s16", attempt: 2 },
      { chunkId: "s16", attempt: 3 },
    ];
    const keys = rows.map((item, index) => discardedRowKey(item, index));
    expect(new Set(keys).size).toBe(keys.length);
    expect(acceptScenarioChange(true)).toBe(false);
    expect(acceptScenarioChange(false)).toBe(true);
  });
});
