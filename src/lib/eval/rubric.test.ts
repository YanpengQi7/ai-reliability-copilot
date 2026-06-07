import { describe, it, expect } from "vitest";
import { overallScore, type RubricScores } from "./rubric";

function scores(values: {
  specificity: number;
  safety: number;
  actionability: number;
  domain_correctness: number;
  completeness: number;
}): RubricScores {
  const dim = (n: number) => ({ score: n, reasoning: "r" });
  return {
    specificity: dim(values.specificity),
    safety: dim(values.safety),
    actionability: dim(values.actionability),
    domain_correctness: dim(values.domain_correctness),
    completeness: dim(values.completeness),
    overall_notes: "n",
  };
}

describe("overallScore", () => {
  it("averages the five dimensions", () => {
    const s = scores({ specificity: 5, safety: 5, actionability: 5, domain_correctness: 5, completeness: 5 });
    expect(overallScore(s)).toBe(5);
  });

  it("computes a mixed average and rounds to 2 decimals", () => {
    // (4 + 5 + 3 + 4 + 4) / 5 = 4.0
    expect(overallScore(scores({ specificity: 4, safety: 5, actionability: 3, domain_correctness: 4, completeness: 4 }))).toBe(4);
    // (5 + 4 + 4 + 4 + 4) / 5 = 4.2
    expect(overallScore(scores({ specificity: 5, safety: 4, actionability: 4, domain_correctness: 4, completeness: 4 }))).toBe(4.2);
    // (1 + 2 + 2 + 3 + 1) / 5 = 1.8
    expect(overallScore(scores({ specificity: 1, safety: 2, actionability: 2, domain_correctness: 3, completeness: 1 }))).toBe(1.8);
  });

  it("rounds a repeating decimal to 2 places", () => {
    // (5 + 5 + 5 + 5 + 4) / 5 = 4.8 ; (5+5+5+4+4)/5 = 4.6
    expect(overallScore(scores({ specificity: 5, safety: 5, actionability: 5, domain_correctness: 4, completeness: 4 }))).toBe(4.6);
  });

  it("does NOT include evidence_grounding (agentic-only 6th dim) in the average", () => {
    // overallScore only reads the five core dims; an extra field must not shift it.
    const s = scores({ specificity: 3, safety: 3, actionability: 3, domain_correctness: 3, completeness: 3 });
    (s as unknown as Record<string, unknown>).evidence_grounding = { score: 1, reasoning: "x" };
    expect(overallScore(s)).toBe(3);
  });
});
