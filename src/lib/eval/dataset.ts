import { readFileSync } from "node:fs";
import { z } from "zod";
import { CaseSchema, type EvalCase } from "./contracts";
import { evidenceItem, evidenceVisibleAt, alertEvidence as sharedAlertEvidence, isReservedEvidenceId, type EvidenceItem } from "../agent/evidence";
import type { TelemetryAdapter } from "../agent/tools";

export function isVisible(e: EvidenceItem, at: string): boolean {
  return evidenceVisibleAt(e, at);
}

export function validateDataset(raw: unknown): EvalCase[] {
  const cases = z.array(CaseSchema).min(1).parse(raw);
  const ids = new Set<string>();
  const splits = new Map<string, string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`Duplicate case ${c.id}`);
    ids.add(c.id);
    if (splits.has(c.family) && splits.get(c.family) !== c.split) throw new Error(`Family ${c.family} leaks across splits`);
    splits.set(c.family, c.split);
    if (new Set(c.evidence.map(e => e.id)).size !== c.evidence.length) throw new Error(`Duplicate evidence in ${c.id}`);
    if (c.evidence.some(e => isReservedEvidenceId(e.id))) throw new Error("Reserved system evidence ID");
    for (const e of c.evidence) {
      const { content_hash, ...rest } = e;
      if (evidenceItem(rest).content_hash !== content_hash) throw new Error(`Evidence hash mismatch in ${c.id}`);
    }
    if (c.gold.required_evidence_ids.some(id => !c.evidence.some(e => e.id === id && isVisible(e, c.alert.at)))) throw new Error(`Gold references unavailable evidence in ${c.id}`);
    if (c.gold.review_status === "gold" && new Set(c.gold.reviewers.map(r => r.trim().toLowerCase()).filter(Boolean)).size < 2) throw new Error(`Gold requires independent reviewers: ${c.id}`);
    if (!c.gold.sufficient && c.gold.acceptable_severities.length) throw new Error(`Insufficient-evidence case has a forced severity: ${c.id}`);
  }
  return cases;
}
export function loadDataset(path: string): EvalCase[] { return validateDataset(JSON.parse(readFileSync(path, "utf8"))); }
/** Alert text is reported context, never independently verified telemetry. */
export function alertEvidence(c: EvalCase): EvidenceItem {
  return sharedAlertEvidence(c.alert);
}
export function visibleEvidence(c: EvalCase, noKb = false): EvidenceItem[] {
  return c.evidence.filter(e => isVisible(e, c.alert.at) && (!noKb || e.kind !== "runbook"));
}
export class FixtureAdapter implements TelemetryAdapter {
  constructor(private readonly evidence: EvidenceItem[], private readonly at: string) {}
  async read(tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<EvidenceItem[]> {
    signal?.throwIfAborted();
    const kinds: Record<string, string[]> = { get_metrics: ["metric"], get_logs: ["log", "user_context"], get_deploy_history: ["deploy"], search_runbooks: ["runbook"] };
    if (!Object.hasOwn(kinds, tool)) throw new Error("Read-only adapter refuses this tool");
    const query = String(input.filter ?? input.query ?? "").toLowerCase();
    const words = query.split(/\s+/).filter(w => w.length > 2);
    const limit = typeof input.limit === "number" ? Math.max(1, Math.min(30, input.limit)) : 12;
    return this.evidence.filter(e => isVisible(e, this.at) && kinds[tool].includes(e.kind) && (!input.service || input.service === e.service) && (!query || (tool === "search_runbooks" ? words.some(w => e.text.toLowerCase().includes(w)) : e.text.toLowerCase().includes(query)))).slice(0, limit);
  }
}
