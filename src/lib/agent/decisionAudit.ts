import type { Decision } from "./diagnosis";

export type DecisionAuditError = {
  step: number;
  reason: "missing_decisions" | "unseen_reference" | "decision_after_stop" | "missing_read" | "tool_mismatch" | "unrecorded_evidence" | "extra_read";
  evidence_ids?: string[];
};
type RecordedRead = { tool: string; evidence_ids: string[] };

/** Audits reference timing and recorded control flow; not semantic correctness. */
export function auditDecisionHistory(decisions: Decision[] | undefined, reads: RecordedRead[], initialIds: string[], finalIds: string[]) {
  if (decisions === undefined) return { available: false, decisions: 0, errors: [] as DecisionAuditError[] };
  const errors: DecisionAuditError[] = [];
  const seen = new Set(initialIds), recorded = new Set(finalIds);
  let cursor = 0, stopped = false;
  if (!decisions.length) errors.push({ step: 1, reason: "missing_decisions" });
  decisions.forEach((decision, index) => {
    const step = index + 1;
    if (stopped) errors.push({ step, reason: "decision_after_stop" });
    const unseen = [...new Set(decision.hypotheses.flatMap(h => [...h.supporting_ids, ...h.refuting_ids]))].filter(id => !seen.has(id));
    if (unseen.length) errors.push({ step, reason: "unseen_reference", evidence_ids: unseen });
    if (decision.done) { stopped = true; return; }
    const read = reads[cursor++];
    if (!read) { errors.push({ step, reason: "missing_read" }); return; }
    if (read.tool !== decision.tool) errors.push({ step, reason: "tool_mismatch" });
    const unrecorded = [...new Set(read.evidence_ids)].filter(id => !recorded.has(id));
    if (unrecorded.length) errors.push({ step, reason: "unrecorded_evidence", evidence_ids: unrecorded });
    // The observation arrives after this decision, so only the next decision can cite it.
    read.evidence_ids.filter(id => recorded.has(id)).forEach(id => seen.add(id));
  });
  if (cursor < reads.length) errors.push({ step: decisions.length + 1, reason: "extra_read" });
  return { available: true, decisions: decisions.length, errors };
}
