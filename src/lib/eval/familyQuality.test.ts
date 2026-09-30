import { describe, expect, it } from "vitest";
import { summarizeFamilyQuality } from "./familyQuality";

describe("family quality accounting", () => {
  const easy = { family: "easy", case_id: "easy-case", success: true, reasons: [] };
  const hard = { family: "hard", case_id: "hard-case", success: false, reasons: ["root_cause", "root_cause"] };
  it("does not let repeated easy cases hide a failed incident family", () => {
    const sparse = summarizeFamilyQuality([easy, hard]);
    const padded = summarizeFamilyQuality([...Array.from({ length: 20 }, () => easy), hard]);
    expect(sparse.family_success_rate).toBe(0.5);
    expect(padded.family_success_rate).toBe(sparse.family_success_rate);
    expect(padded.families).toBe(2);
    expect(padded.fully_failed_families).toBe(1);
    expect(padded.family_results[0]).toMatchObject({ family: "hard", failure_reasons: { root_cause: 1 } });
    expect(padded.family_results[1].case_ids).toEqual(["easy-case"]);
  });
  it("keeps missing assessments in the denominator without calling them failures", () => {
    const result = summarizeFamilyQuality([easy, { ...hard, success: null, reasons: ["unscored_or_stale"] }]);
    expect(result).toMatchObject({ family_success_rate: 0.5, family_coverage: 0.5, fully_failed_families: 0, incomplete_families: 1 });
    expect(result.family_results[0]).toMatchObject({ assessed: 0, succeeded: 0, failed: 0, unassessed: 1, failure_reasons: {}, unassessed_reasons: { unscored_or_stale: 1 } });
  });
  it("weights outcomes within a family while keeping family weights equal", () => {
    const result = summarizeFamilyQuality([easy, { ...easy, success: false, reasons: ["failed"] }, hard]);
    expect(result.family_success_rate).toBe(0.25);
    expect(result.family_coverage).toBe(1);
    expect(result.family_results.map(f => f.family)).toEqual(["hard", "easy"]);
  });
  it("reports empty quality as unknown", () => {
    expect(summarizeFamilyQuality([])).toMatchObject({ families: 0, family_success_rate: null, family_coverage: null, family_results: [] });
  });
});
