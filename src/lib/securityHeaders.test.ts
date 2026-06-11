import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next.js security headers", () => {
  it("applies browser hardening headers to every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/:path*");
    const headers = new Map(globalRule?.headers.map((header) => [header.key, header.value]));

    expect(headers.get("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
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
