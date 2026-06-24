import { afterEach, describe, expect, it } from "vitest";
import { resolveAppBaseUrl } from "./appUrl";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("resolveAppBaseUrl", () => {
  it("uses the current request origin for self-hosted deployments", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(resolveAppBaseUrl("https://sre.example.com/api/webhook/alert")).toBe("https://sre.example.com");
  });

  it("prefers and normalizes an explicitly configured base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://public.example.com/copilot///";
    expect(resolveAppBaseUrl("https://internal.example.com/api")).toBe("https://public.example.com/copilot");
  });

  it("ignores invalid configured URLs and keeps a stable non-request fallback", () => {
    process.env.NEXT_PUBLIC_APP_URL = "javascript:alert(1)";
    expect(resolveAppBaseUrl("https://sre.example.com/api")).toBe("https://sre.example.com");
    expect(resolveAppBaseUrl()).toBe("https://ai-reliability-copilot.vercel.app");
  });
});
