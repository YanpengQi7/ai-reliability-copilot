import { describe, expect, it } from "vitest";
import { bearerToken, hasBearerToken, secureTokenEqual } from "./serverAuth";

describe("server token authentication", () => {
  it("parses bearer tokens case-insensitively", () => {
    const req = new Request("https://example.com", { headers: { authorization: "bearer secret-token" } });
    expect(bearerToken(req)).toBe("secret-token");
    expect(hasBearerToken(req, "secret-token")).toBe(true);
  });

  it("rejects missing, malformed, and incorrect credentials", () => {
    expect(hasBearerToken(new Request("https://example.com"), "secret-token")).toBe(false);
    expect(hasBearerToken(new Request("https://example.com", { headers: { authorization: "Basic abc" } }), "secret-token")).toBe(false);
    expect(secureTokenEqual("wrong-token", "secret-token")).toBe(false);
    expect(secureTokenEqual("short", "much-longer-token")).toBe(false);
  });
});
