import { afterEach, describe, expect, it } from "vitest";
import { machineEndpointNeedsSecret, redactSensitiveValue } from "./requestSafety";

describe("redactSensitiveValue", () => {
  it("redacts nested strings without changing the object shape", () => {
    const secret = "sk-" + "a".repeat(30);
    const value = {
      raw_context: `token=${secret}`,
      root_causes: [{ evidence: secret, likelihood: 0.8 }],
    };

    const result = redactSensitiveValue(value);

    expect(result.raw_context).not.toContain(secret);
    expect(result.root_causes[0].evidence).not.toContain(secret);
    expect(result.root_causes[0].likelihood).toBe(0.8);
  });
});

describe("machineEndpointNeedsSecret", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalAllowPublic = process.env.ALLOW_PUBLIC_MACHINE_API;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalAllowPublic === undefined) delete process.env.ALLOW_PUBLIC_MACHINE_API;
    else process.env.ALLOW_PUBLIC_MACHINE_API = originalAllowPublic;
  });

  it("fails closed on Vercel production when the token is missing", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.ALLOW_PUBLIC_MACHINE_API;
    expect(machineEndpointNeedsSecret(undefined)).toBe(true);
  });

  it("allows local development and explicit public deployments", () => {
    delete process.env.VERCEL_ENV;
    expect(machineEndpointNeedsSecret(undefined)).toBe(false);

    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_PUBLIC_MACHINE_API = "true";
    expect(machineEndpointNeedsSecret(undefined)).toBe(false);
  });
});
