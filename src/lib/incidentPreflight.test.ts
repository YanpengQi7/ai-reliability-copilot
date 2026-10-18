import { describe, expect, it } from "vitest";
import { buildIncidentPreflight, prepareIncidentSubmission, type IncidentTextInput } from "./incidentPreflight";
import { INPUT_LIMITS } from "./requestSafety";
import { MAX_SECRET_FINDINGS, redactSecrets } from "./secretScan";

const token = "sk-" + "a".repeat(30);
const input = {
  title: "Checkout errors",
  service: "payment-svc",
  symptoms: "Requests fail after deployment",
  raw_context: "The payment service returned 500s after the deploy at 14:00.",
  prompt_version: "v2" as const,
  output_language: "zh" as const,
};

describe("buildIncidentPreflight", () => {
  it("returns an empty preview for ordinary incident text", () => {
    expect(buildIncidentPreflight(input)).toEqual({ findings: [], capped: false });
  });

  it("reports only known fields, credential types, and original line numbers", () => {
    const result = buildIncidentPreflight({
      ...input,
      title: `Key: ${token}`,
      raw_context: `normal log\nnormal log\nkey ${token}`,
    });
    expect(result).toEqual({
      findings: [
        { field: "title", pattern: "OpenAI API key", line: 1 },
        { field: "raw_context", pattern: "OpenAI API key", line: 3 },
      ],
      capped: false,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.findings.every(finding => Object.keys(finding).sort().join() === "field,line,pattern")).toBe(true);
  });

  it("does not scan generic metadata or arbitrary extra strings", () => {
    const richerInput = { ...input, uploaded_filename: token, extra: { token } };
    expect(buildIncidentPreflight(richerInput)).toEqual({ findings: [], capped: false });
  });

  it("never exposes full or partial PEM bodies in the browser preview", () => {
    const keyBody = "SENSITIVE_FAKE_BODY_TOKEN";
    const result = buildIncidentPreflight({
      ...input,
      raw_context: `log preamble\n-----BEGIN PRIVATE KEY-----\n${keyBody}`,
    });
    expect(result).toEqual({
      findings: [{ field: "raw_context", pattern: "Private key (PEM)", line: 2 }],
      capped: false,
    });
    expect(JSON.stringify(result)).not.toContain(keyBody);
    expect(JSON.stringify(result)).not.toContain(keyBody.slice(-4));
  });

  it("caps a pathological field's preview at the scanner limit", () => {
    const result = buildIncidentPreflight({ ...input, raw_context: Array(100).fill(token).join("\n") });
    expect(result.findings).toHaveLength(MAX_SECRET_FINDINGS);
    expect(result.capped).toBe(true);
  });

  it("caps the combined preview across all four fields", () => {
    const repeated = Array(6).fill(token).join("\n");
    const result = buildIncidentPreflight({ title: repeated, service: repeated, symptoms: repeated, raw_context: repeated });
    expect(result.findings).toHaveLength(MAX_SECRET_FINDINGS);
    expect(result.capped).toBe(true);
    expect(result.findings.map(finding => finding.field)).toEqual([
      ...Array(6).fill("title"), ...Array(6).fill("service"), ...Array(6).fill("symptoms"), ...Array(2).fill("raw_context"),
    ]);
  });

  it("keeps uncapped findings from later fields when an earlier field has no secrets", () => {
    const result = buildIncidentPreflight({ ...input, service: `key ${token}`, symptoms: `key ${token}` });
    expect(result.findings.map(finding => finding.field)).toEqual(["service", "symptoms"]);
    expect(result.capped).toBe(false);
  });
});

describe("prepareIncidentSubmission", () => {
  it("retains ordinary input, prompt version, and output language without mutating the form", () => {
    const original = Object.freeze({ ...input });
    const result = prepareIncidentSubmission(original);
    expect(result).toEqual({ ok: true, input });
    if (!result.ok) throw new Error("Expected valid submission");
    expect(result.input).not.toBe(original);
    expect(result.input.prompt_version).toBe("v2");
    expect(result.input.output_language).toBe("zh");
    expect(original).toEqual(input);
  });

  it("redacts every incident field before the request and snapshot can share the result", () => {
    const original = {
      ...input,
      title: `Title ${token}`,
      service: `Service ${token}`,
      symptoms: `Symptoms ${token}`,
      raw_context: `Logs show checkout failed using ${token} after deployment.`,
    };
    const result = prepareIncidentSubmission(original);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid submission");
    expect(JSON.stringify(result.input)).not.toContain(token);
    expect(result.input.raw_context).toContain("[REDACTED: OpenAI API key]");
    expect(original.raw_context).toContain(token);
  });

  it("removes the entire private key before snapshotting raw context", () => {
    const result = prepareIncidentSubmission({
      ...input,
      raw_context: "Checkout TLS failure\n-----BEGIN RSA PRIVATE KEY-----\nPRIVATE_BODY_TOKEN\n-----END RSA PRIVATE KEY-----\nstatus=503",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid submission");
    expect(result.input.raw_context).toBe("Checkout TLS failure\n[REDACTED: Private key (PEM)]\nstatus=503");
    expect(JSON.stringify(result.input)).not.toContain("PRIVATE_BODY_TOKEN");
  });

  it("removes truncated private keys and all their remaining body before snapshotting", () => {
    const result = prepareIncidentSubmission({
      ...input,
      raw_context: "Checkout TLS failure\n-----BEGIN PRIVATE KEY-----\nTRUNCATED_PRIVATE_BODY_TOKEN\ntrailing untrusted material",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid submission");
    expect(result.input.raw_context).toBe("Checkout TLS failure\n[REDACTED: Private key (PEM)]");
  });

  it.each(["title", "service", "symptoms"] as const)("validates the %s length after redaction expands a short secret", field => {
    const credential = "AKIA" + "A".repeat(16);
    const replacement = redactSecrets(credential);
    expect(replacement.length).toBeGreaterThan(credential.length);
    const value = "x".repeat(INPUT_LIMITS.shortText - credential.length - 1) + ` ${credential}`;
    expect(value.length).toBe(INPUT_LIMITS.shortText);
    expect(prepareIncidentSubmission({ ...input, [field]: value })).toEqual({
      ok: false, field, error: "too_long", limit: INPUT_LIMITS.shortText,
    });
  });

  it("validates the raw-context limit after redaction expands a secret", () => {
    const credential = "AKIA" + "A".repeat(16);
    const raw_context = "x".repeat(INPUT_LIMITS.rawContext - credential.length - 1) + ` ${credential}`;
    expect(raw_context.length).toBe(INPUT_LIMITS.rawContext);
    expect(prepareIncidentSubmission({ ...input, raw_context })).toEqual({
      ok: false, field: "raw_context", error: "too_long", limit: INPUT_LIMITS.rawContext,
    });
  });

  it("accepts initially oversized private-key input when its sanitized result fits", () => {
    const result = prepareIncidentSubmission({
      ...input,
      raw_context: `Checkout TLS failure\n-----BEGIN PRIVATE KEY-----\n${"PRIVATE_KEY_BODY".repeat(4000)}\n-----END PRIVATE KEY-----`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid sanitized submission");
    expect(result.input.raw_context).toBe("Checkout TLS failure\n[REDACTED: Private key (PEM)]");
  });

  it.each(["title", "service", "symptoms", "raw_context"] as const)("rejects a final %s value over its bound", field => {
    const limit = field === "raw_context" ? INPUT_LIMITS.rawContext : INPUT_LIMITS.shortText;
    expect(prepareIncidentSubmission({ ...input, [field]: "x".repeat(limit + 1) })).toEqual({
      ok: false, field, error: "too_long", limit,
    });
  });

  it("accepts all maximum field bounds and the raw-context minimum exactly", () => {
    const maximum: IncidentTextInput = {
      title: "x".repeat(INPUT_LIMITS.shortText), service: "x".repeat(INPUT_LIMITS.shortText),
      symptoms: "x".repeat(INPUT_LIMITS.shortText), raw_context: "x".repeat(INPUT_LIMITS.rawContext),
    };
    expect(prepareIncidentSubmission(maximum)).toEqual({ ok: true, input: maximum });
    expect(prepareIncidentSubmission({ ...input, raw_context: "x".repeat(20) }).ok).toBe(true);
  });

  it("rejects raw context shorter than the API minimum", () => {
    expect(prepareIncidentSubmission({ ...input, raw_context: "x".repeat(19) })).toEqual({
      ok: false, field: "raw_context", error: "too_short", limit: 20,
    });
  });
});
