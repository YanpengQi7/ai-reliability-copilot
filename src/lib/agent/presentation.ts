import type { Analysis } from "../schema";
import type { Diagnosis } from "./diagnosis";

export type InvestigationAnalysis = Omit<Analysis, "severity" | "root_causes"> & {
  severity: Diagnosis["severity"];
  root_causes: { hypothesis: string; evidence: string; likelihood: "unassessed" }[];
};

/** Presentation only: never fabricate extra causes, commands, impact or certainty. */
export function presentDiagnosis(d: Diagnosis, stopReason: string): InvestigationAnalysis {
  const incomplete = ["step_cap", "no_progress"].includes(stopReason);
  return {
    summary: `${incomplete ? `Investigation incomplete (${stopReason}); unresolved checks remain. ` : ""}${d.summary}`,
    severity: d.severity,
    severity_reasoning: d.severity_reasoning,
    root_causes: d.root_causes.map(c => ({ hypothesis: c.hypothesis, likelihood: "unassessed",
      evidence: `Supporting: ${c.supporting_ids.join(", ") || "none"}. Contradicting: ${c.refuting_ids.join(", ") || "none"}. Missing: ${c.missing_evidence.join("; ") || "none stated"}.` })),
    investigation_checklist: d.root_causes.filter(c => c.next_check.trim()).map(c => ({ step: c.next_check, command: "", expected: `Confirm or refute: ${c.hypothesis}` })),
    mitigation_plan: d.mitigation_plan,
    customer_impact: d.severity_reasoning,
    postmortem_draft: `## Summary\n${d.summary}\n\n## Claims and citations\n${d.claims.map(c => `- ${c.text} [${c.evidence_ids.join(", ")}]`).join("\n") || "No claims recorded."}\n\n## Unresolved information\n${d.missing_information.map(m => `- ${m}`).join("\n") || "None stated."}`,
    follow_ups: d.missing_information.map(item => ({ item, owner_role: "on-call engineer", priority: "P1" })),
  };
}
