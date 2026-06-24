// Detect secret-like patterns in text before we persist it (KB ingest, raw
// incident context, etc.). Conservative: prefer false positives — better to
// block a real doc with an example token than to store a real one.
//
// We do NOT try to be exhaustive; we hit the high-frequency formats that
// actually appear in stolen-data dumps. Production deployments should layer
// a real secret scanner (Gitleaks, TruffleHog) in CI.

export type SecretFinding = {
  pattern: string;
  match: string;       // redacted preview, never the actual secret
  line?: number;
};

type SecretPattern = { name: string; re: RegExp; accept?: (match: string) => boolean };

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksLikeHighEntropyAssignment(match: string): boolean {
  const value = match.replace(/^[^:=]+[:=]\s*/, "").replace(/^["']|["']$/g, "");
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[_./+=-]/.test(value)].filter(Boolean).length;
  return classes >= 3 && shannonEntropy(value) >= 3.8;
}

const PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key",       re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS Secret Key",       re: /\b[A-Za-z0-9/+=]{40}\b(?=.*aws|.*secret|.*amazonaws)/gi },
  { name: "OpenAI API key",       re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "DeepSeek API key",     re: /\bsk-[a-f0-9]{32}\b/g },
  { name: "Anthropic API key",    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Stripe Secret",        re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "Slack token",          re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "GitHub token",         re: /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "JWT / service token",  re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "Supabase sb_secret",   re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key",       re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: "GitLab token",         re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Basic auth credential", re: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]{12,}/gi },
  { name: "Credentialed connection URL", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/gi },
  {
    name: "High-entropy secret assignment",
    re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}["']?/gi,
    accept: looksLikeHighEntropyAssignment,
  },
  { name: "Private key (PEM)",    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

function redact(match: string): string {
  if (match.length <= 8) return "***";
  return `${match.slice(0, 4)}…${match.slice(-4)}`;
}

/** Replace supported credentials before text is sent to a model or persisted. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { name, re, accept } of PATTERNS) {
    re.lastIndex = 0;
    redacted = redacted.replace(re, (match) => accept && !accept(match) ? match : `[REDACTED: ${name}]`);
  }
  return redacted;
}

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split("\n");
  for (const { name, re, accept } of PATTERNS) {
    // Reset regex state for global flag reuse
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (accept && !accept(m[0])) continue;
      const idx = m.index;
      let lineNum = 1;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        acc += lines[i].length + 1;
        if (acc > idx) { lineNum = i + 1; break; }
      }
      findings.push({ pattern: name, match: redact(m[0]), line: lineNum });
      if (findings.length >= 20) break; // cap to avoid pathological input
    }
    if (findings.length >= 20) break;
  }
  return findings;
}
