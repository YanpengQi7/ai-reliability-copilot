import { afterEach, describe, expect, it } from "vitest";
import { isHostedDeployment, requestCanSeeHealthDetails } from "./deployment";

const original = {
  nodeEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV,
  healthToken: process.env.HEALTHCHECK_TOKEN,
};

afterEach(() => {
  restore("NODE_ENV", original.nodeEnv);
  restore("VERCEL_ENV", original.vercelEnv);
  restore("HEALTHCHECK_TOKEN", original.healthToken);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("deployment privacy", () => {
  it("shows health details in local development", () => {
    Reflect.set(process.env, "NODE_ENV", "test");
    delete process.env.VERCEL_ENV;
    expect(isHostedDeployment()).toBe(false);
    expect(requestCanSeeHealthDetails(new Request("https://example.com/api/healthz"))).toBe(true);
  });

  it("hides hosted details unless a dedicated bearer token matches", () => {
    process.env.VERCEL_ENV = "production";
    process.env.HEALTHCHECK_TOKEN = "health-test-token";

    expect(requestCanSeeHealthDetails(new Request("https://example.com/api/healthz"))).toBe(false);
    expect(requestCanSeeHealthDetails(new Request("https://example.com/api/healthz", {
      headers: { authorization: "Bearer health-test-token" },
    }))).toBe(true);
  });

  it("fails closed on hosted deployments without a health token", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.HEALTHCHECK_TOKEN;
    expect(requestCanSeeHealthDetails(new Request("https://example.com/api/healthz"))).toBe(false);
  });
});
