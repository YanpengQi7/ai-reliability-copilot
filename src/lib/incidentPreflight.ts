import { INPUT_LIMITS, redactSensitiveValue } from "./requestSafety";
import { MAX_SECRET_FINDINGS, scanForSecrets } from "./secretScan";

export type IncidentTextInput = {
  title: string;
  service: string;
  symptoms: string;
  raw_context: string;
};

export type IncidentSecretFinding = {
  field: keyof IncidentTextInput;
  pattern: string;
  line: number;
};

const TEXT_FIELDS = ["title", "service", "symptoms", "raw_context"] as const;

/** A bounded browser preview exposes credential kinds and locations only. */
export function buildIncidentPreflight(input: IncidentTextInput): {
  findings: IncidentSecretFinding[];
  capped: boolean;
} {
  const findings: IncidentSecretFinding[] = [];
  let capped = false;
  for (const field of TEXT_FIELDS) {
    // Only known form text is scanned; unrelated metadata never becomes a
    // credential preview, even when a richer generic input is supplied.
    if (typeof input[field] !== "string") continue;
    const fieldFindings = scanForSecrets(input[field]);
    // The scanner intentionally stops at its limit. At that boundary, more
    // findings may exist, so conservatively indicate a capped preview.
    if (fieldFindings.length >= MAX_SECRET_FINDINGS) capped = true;
    for (const finding of fieldFindings) {
      if (findings.length >= MAX_SECRET_FINDINGS) {
        capped = true;
        break;
      }
      findings.push({ field, pattern: finding.pattern, line: finding.line ?? 1 });
    }
  }
  return { findings, capped };
}

/** Sanitize the request and saved snapshot together, then check actual payload limits. */
export function prepareIncidentSubmission<T extends IncidentTextInput>(input: T):
  | { ok: true; input: T }
  | { ok: false; field: keyof IncidentTextInput; error: "too_long" | "too_short"; limit: number } {
  const redacted = redactSensitiveValue(input);
  for (const field of TEXT_FIELDS) {
    const limit = field === "raw_context" ? INPUT_LIMITS.rawContext : INPUT_LIMITS.shortText;
    if (redacted[field].length > limit) return { ok: false, field, error: "too_long", limit };
  }
  if (redacted.raw_context.length < 20) {
    return { ok: false, field: "raw_context", error: "too_short", limit: 20 };
  }
  return { ok: true, input: redacted };
}
