import { createHash } from "node:crypto";
import { z } from "zod";
import type { InvestigationInput, TraceStep } from "./types";

export const EvidenceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._:-]+$/),
  kind: z.enum(["user_context", "metric", "log", "deploy", "runbook", "tool_observation"]),
  source: z.string().min(1),
  service: z.string().min(1),
  observed_at: z.string().datetime(),
  available_at: z.string().datetime(),
  text: z.string().min(1).max(24000),
  content_hash: z.string(),
  measurement: z.object({ metric: z.string(), value: z.number().finite(), unit: z.string(), window: z.string() }).optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceSchema>;

export function evidenceItem(input: Omit<EvidenceItem, "content_hash">): EvidenceItem {
  return EvidenceSchema.parse({ ...input, content_hash: createHash("sha256").update(JSON.stringify(input)).digest("hex") });
}

export function isReservedEvidenceId(id: string): boolean {
  return id === "user-context" || id === "alert-context" || /^tool-\d+$/.test(id);
}

/** Evidence IDs identify immutable observations, not mutable slots. */
export function mergeEvidence(...groups: EvidenceItem[][]): EvidenceItem[] {
  const byId = new Map<string, EvidenceItem>();
  for (const item of groups.flat()) {
    const normalized = EvidenceSchema.parse(item);
    const existing = byId.get(normalized.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) throw new Error(`Conflicting evidence ID: ${normalized.id}. Use a new ID for a new observation.`);
    if (!existing) byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

export function formatEvidence(items: EvidenceItem[]): string {
  return items.map(e => `[${e.id}] ${JSON.stringify({ ...e, content_hash: undefined })}`).join("\n");
}

export function conclusionEvidence(input: InvestigationInput, trace: TraceStep[], now = new Date().toISOString()): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (!input.scenarioSlug && input.raw_context.trim()) {
    items.push(evidenceItem({ id: "user-context", kind: "user_context", source: "user report (not independently verified)", service: input.service || "unknown", observed_at: now, available_at: now, text: input.raw_context.slice(0, 24000) }));
  }
  for (const step of trace) {
    if (step.status !== "ok") continue;
    if (step.evidence) items.push(...step.evidence);
    else items.push(evidenceItem({ id: `tool-${step.index}`, kind: "tool_observation", source: `${step.tool}(${JSON.stringify(step.input)})`, service: input.service || "unknown", observed_at: now, available_at: now, text: step.observation.slice(0, 24000) }));
  }
  return mergeEvidence(items);
}

export const ClaimSchema = z.object({
  id: z.string(), text: z.string(), kind: z.enum(["observed", "derived", "inference", "hypothesis"]).describe("observed = direct fact; derived = explicit arithmetic over structured measurements; inference = qualitative or policy reasoning; hypothesis = uncertain causal explanation"),
  evidence_ids: z.array(z.string()),
  measurement: z.object({ service: z.string(), metric: z.string(), value: z.number().finite(), unit: z.string(), window: z.string() }).optional(),
  derivation: z.object({ operation: z.enum(["complement_percent", "difference"]), operands: z.array(z.string()).min(1).max(2).describe("Evidence IDs with structured measurements, never literal numbers"), value: z.number().finite(), unit: z.string() }).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Checks references and explicit arithmetic; does NOT claim to prove semantic support. */
export function checkClaims(claims: Claim[], evidence: EvidenceItem[]) {
  const byId = new Map(evidence.map(e => [e.id, e]));
  const identities = new Map<string, string>(), conflicts = new Set<string>();
  for (const e of evidence) {
    const identity = JSON.stringify(EvidenceSchema.parse(e));
    if (identities.has(e.id) && identities.get(e.id) !== identity) conflicts.add(e.id);
    identities.set(e.id, identity);
  }
  return claims.map(claim => {
    const errors: string[] = [];
    if (claim.kind !== "hypothesis" && !claim.evidence_ids.length) errors.push("missing_reference");
    if (claim.evidence_ids.some(id => !byId.has(id))) errors.push("unknown_reference");
    if (claim.evidence_ids.some(id => conflicts.has(id))) errors.push("ambiguous_reference");
    const measurement = claim.measurement;
    if (measurement && claim.kind === "observed") {
      const cited = claim.evidence_ids.map(id => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
      // Prose measurements require semantic review. Only reject automatically
      // when service metadata or explicit structured measurements contradict them.
      const structured = cited.filter(e => e.measurement);
      if (!cited.some(e => e.service === measurement.service) || (structured.length > 0 && !structured.some(e =>
        e.service === measurement.service && e.measurement!.metric === measurement.metric && e.measurement!.unit === measurement.unit && e.measurement!.window === measurement.window && e.measurement!.value === measurement.value
      ))) errors.push("measurement_mismatch");
    }
    if (claim.derivation && claim.kind !== "derived") errors.push("derivation_kind_mismatch");
    if (claim.kind === "derived" || claim.derivation) {
      const d = claim.derivation;
      const operands = d?.operands.map(id => byId.get(id));
      if (!d || !operands || operands.some(e => !e?.measurement) || d.operands.some(id => !claim.evidence_ids.includes(id))) errors.push("invalid_derivation");
      else {
        const a = operands[0]!;
        const b = operands[1];
        const valid = d.operation === "complement_percent"
          ? operands.length === 1 && a.measurement!.unit === "%" && a.measurement!.value >= 0 && a.measurement!.value <= 100 && d.unit === "%"
          : operands.length === 2 && a.service === b!.service && a.measurement!.metric === b!.measurement!.metric && a.measurement!.window === b!.measurement!.window && a.measurement!.unit === b!.measurement!.unit && d.unit === (a.measurement!.unit === "%" ? "percentage_points" : a.measurement!.unit);
        const expected = d.operation === "complement_percent" ? 100 - a.measurement!.value : a.measurement!.value - (b?.measurement?.value ?? NaN);
        if (!valid || Math.abs(expected - d.value) > 1e-6) errors.push("invalid_arithmetic");
        if (measurement && (measurement.service !== a.service || measurement.unit !== d.unit || measurement.value !== d.value || measurement.window !== a.measurement!.window)) errors.push("derived_measurement_mismatch");
      }
    }
    return { claim_id: claim.id, errors, semantic_review_required: true };
  });
}
