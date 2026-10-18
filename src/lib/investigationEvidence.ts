export const EVIDENCE_KINDS = ["user_context", "metric", "log", "deploy", "runbook", "tool_observation", "unknown"] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export type ReviewEvidence = {
  recordKey: string;
  id: string;
  kind: EvidenceKind;
  source: string;
  service: string;
  observed_at: string;
  available_at: string;
  text: string;
  source_content_hash: string;
  measurement: { metric: string; value: number; unit: string; window: string } | null;
};
export type InvestigationEvidenceIndex = {
  evidence: ReviewEvidence[];
  citedIds: string[];
  missingIds: string[];
  ambiguousIds: string[];
};
export type EvidenceFilter = {
  query: string;
  kind: "all" | EvidenceKind;
  service: string;
  usage: "all" | "cited" | "uncited";
};
export const DEFAULT_EVIDENCE_FILTER: EvidenceFilter = { query: "", kind: "all", service: "", usage: "all" };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function ids(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeEvidence(value: unknown, index: number): ReviewEvidence | null {
  const source = record(value);
  const id = text(own(source, "id"));
  if (!id.trim()) return null;
  const kind = own(source, "kind");
  const rawMeasurement = record(own(source, "measurement"));
  const measurementValue = own(rawMeasurement, "value");
  const measurement = typeof measurementValue === "number" && Number.isFinite(measurementValue) ? {
    metric: text(own(rawMeasurement, "metric")), value: measurementValue,
    unit: text(own(rawMeasurement, "unit")), window: text(own(rawMeasurement, "window")),
  } : null;
  return {
    recordKey: `evidence-${index}`,
    id,
    kind: EVIDENCE_KINDS.includes(kind as EvidenceKind) ? kind as EvidenceKind : "unknown",
    source: text(own(source, "source")),
    service: text(own(source, "service")),
    observed_at: text(own(source, "observed_at")),
    available_at: text(own(source, "available_at")),
    text: text(own(source, "text")),
    source_content_hash: text(own(source, "content_hash")),
    measurement,
  };
}

/** References describe what was cited; they do not establish semantic support. */
export function buildInvestigationEvidenceIndex(input: unknown): InvestigationEvidenceIndex {
  const source = record(input);
  const diagnosis = record(own(source, "diagnosis"));
  const cited = new Set<string>();
  const add = (value: unknown) => ids(value).forEach(id => cited.add(id));
  for (const value of array(own(diagnosis, "claims"))) {
    const claim = record(value);
    add(own(claim, "evidence_ids"));
    add(own(record(own(claim, "derivation")), "operands"));
  }
  const collectHypothesis = (value: unknown) => {
    const hypothesis = record(value);
    add(own(hypothesis, "supporting_ids"));
    add(own(hypothesis, "refuting_ids"));
  };
  array(own(diagnosis, "root_causes")).forEach(collectHypothesis);
  for (const decision of array(own(source, "decisions"))) {
    array(own(record(decision), "hypotheses")).forEach(collectHypothesis);
  }

  const evidence: ReviewEvidence[] = [];
  const signatures = new Map<string, Set<string>>();
  const ambiguousIds = new Set<string>();
  const records = [
    ...array(own(source, "evidence")),
    ...array(own(source, "trace")).flatMap(step => array(own(record(step), "evidence"))),
  ];
  for (const [index, value] of records.entries()) {
    const item = normalizeEvidence(value, index);
    if (!item) continue;
    // The display position is not part of a source record's identity.
    const signature = JSON.stringify({ ...item, recordKey: undefined });
    const prior = signatures.get(item.id);
    if (prior?.has(signature)) continue;
    if (prior?.size) ambiguousIds.add(item.id);
    const versions = prior ?? new Set<string>();
    versions.add(signature);
    signatures.set(item.id, versions);
    evidence.push(item);
  }
  return {
    evidence,
    citedIds: [...cited],
    missingIds: [...cited].filter(id => !signatures.has(id)),
    ambiguousIds: [...ambiguousIds],
  };
}

/** All filters are browser-local and leave the report source and citation audit intact. */
export function filterInvestigationEvidence(index: InvestigationEvidenceIndex, filters: EvidenceFilter): ReviewEvidence[] {
  const query = filters.query.trim().toLowerCase();
  const cited = new Set(index.citedIds);
  return index.evidence.filter(item => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.service && item.service !== filters.service) return false;
    if (filters.usage === "cited" && !cited.has(item.id)) return false;
    if (filters.usage === "uncited" && cited.has(item.id)) return false;
    if (!query) return true;
    const measurement = item.measurement;
    return [item.id, item.kind, item.source, item.service, item.text,
      measurement?.metric ?? "", measurement ? String(measurement.value) : "",
      measurement?.unit ?? "", measurement?.window ?? "",
    ].some(value => value.toLowerCase().includes(query));
  });
}
