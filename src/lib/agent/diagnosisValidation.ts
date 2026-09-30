import type { Diagnosis } from "./diagnosis";
import { checkClaims, type EvidenceItem } from "./evidence";

export type DiagnosisIssue = {
  path: string;
  category: "invalid_claim" | "unknown_cause_reference" | "unsupported_conclusion" | "inconsistent_uncertainty";
  reason: string;
};

/** Deterministic integrity checks only; valid citations do not prove semantic support. */
export function checkDiagnosis(diagnosis: Diagnosis, evidence: EvidenceItem[]): DiagnosisIssue[] {
  const issues: DiagnosisIssue[] = [];
  checkClaims(diagnosis.claims, evidence).forEach((check, index) => {
    for (const reason of check.errors) issues.push({ path: `claims.${index}`, category: "invalid_claim", reason });
  });
  const ids = new Set(evidence.map(item => item.id));
  diagnosis.root_causes.forEach((cause, index) => {
    for (const field of ["supporting_ids", "refuting_ids"] as const) {
      if (cause[field].some(id => !ids.has(id))) issues.push({ path: `root_causes.${index}.${field}`, category: "unknown_cause_reference", reason: "unknown_reference" });
    }
    if (diagnosis.conclusion_status === "supported" && !cause.supporting_ids.length) {
      issues.push({ path: `root_causes.${index}.supporting_ids`, category: "unsupported_conclusion", reason: "missing_cause_support" });
    }
  });
  if (diagnosis.conclusion_status === "supported") {
    if (!diagnosis.root_causes.length) issues.push({ path: "root_causes", category: "unsupported_conclusion", reason: "missing_supported_cause" });
    if (!diagnosis.claims.some(claim => claim.kind !== "hypothesis" && claim.evidence_ids.length)) {
      issues.push({ path: "claims", category: "unsupported_conclusion", reason: "missing_supported_claim" });
    }
  }
  if (diagnosis.conclusion_status === "insufficient_evidence" && diagnosis.severity !== null) {
    issues.push({ path: "severity", category: "inconsistent_uncertainty", reason: "insufficient_evidence_requires_unknown_severity" });
  }
  return issues;
}

export class DiagnosisValidationError extends Error {
  constructor(readonly diagnosis: Diagnosis, readonly issues: DiagnosisIssue[]) {
    // Error messages may enter public logs. Never embed model output or source content.
    super(`Diagnosis failed evidence integrity validation (${issues.length} issues).`);
    this.name = "DiagnosisValidationError";
  }
}
