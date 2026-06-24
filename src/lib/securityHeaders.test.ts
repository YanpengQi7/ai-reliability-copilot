import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next.js security headers", () => {
  it("applies browser hardening headers to every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/:path*");
    const headers = new Map(globalRule?.headers.map((header) => [header.key, header.value]));

    const csp = headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("connect-src 'self' https:");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(headers.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  it("prevents caching API responses", async () => {
    const rules = await nextConfig.headers!();
    const apiRule = rules.find((rule) => rule.source === "/api/:path*");
    expect(apiRule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-store, max-age=0",
    });
  });
});
