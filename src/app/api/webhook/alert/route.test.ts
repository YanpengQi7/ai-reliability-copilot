import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const original = {
  webhookSecret: process.env.WEBHOOK_SECRET,
  allowLegacy: process.env.ALLOW_LEGACY_QUERY_SECRET,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  restore("WEBHOOK_SECRET", original.webhookSecret);
  restore("ALLOW_LEGACY_QUERY_SECRET", original.allowLegacy);
  restore("NEXT_PUBLIC_SUPABASE_URL", original.supabaseUrl);
  restore("SUPABASE_SERVICE_ROLE_KEY", original.serviceKey);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "x-forwarded-for": crypto.randomUUID(), ...headers },
    body: "incident payload",
  });
}

describe("webhook authentication", () => {
  it("rejects secrets in query strings by default", async () => {
    process.env.WEBHOOK_SECRET = "webhook-test-secret";
    delete process.env.ALLOW_LEGACY_QUERY_SECRET;

    const response = await POST(request("https://example.com/api/webhook/alert?secret=webhook-test-secret"));

    expect(response.status).toBe(401);
  });

  it("accepts bearer auth and only allows query auth with an explicit legacy opt-in", async () => {
    process.env.WEBHOOK_SECRET = "webhook-test-secret";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const bearer = await POST(request("https://example.com/api/webhook/alert", {
      authorization: "Bearer webhook-test-secret",
    }));
    expect(bearer.status).toBe(503);
    await expect(bearer.json()).resolves.toMatchObject({ error: "DB_UNCONFIGURED" });

    process.env.ALLOW_LEGACY_QUERY_SECRET = "true";
    const legacy = await POST(request("https://example.com/api/webhook/alert?secret=webhook-test-secret"));
    expect(legacy.status).toBe(503);
  });
});
