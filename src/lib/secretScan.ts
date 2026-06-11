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

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "AWS Access Key",       re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS Secret Key",       re: /\b[A-Za-z0-9/+=]{40}\b(?=.*aws|.*secret|.*amazonaws)/gi },
  { name: "OpenAI API key",       re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "DeepSeek API key",     re: /\bsk-[a-f0-9]{32}\b/g },
  { name: "Anthropic API key",    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Stripe Secret",        re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "Slack token",          re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "GitHub token",         re: /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "Supabase service key", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: "Supabase sb_secret",   re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
  { name: "Private key (PEM)",    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

function redact(match: string): string {
  if (match.length <= 8) return "***";
  return `${match.slice(0, 4)}…${match.slice(-4)}`;
}

/** Replace supported credentials before text is sent to a model or persisted. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    redacted = redacted.replace(re, `[REDACTED: ${name}]`);
  }
  return redacted;
}

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split("\n");
  for (const { name, re } of PATTERNS) {
    // Reset regex state for global flag reuse
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
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
