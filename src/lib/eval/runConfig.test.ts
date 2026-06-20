import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_REPEATS, MAX_EVAL_REPEATS, parseEvalRepeats } from "./runConfig";

describe("parseEvalRepeats", () => {
  it("uses the calibrated default and accepts the configured bounds", () => {
    expect(parseEvalRepeats(undefined)).toBe(DEFAULT_EVAL_REPEATS);
    expect(parseEvalRepeats("1")).toBe(1);
    expect(parseEvalRepeats(String(MAX_EVAL_REPEATS))).toBe(MAX_EVAL_REPEATS);
  });

  it.each(["0", "-1", "1.5", "abc", " 3", String(MAX_EVAL_REPEATS + 1)])(
    "rejects unsafe repeat count %s",
    (value) => {
      expect(() => parseEvalRepeats(value)).toThrow(`1 to ${MAX_EVAL_REPEATS}`);
    },
  );
});
