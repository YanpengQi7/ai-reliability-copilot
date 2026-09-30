import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/agent/investigate", () => ({ investigate: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })), clientKey: () => "test", withRateLimitHeaders: (response: Response) => response }));
import { investigate } from "@/lib/agent/investigate";
import { DiagnosisValidationError } from "@/lib/agent/diagnosisValidation";
import type { Diagnosis } from "@/lib/agent/diagnosis";
import { POST } from "./route";

const rejected: Diagnosis = { summary: "private incident details", conclusion_status: "supported", severity: "SEV1", severity_reasoning: "private scope", root_causes: [], claims: [], mitigation_plan: [], missing_information: [] };
const request = () => new NextRequest("http://localhost/api/investigate", { method: "POST", headers: { "content-type": "application/json", "x-request-id": "validation-test" }, body: JSON.stringify({ scenario_slug: "pool-exhaustion" }) });

describe("investigation response validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("withholds rejected model output with a specific safe error and no automatic retry", async () => {
    vi.mocked(investigate).mockRejectedValue(new DiagnosisValidationError(rejected, [{ path: "claims", category: "unsupported_conclusion", reason: "missing_supported_claim" }]));
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: "DIAGNOSIS_REJECTED", requestId: "validation-test" });
    expect(response.headers.get("x-request-id")).toBe("validation-test");
    expect(JSON.stringify(body)).not.toContain(rejected.summary);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(rejected.summary);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"issue_count":1'));
    expect(investigate).toHaveBeenCalledOnce();
  });
  it("continues to distinguish provider failures from rejected diagnoses", async () => {
    vi.mocked(investigate).mockRejectedValue(new Error("provider unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "INVESTIGATION_FAILED" });
  });
});
