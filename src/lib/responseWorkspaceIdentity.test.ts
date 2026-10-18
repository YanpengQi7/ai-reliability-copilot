import { describe, expect, it } from "vitest";
import { savedResponseWorkspaceId } from "./responseWorkspaceIdentity";

const source = {
  id: "analysis-1", output_language: "en", summary: "Connection exhaustion",
  investigation_checklist: [
    { step: "Inspect connection count", command: "show connections", expected: "Near the limit" },
    { step: "Inspect queue", command: "show queue", expected: "Queue growth" },
  ],
  mitigation_plan: [{ action: "Pause the batch", risk: "Delays processing", rollback: "Resume the batch" }],
};

describe("saved response workspace identity", () => {
  it("is stable for the same incident and normalized analysis without exposing source text", () => {
    const id = savedResponseWorkspaceId("incident-1", source);
    expect(id).toMatch(/^saved:[a-f0-9]{64}$/);
    expect(savedResponseWorkspaceId("incident-1", structuredClone(source))).toBe(id);
    expect(id).not.toContain(source.summary);
  });

  it("ignores object property order and unknown legacy fields", () => {
    const reversed = Object.fromEntries(Object.entries(source).reverse());
    expect(savedResponseWorkspaceId("incident-1", { ...reversed, unknown: "ignored" }))
      .toBe(savedResponseWorkspaceId("incident-1", source));
  });

  it.each([
    { ...source, id: "analysis-2" },
    { ...source, output_language: "zh" },
    { ...source, summary: "New diagnosis" },
    { ...source, investigation_checklist: [...source.investigation_checklist].reverse() },
    { ...source, investigation_checklist: [{ ...source.investigation_checklist[0], command: "other command" }] },
    { ...source, mitigation_plan: [{ ...source.mitigation_plan[0], rollback: "Different rollback" }] },
  ])("starts fresh when the run or its source content changes", changed => {
    expect(savedResponseWorkspaceId("incident-1", changed))
      .not.toBe(savedResponseWorkspaceId("incident-1", source));
  });

  it("isolates incidents even if an analysis ID is reused", () => {
    expect(savedResponseWorkspaceId("incident-2", source))
      .not.toBe(savedResponseWorkspaceId("incident-1", source));
  });
});
