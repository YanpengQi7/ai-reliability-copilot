import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_VERSION } from "../prompts";
import { DEFAULT_EVAL_REPEATS, MAX_EVAL_REPEATS, parseEvalPromptVersion, parseEvalRepeats } from "./runConfig";

describe("parseEvalRepeats", () => {
  it("uses the calibrated default and accepts the configured bounds", () => {
    expect(parseEvalRepeats(undefined)).toBe(DEFAULT_EVAL_REPEATS);
    expect(parseEvalRepeats(undefined, 2)).toBe(2);
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

describe("parseEvalPromptVersion", () => {
  it("uses the maintained default and accepts every registered prompt", () => {
    expect(parseEvalPromptVersion(undefined)).toBe(DEFAULT_PROMPT_VERSION);
    expect(["v1", "v2", "v3"].map((value) => parseEvalPromptVersion(value))).toEqual(["v1", "v2", "v3"]);
  });

  it.each(["", "v0", "v4", "V3", " v3"])("rejects unknown prompt version %j", (value) => {
    expect(() => parseEvalPromptVersion(value)).toThrow("EVAL_VERSION");
  });
});
