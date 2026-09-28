import { describe, expect, it } from "vitest";
import { checkClaims, conclusionEvidence, evidenceItem, mergeEvidence, type Claim } from "./evidence";
const at = "2026-09-01T00:00:00.000Z";
const e = evidenceItem({ id: "m1", kind: "metric", source: "fixture", service: "checkout", observed_at: at, available_at: at, text: "Success rate 96.8% over 5m", measurement: { metric: "success_rate", value: 96.8, unit: "%", window: "5m" } });

describe("immutable evidence identity", () => {
  it("deduplicates identical observations regardless of property order", () => {
    const reordered = Object.fromEntries(Object.entries(e).reverse()) as typeof e;
    expect(mergeEvidence([e], [reordered])).toEqual([e]);
  });
  it("refuses later observations that reuse an ID for different content", () => {
    expect(() => mergeEvidence([e], [{ ...e, text: "Now all requests succeed" }])).toThrow(/Conflicting evidence ID/);
    expect(() => mergeEvidence([e], [{ ...e, service: "billing" }])).toThrow(/Conflicting evidence ID/);
    expect(mergeEvidence([e], [{ ...e, id: "m2", text: "Updated observation" }])).toHaveLength(2);
  });
  it("reports ambiguous claim references instead of using the last duplicate", () => {
    const claim: Claim = { id: "c", text: "Success rate 96.8%", kind: "observed", evidence_ids: ["m1"], measurement: { service: "checkout", ...e.measurement! } };
    const conflicting = { ...e, text: "Success rate 80%", measurement: { ...e.measurement!, value: 80 } };
    expect(checkClaims([claim], [conflicting, e])[0].errors).toContain("ambiguous_reference");
    expect(checkClaims([claim], [e, conflicting])[0].errors).toContain("ambiguous_reference");
  });
  it("does not silently overwrite user context at final synthesis", () => {
    expect(() => conclusionEvidence({ service: "checkout", raw_context: "Users report errors" }, [{ index: 1, tool: "get_metrics", input: {}, status: "ok", observation: "healthy", latency_ms: 1, evidence: [{ ...e, id: "user-context" }] }], at)).toThrow(/Conflicting evidence ID/);
  });
});

describe("derived measurement boundaries", () => {
  const claim: Claim = { id: "c", text: "Failure rate 3.2%", kind: "derived", evidence_ids: ["m1"], derivation: { operation: "complement_percent", operands: ["m1"], value: 3.2, unit: "%" } };
  it("rejects percentage complements outside the percentage domain", () => {
    const invalid = { ...e, measurement: { ...e.measurement!, value: 120 } };
    expect(checkClaims([{ ...claim, derivation: { ...claim.derivation!, value: -20 } }], [invalid])[0].errors).toContain("invalid_arithmetic");
  });
  it("rejects subtraction of different measurement windows", () => {
    const other = { ...e, id: "m2", measurement: { ...e.measurement!, window: "24h", value: 90 } };
    const difference: Claim = { ...claim, evidence_ids: ["m1", "m2"], derivation: { operation: "difference", operands: ["m1", "m2"], value: 6.8, unit: "percentage_points" } };
    expect(checkClaims([difference], [e, other])[0].errors).toContain("invalid_arithmetic");
    expect(checkClaims([difference], [e, { ...other, measurement: { ...other.measurement, window: "5m" } }])[0].errors).toEqual([]);
  });
  it("cannot bypass arithmetic checks by labeling a calculation as observed", () => {
    const observed = { ...claim, kind: "observed" as const, derivation: { ...claim.derivation!, value: 80 } };
    expect(checkClaims([observed], [e])[0].errors).toEqual(expect.arrayContaining(["derivation_kind_mismatch", "invalid_arithmetic"]));
  });
  it("rejects a derived value presented as a different time window", () => {
    expect(checkClaims([{ ...claim, measurement: { service: "checkout", metric: "failure_rate", value: 3.2, unit: "%", window: "24h" } }], [e])[0].errors).toContain("derived_measurement_mismatch");
  });
});
