import { describe, expect, it } from "vitest";
import { findSimilarIncidents } from "./similar";

describe("findSimilarIncidents", () => {
  it("propagates cancellation before starting a search", async () => {
    const controller = new AbortController();
    controller.abort(new Error("similarity search cancelled"));

    await expect(findSimilarIncidents("payment latency", { abortSignal: controller.signal }))
      .rejects.toThrow("similarity search cancelled");
  });
});
