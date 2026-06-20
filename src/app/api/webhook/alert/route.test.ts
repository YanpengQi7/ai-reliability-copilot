import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { POST } from "./route";

const original = {
  webhookSecret: process.env.WEBHOOK_SECRET,
  allowLegacy: process.env.ALLOW_LEGACY_QUERY_SECRET,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  deepseekKey: process.env.DEEPSEEK_API_KEY,
};

afterEach(() => {
  restore("WEBHOOK_SECRET", original.webhookSecret);
  restore("ALLOW_LEGACY_QUERY_SECRET", original.allowLegacy);
  restore("NEXT_PUBLIC_SUPABASE_URL", original.supabaseUrl);
  restore("SUPABASE_SERVICE_ROLE_KEY", original.serviceKey);
  restore("DEEPSEEK_API_KEY", original.deepseekKey);
  mocks.supabaseAdmin.mockReset();
  vi.restoreAllMocks();
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

describe("webhook persistence", () => {
  it("rejects an empty incident insert result", async () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.DEEPSEEK_API_KEY = "test-key";
    const single = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single })),
        })),
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request("https://example.com/api/webhook/alert"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "DB_ERROR" });
  });
});
