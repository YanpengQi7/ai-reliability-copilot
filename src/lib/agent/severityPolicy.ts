export const SEVERITY_POLICY_VERSION = "impact-v2";

export const SEVERITY_POLICY = `Severity policy impact-v2 (overrides any older numeric rubric):
SEV1: confirmed data loss/corruption risk, or complete unavailability of a critical user/revenue path, or sustained impact to at least 50% of users for at least 5 minutes.
SEV2: confirmed user-visible partial degradation below the SEV1 threshold, or complete loss of a non-critical service. There is no minimum percentage for confirmed customer impact to qualify as SEV2; even a small affected customer subset is customer-visible partial degradation.
SEV3: confirmed internal-only impact or warning without observed customer impact. Never assign SEV3 merely because the affected customer fraction is small. Request failure percentages and affected-user percentages have different denominators; do not compare one against a threshold for the other.
Unknown scope or duration is unknown, not zero. If the available evidence cannot establish a severity, use conclusion_status=insufficient_evidence and severity=null; name the missing observation. A provisional diagnosis may be tentative. A symptom such as OOM, high CPU or a recent deploy alone does not establish severity. Explicit data loss risk takes priority over availability rules.`;

export type Impact = { dataRisk: boolean; criticalPathDown: boolean; userImpactPercent: number | null; durationMinutes: number | null; internalOnly: boolean };
export function severityForImpact(i: Impact): "SEV1" | "SEV2" | "SEV3" | null {
  if (i.dataRisk || i.criticalPathDown) return "SEV1";
  if (i.internalOnly && i.userImpactPercent === 0) return "SEV3";
  if (i.userImpactPercent === null) return null;
  if (i.userImpactPercent >= 50) return i.durationMinutes === null ? null : i.durationMinutes >= 5 ? "SEV1" : "SEV2";
  return i.userImpactPercent > 0 ? "SEV2" : null;
}
