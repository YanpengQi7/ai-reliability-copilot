import { describe, expect, it } from "vitest";
import { auditDatasetSnapshots } from "./datasetAudit";
import { loadDataset, validateDataset } from "./dataset";
import { evidenceItem } from "../agent/evidence";
import type { EvalCase } from "./contracts";

const original = loadDataset("evals/datasets/sre-v2/cases.json")[0];
function renamed(): EvalCase {
  const renamedIds = new Map(original.evidence.map(e => [e.id, `renamed-${e.id}`]));
  return { ...original, id: "renamed-case", family: "renamed-family",
    evidence: original.evidence.map(e => evidenceItem({ ...e, id: renamedIds.get(e.id)! })).reverse(),
    gold: { ...original.gold, root_cause: "A different authored label is not a different observation", required_evidence_ids: original.gold.required_evidence_ids.map(id => renamedIds.get(id)!) } };
}

describe("incident snapshot independence audit", () => {
  it("detects renamed evidence and cases despite reordered records and changed labels", () => {
    const copy = renamed();
    const audit = auditDatasetSnapshots([original, copy]);
    expect(audit).toMatchObject({ valid: false, unique_snapshots: 1, duplicate_cases: 1, conflicting_groups: 1 });
    expect(audit.duplicate_groups[0]).toMatchObject({ case_ids: [original.id, copy.id].sort(), cross_family: true, cross_split: false });
    expect(() => validateDataset([original, copy])).toThrow(/Identical incident snapshots/);
  });
  it("rejects renamed families across splits while preserving historical audit access", () => {
    const copy = { ...renamed(), split: "test" as const };
    expect(() => validateDataset([original, copy])).toThrow(/across families or splits/);
    expect(validateDataset([original, copy], { snapshotPolicy: "audit" })).toHaveLength(2);
    expect(auditDatasetSnapshots([original, copy]).duplicate_groups[0]).toMatchObject({ cross_family: true, cross_split: true });
  });
  it("allows correlated variants within the same family and split without claiming extra snapshots", () => {
    const copy = { ...renamed(), family: original.family };
    expect(validateDataset([original, copy])).toHaveLength(2);
    expect(auditDatasetSnapshots([original, copy])).toMatchObject({ valid: true, unique_snapshots: 1, duplicate_cases: 1, conflicting_groups: 0 });
  });
  it("does not let hidden future records or duplicate observations disguise copies", () => {
    const copy = renamed();
    copy.evidence.push(evidenceItem({ ...original.evidence[0], id: "hidden-future", text: "Not available to the investigator", observed_at: "2027-01-01T00:00:00.000Z", available_at: "2027-01-01T00:00:00.000Z" }));
    copy.evidence.push(evidenceItem({ ...copy.evidence[0], id: "repeated-observation" }));
    expect(auditDatasetSnapshots([original, copy])).toMatchObject({ valid: false, unique_snapshots: 1 });
  });
  it("preserves observation metadata and distinct alert contexts", () => {
    const copy = renamed();
    expect(auditDatasetSnapshots([original, { ...copy, alert: { ...copy.alert, symptoms: "Different incident report" } }]).valid).toBe(true);
    copy.evidence[0] = evidenceItem({ ...copy.evidence[0], text: "A genuinely different observation" });
    expect(auditDatasetSnapshots([original, copy]).valid).toBe(true);
    const metadata = renamed();
    metadata.evidence[0] = evidenceItem({ ...metadata.evidence[0], source: "Separate recorded source" });
    expect(auditDatasetSnapshots([original, metadata]).valid).toBe(true);
  });
  it("does not expose source content or collapse distinct bundled cases", () => {
    const audit = auditDatasetSnapshots([original, renamed()]);
    expect(JSON.stringify(audit)).not.toContain(original.alert.symptoms);
    expect(JSON.stringify(audit)).not.toContain(original.evidence[0].text);
    for (const path of ["evals/datasets/sre-v2/cases.json", "evals/datasets/sre-v2/challenges.json"]) {
      const cases = loadDataset(path);
      expect(auditDatasetSnapshots(cases)).toMatchObject({ valid: true, unique_snapshots: cases.length, duplicate_cases: 0 });
    }
  });
});
