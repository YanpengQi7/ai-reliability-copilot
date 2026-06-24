import { afterEach, describe, expect, it } from "vitest";
import { publicIncidentDataEnabled, requestHasIncidentDataAccess } from "./incidentAccess";

const original = {
  vercelEnv: process.env.VERCEL_ENV,
  allowPublic: process.env.ALLOW_PUBLIC_INCIDENT_DATA,
  accessToken: process.env.INCIDENT_ACCESS_TOKEN,
  webhookSecret: process.env.WEBHOOK_SECRET,
};

afterEach(() => {
  restore("VERCEL_ENV", original.vercelEnv);
  restore("ALLOW_PUBLIC_INCIDENT_DATA", original.allowPublic);
  restore("INCIDENT_ACCESS_TOKEN", original.accessToken);
  restore("WEBHOOK_SECRET", original.webhookSecret);
});
function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("persisted incident access", () => {
  it("keeps local development open", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.ALLOW_PUBLIC_INCIDENT_DATA;
    expect(publicIncidentDataEnabled()).toBe(true);
  });

  it("fails closed on Vercel production and preview", () => {
    delete process.env.ALLOW_PUBLIC_INCIDENT_DATA;
    process.env.VERCEL_ENV = "production";
    expect(publicIncidentDataEnabled()).toBe(false);
    process.env.VERCEL_ENV = "preview";
    expect(publicIncidentDataEnabled()).toBe(false);
  });

  it("allows an explicitly public sample-data deployment", () => {
    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_PUBLIC_INCIDENT_DATA = "true";
    expect(publicIncidentDataEnabled()).toBe(true);
  });

  it("accepts a bearer token without making browser access public", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.ALLOW_PUBLIC_INCIDENT_DATA;
    process.env.INCIDENT_ACCESS_TOKEN = "private-test-token";
    const authorized = new Request("https://example.com/api/incidents/id", {
      headers: { authorization: "Bearer private-test-token" },
    });
    const unauthorized = new Request("https://example.com/api/incidents/id", {
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(requestHasIncidentDataAccess(authorized)).toBe(true);
    expect(requestHasIncidentDataAccess(unauthorized)).toBe(false);
    expect(publicIncidentDataEnabled()).toBe(false);
  });

  it("falls back to the webhook secret for existing CLI installations", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.INCIDENT_ACCESS_TOKEN;
    process.env.WEBHOOK_SECRET = "existing-webhook-secret";
    const req = new Request("https://example.com/api/incidents/id", {
      headers: { authorization: "Bearer existing-webhook-secret" },
    });
    expect(requestHasIncidentDataAccess(req)).toBe(true);
  });
});
