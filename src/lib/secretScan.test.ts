import { describe, it, expect } from "vitest";
import { redactSecrets, scanForSecrets } from "./secretScan";

// This scanner blocks secrets from being persisted into the KB. A miss = a
// stored credential, so the false-negative tests matter most.
//
// NOTE: the test fixtures below are assembled at runtime by concatenation on
// purpose — writing a realistic-looking secret as a source literal would trip
// GitHub push-protection / secret-scanning on this very repo. The runtime value
// is intact, so our own regexes still get a real match to test against.
const FAKE = {
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  openai: "sk-" + "abcdefghijklmnopqrstuvwxyz1234",
  stripe: "sk_" + "live_" + "abcdEFGH1234567890abcdEFGH",
  githubPat: "ghp_" + "a".repeat(36),
  jwt: ["eyJ" + "a".repeat(12), "b".repeat(16), "c".repeat(16)].join("."),
  generic: "aZ8/kP3_qR7+vN2.mX9=Lt5-Wc4Hs6Df1Gj0Bu",
};

describe("scanForSecrets — detection", () => {
  it("flags an AWS access key id", () => {
    const findings = scanForSecrets(`aws_access_key_id = ${FAKE.aws}`);
    expect(findings.some((f) => f.pattern === "AWS Access Key")).toBe(true);
  });

  it("flags an OpenAI-style key", () => {
    const findings = scanForSecrets(`OPENAI_API_KEY=${FAKE.openai}`);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags a Stripe live secret", () => {
    const findings = scanForSecrets(`stripe key ${FAKE.stripe}`);
    expect(findings.some((f) => f.pattern === "Stripe Secret")).toBe(true);
  });

  it("flags a GitHub PAT", () => {
    const findings = scanForSecrets(`token ${FAKE.githubPat}`);
    expect(findings.some((f) => f.pattern === "GitHub token")).toBe(true);
  });

  it("flags a PEM private key header", () => {
    const findings = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIxxx");
    expect(findings.some((f) => f.pattern === "Private key (PEM)")).toBe(true);
  });

  it("flags JWTs, Basic auth, and credentialed connection URLs", () => {
    const basic = "Authorization: Basic " + "QWxhZGRpbjpvcGVuIHNlc2FtZQ==";
    const database = "postgresql://app:super-secret-password@db.internal:5432/prod";
    const findings = scanForSecrets([FAKE.jwt, basic, database].join("\n"));

    expect(findings.some((f) => f.pattern === "JWT / service token")).toBe(true);
    expect(findings.some((f) => f.pattern === "Basic auth credential")).toBe(true);
    expect(findings.some((f) => f.pattern === "Credentialed connection URL")).toBe(true);
  });

  it("flags high-entropy values assigned to sensitive names", () => {
    const findings = scanForSecrets(`client_secret=${FAKE.generic}`);
    expect(findings.some((f) => f.pattern === "High-entropy secret assignment")).toBe(true);
  });

  it("reports the line number of a finding", () => {
    const text = ["line one", "line two", `key ${FAKE.aws} here`].join("\n");
    const findings = scanForSecrets(text);
    const aws = findings.find((f) => f.pattern === "AWS Access Key");
    expect(aws?.line).toBe(3);
  });

  it("redacts the matched secret — never returns it verbatim", () => {
    const findings = scanForSecrets(FAKE.aws);
    const aws = findings.find((f) => f.pattern === "AWS Access Key");
    expect(aws?.match).not.toBe(FAKE.aws);
    expect(aws?.match).toContain("…");
  });
});

describe("scanForSecrets — clean input", () => {
  it("returns no findings for ordinary prose", () => {
    expect(scanForSecrets("The payment service returned 500s after the deploy at 14:00.")).toEqual([]);
  });

  it("does not flag low-entropy placeholders or ordinary hashes", () => {
    const text = [
      `password=${"x".repeat(32)}`,
      `commit=${"a1".repeat(20)}`,
      "token budget: 12000",
    ].join("\n");
    expect(scanForSecrets(text)).toEqual([]);
  });

  it("caps findings on pathological input", () => {
    const flood = Array.from({ length: 200 }, (_, i) => `AKIA${"A".repeat(12)}${String(i).padStart(4, "0")}`).join("\n");
    const findings = scanForSecrets(flood);
    expect(findings.length).toBeLessThanOrEqual(20);
  });
});

describe("redactSecrets", () => {
  it("removes credentials while preserving surrounding incident context", () => {
    const text = `payment-svc failed with token ${FAKE.openai} after deploy`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(FAKE.openai);
    expect(redacted).toContain("[REDACTED: OpenAI API key]");
    expect(redacted).toContain("payment-svc failed");
  });

  it("redacts generic assigned secrets and connection credentials", () => {
    const text = `client_secret=${FAKE.generic}\nredis://worker:redis-password@cache.internal:6379`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(FAKE.generic);
    expect(redacted).not.toContain("redis-password");
    expect(redacted).toContain("[REDACTED: High-entropy secret assignment]");
    expect(redacted).toContain("[REDACTED: Credentialed connection URL]");
  });
});
