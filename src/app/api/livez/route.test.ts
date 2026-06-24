import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/livez", () => {
  it("returns a dependency-free liveness response", async () => {
    const response = await GET(new Request("https://example.com/api/livez"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body).toMatchObject({ status: "ok" });
    expect(body.ts).toEqual(expect.any(String));
  });
});
