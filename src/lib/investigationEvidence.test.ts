import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVIDENCE_FILTER, buildInvestigationEvidenceIndex, filterInvestigationEvidence,
} from "./investigationEvidence";

const evidence = [
  { id: "metric:1", kind: "metric", source: "Metrics adapter", service: "checkout", observed_at: "2026-10-05T12:00:00Z", available_at: "2026-10-05T12:00:01Z", text: "Connections at 100%_* saturation", content_hash: "original-1", measurement: { metric: "pool", value: 100, unit: "%", window: "5m" } },
  { id: "log:2", kind: "log", source: "Log stream", service: "checkout", text: "timeout (504) 支付", content_hash: "original-2" },
  { id: "deploy:3", kind: "deploy", service: "other", text: "Deployment unchanged" },
  { id: "runbook:4", kind: "runbook", service: " checkout ", text: "Connection limits" },
];
const source = {
  evidence,
  diagnosis: {
    claims: [{ evidence_ids: ["metric:1", "metric:1"], derivation: { operands: ["log:2", "unknown:5"] } }],
    root_causes: [{ supporting_ids: ["metric:1"], refuting_ids: ["deploy:3"] }],
  },
  decisions: [{ hypotheses: [{ supporting_ids: ["runbook:4"], refuting_ids: ["missing:6"] }] }],
};

describe("investigation evidence index", () => {
  it("retains metadata, original provenance hash and finite structured measurements", () => {
    const index = buildInvestigationEvidenceIndex(source);
    expect(index.evidence[0]).toMatchObject({ recordKey: "evidence-0", id: "metric:1", source_content_hash: "original-1", measurement: evidence[0].measurement });
    expect(index.evidence[1].measurement).toBeNull();
    expect(index.evidence[3].service).toBe(" checkout ");
  });

  it("audits claim, derivation, cause and decision references before filtering", () => {
    const index = buildInvestigationEvidenceIndex(source);
    expect(index.citedIds).toEqual(["metric:1", "log:2", "unknown:5", "deploy:3", "runbook:4", "missing:6"]);
    expect(index.missingIds).toEqual(["unknown:5", "missing:6"]);
    filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, kind: "metric" });
    expect(index.missingIds).toEqual(["unknown:5", "missing:6"]);
    expect(index.ambiguousIds).toEqual([]);
  });

  it("deduplicates identical records but retains conflicting IDs with distinct display keys", () => {
    const duplicate = { ...evidence[0], measurement: { ...evidence[0].measurement! } };
    const conflict = { ...evidence[0], text: "Contradicting source text" };
    const index = buildInvestigationEvidenceIndex({ evidence: [evidence[0], duplicate, conflict, conflict] });
    expect(index.evidence.map(item => item.recordKey)).toEqual(["evidence-0", "evidence-2"]);
    expect(index.ambiguousIds).toEqual(["metric:1"]);
  });

  it("retains legacy trace-only evidence and merges it with top-level records", () => {
    const index = buildInvestigationEvidenceIndex({
      evidence: [evidence[0]],
      trace: [{ evidence: [evidence[0], evidence[1]] }, { evidence: "broken" }],
      diagnosis: { claims: [{ evidence_ids: ["metric:1", "log:2"] }] },
    });
    expect(index.evidence.map(item => item.id)).toEqual(["metric:1", "log:2"]);
    expect(index.missingIds).toEqual([]);
    const traceOnly = buildInvestigationEvidenceIndex({ trace: [{ evidence: [evidence[2]] }] });
    expect(traceOnly.evidence[0].id).toBe("deploy:3");
  });

  it("normalizes malformed legacy fields without inventing measurements or trusting extra fields", () => {
    const index = buildInvestigationEvidenceIndex({
      evidence: [null, {}, { id: "" }, { id: "legacy", kind: "future", source: 5, service: null, text: "Legacy observation", measurement: { metric: "bad", value: Infinity }, raw_context: "private" }],
      diagnosis: { claims: [null, { evidence_ids: [null, "", "legacy"] }] }, decisions: "broken",
    });
    expect(index.evidence).toHaveLength(1);
    expect(index.evidence[0]).toMatchObject({ id: "legacy", kind: "unknown", source: "", service: "", measurement: null });
    expect(index.evidence[0]).not.toHaveProperty("raw_context");
    expect(index.citedIds).toEqual(["legacy"]);
  });

  it("ignores inherited source fields and handles prototype-looking IDs as ordinary data", () => {
    expect(buildInvestigationEvidenceIndex(Object.create(source)).evidence).toEqual([]);
    const inherited = Object.create({ id: "inherited" });
    const index = buildInvestigationEvidenceIndex({ evidence: [inherited, { id: "__proto__", text: "ordinary" }, { id: "constructor", text: "ordinary" }], diagnosis: { claims: [{ evidence_ids: ["__proto__"] }] } });
    expect(index.evidence.map(item => item.id)).toEqual(["__proto__", "constructor"]);
    expect(index.missingIds).toEqual([]);
  });

  it.each([undefined, null, false, [], "broken"])("handles absent or malformed results: %s", input => {
    expect(buildInvestigationEvidenceIndex(input)).toEqual({ evidence: [], citedIds: [], missingIds: [], ambiguousIds: [] });
  });

  it("does not mutate source records or arrays", () => {
    const snapshot = structuredClone(source);
    const before = JSON.stringify(snapshot);
    buildInvestigationEvidenceIndex(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("local evidence filtering", () => {
  const index = buildInvestigationEvidenceIndex({ ...source, decisions: [], diagnosis: { claims: [{ evidence_ids: ["metric:1", "log:2"] }] } });

  it("shows all records by default and supports combined kind, service and usage filters", () => {
    expect(filterInvestigationEvidence(index, DEFAULT_EVIDENCE_FILTER)).toHaveLength(4);
    expect(filterInvestigationEvidence(index, { query: "POOL", kind: "metric", service: "checkout", usage: "cited" }).map(item => item.id)).toEqual(["metric:1"]);
    expect(filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, usage: "uncited" }).map(item => item.id)).toEqual(["deploy:3", "runbook:4"]);
  });

  it.each([
    ["100%_*", "metric:1"], ["timeout (504)", "log:2"], ["支付", "log:2"],
    ["  METRICS ADAPTER  ", "metric:1"], ["LOG:2", "log:2"], ["5m", "metric:1"],
  ])("searches %s as literal case-insensitive text", (query, id) => {
    expect(filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, query }).map(item => item.id)).toEqual([id]);
  });

  it("keeps exact service boundaries and capitalization", () => {
    expect(filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, service: " checkout " }).map(item => item.id)).toEqual(["runbook:4"]);
    expect(filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, service: "CHECKOUT" })).toEqual([]);
  });

  it("does not interpret regex, wildcard or query operators", () => {
    for (const query of [".*", "service:checkout", "(.*)", "[a-z]"]) {
      expect(filterInvestigationEvidence(index, { ...DEFAULT_EVIDENCE_FILTER, query })).toEqual([]);
    }
  });

  it("returns no matches without modifying the index or the filter object", () => {
    const filters = { ...DEFAULT_EVIDENCE_FILTER, query: "absent" };
    const before = JSON.stringify(index);
    expect(filterInvestigationEvidence(index, filters)).toEqual([]);
    expect(JSON.stringify(index)).toBe(before);
    expect(filters.query).toBe("absent");
  });
});
