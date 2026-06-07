import { describe, it, expect } from "vitest";
import { calcCost, normalizeUsage } from "./cost";

describe("calcCost", () => {
  it("computes cost from per-1M pricing", () => {
    // deepseek-chat: 0.27 in / 1.10 out per 1M tokens.
    // 1M in + 1M out = 0.27 + 1.10 = 1.37
    expect(calcCost("deepseek-chat", 1_000_000, 1_000_000)).toBeCloseTo(1.37, 6);
  });

  it("scales linearly with tokens", () => {
    const small = calcCost("deepseek-chat", 1000, 500)!;
    const big = calcCost("deepseek-chat", 2000, 1000)!;
    expect(big).toBeCloseTo(small * 2, 9);
  });

  it("returns null for an unknown model rather than lying with $0", () => {
    expect(calcCost("gpt-5-ultra", 1000, 1000)).toBeNull();
  });

  it("returns 0 for zero tokens on a known model", () => {
    expect(calcCost("deepseek-chat", 0, 0)).toBe(0);
  });
});

describe("normalizeUsage", () => {
  it("reads v4+ inputTokens/outputTokens", () => {
    expect(normalizeUsage({ inputTokens: 120, outputTokens: 45 })).toEqual({
      tokens_in: 120,
      tokens_out: 45,
    });
  });

  it("reads legacy v3 promptTokens/completionTokens", () => {
    expect(normalizeUsage({ promptTokens: 120, completionTokens: 45 })).toEqual({
      tokens_in: 120,
      tokens_out: 45,
    });
  });

  it("prefers the v4 field names when both shapes are present", () => {
    expect(
      normalizeUsage({ inputTokens: 1, outputTokens: 2, promptTokens: 99, completionTokens: 99 }),
    ).toEqual({ tokens_in: 1, tokens_out: 2 });
  });

  it("defaults to zero on undefined usage", () => {
    expect(normalizeUsage(undefined)).toEqual({ tokens_in: 0, tokens_out: 0 });
  });
});
