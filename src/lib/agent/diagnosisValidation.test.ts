import { describe, expect, it } from "vitest";
import type { Diagnosis } from "./diagnosis";
import { evidenceItem } from "./evidence";
import { checkDiagnosis, DiagnosisValidationError } from "./diagnosisValidation";

const at = "2026-09-01T00:00:00.000Z";
const evidence = evidenceItem({ id: "m1", kind: "metric", source: "fixture", service: "checkout", observed_at: at, available_at: at, text: "Success rate 96.8% over 5m", measurement: { metric: "success_rate", value: 96.8, unit: "%", window: "5m" } });
const tentative: Diagnosis = { summary: "Cause unverified", conclusion_status: "tentative", severity: null, severity_reasoning: "Scope missing", root_causes: [{ hypothesis: "Pool exhaustion", supporting_ids: [], refuting_ids: [], missing_evidence: ["Saturation"], next_check: "Inspect waiting connections" }], claims: [], mitigation_plan: [], missing_information: ["Impact duration"] };
const supported = (): Diagnosis => ({ ...tentative, conclusion_status: "supported", severity: "SEV2", root_causes: [{ ...tentative.root_causes[0], supporting_ids: ["m1"] }], claims: [{ id: "c1", text: "Failure rate is 3.2%", kind: "derived", evidence_ids: ["m1"], derivation: { operation: "complement_percent", operands: ["m1"], value: 3.2, unit: "%" } }] });

describe("final diagnosis integrity", () => {
  it("accepts cited arithmetic without claiming the cause is semantically proven", () => {
    expect(checkDiagnosis(supported(), [evidence])).toEqual([]);
  });
  it("allows uncited tentative causes when explicitly presented as hypotheses", () => {
    expect(checkDiagnosis(tentative, [evidence])).toEqual([]);
    expect(checkDiagnosis({ ...tentative, conclusion_status: "insufficient_evidence" }, [evidence])).toEqual([]);
  });
  it("checks supporting, contradicting and factual claim references", () => {
    const d = supported();
    d.root_causes[0].supporting_ids = ["unseen"];
    d.root_causes[0].refuting_ids = ["also-unseen"];
    d.claims[0].evidence_ids = ["unseen"];
    const issues = checkDiagnosis(d, [evidence]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "claims.0", reason: "unknown_reference" }),
      expect.objectContaining({ path: "root_causes.0.supporting_ids", category: "unknown_cause_reference" }),
      expect.objectContaining({ path: "root_causes.0.refuting_ids", category: "unknown_cause_reference" }),
    ]));
  });
  it("rejects incorrect arithmetic and structured measurement attribution", () => {
    const d = supported();
    d.claims[0].derivation!.value = 80;
    expect(checkDiagnosis(d, [evidence])).toContainEqual(expect.objectContaining({ reason: "invalid_arithmetic" }));
    d.claims = [{ id: "c1", text: "Success rate is 96.8%", kind: "observed", evidence_ids: ["m1"], measurement: { service: "billing", ...evidence.measurement! } }];
    expect(checkDiagnosis(d, [evidence])).toContainEqual(expect.objectContaining({ reason: "measurement_mismatch" }));
  });
  it("requires a supported cause and a cited non-hypothetical claim for supported conclusions", () => {
    const d = supported();
    d.root_causes = [];
    d.claims = [{ id: "c1", text: "Could be pool exhaustion", kind: "hypothesis", evidence_ids: ["m1"] }];
    expect(checkDiagnosis(d, [evidence]).map(issue => issue.reason)).toEqual(["missing_supported_cause", "missing_supported_claim"]);
    d.root_causes = [tentative.root_causes[0]];
    expect(checkDiagnosis(d, [evidence])).toContainEqual(expect.objectContaining({ reason: "missing_cause_support" }));
  });
  it("refuses a definite severity when the response declares insufficient evidence", () => {
    expect(checkDiagnosis({ ...tentative, conclusion_status: "insufficient_evidence", severity: "SEV1" }, [evidence])).toContainEqual(expect.objectContaining({ category: "inconsistent_uncertainty" }));
  });
  it("keeps rejected content out of the error message while retaining it for local audit", () => {
    const d = { ...tentative, summary: "private incident details" };
    const issues = [{ path: "claims.0", category: "invalid_claim" as const, reason: "unknown_reference" }];
    const error = new DiagnosisValidationError(d, issues);
    expect(error.message).not.toContain(d.summary);
    expect(error.diagnosis).toBe(d);
    expect(error.issues).toEqual(issues);
  });
});
