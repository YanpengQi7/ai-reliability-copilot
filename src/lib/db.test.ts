import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("./supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { getIncidentWithAnalyses } from "./db";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function mockClient(
  incidentResult: unknown,
  analysesResult: { data: unknown[]; error: unknown } = { data: [], error: null },
) {
  const maybeSingle = vi.fn().mockResolvedValue(incidentResult);
  const incidentEq = vi.fn(() => ({ maybeSingle }));
  const incidentSelect = vi.fn(() => ({ eq: incidentEq }));
  const order = vi.fn().mockResolvedValue(analysesResult);
  const analysisEq = vi.fn(() => ({ order }));
  const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
  const from = vi.fn((table: string) => table === "incidents"
    ? { select: incidentSelect }
    : { select: analysisSelect });
  mocks.supabaseAdmin.mockReturnValue({ from });
  return { maybeSingle, order };
}

describe("getIncidentWithAnalyses", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    mocks.supabaseAdmin.mockReset();
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("returns null only when the incident does not exist", async () => {
    const { order } = mockClient({ data: null, error: null });

    await expect(getIncidentWithAnalyses("missing")).resolves.toBeNull();
    expect(order).not.toHaveBeenCalled();
  });

  it("propagates incident query failures", async () => {
    const error = new Error("database unavailable");
    mockClient({ data: null, error });

    await expect(getIncidentWithAnalyses("incident-1")).rejects.toBe(error);
  });

  it("returns the incident and its analyses", async () => {
    const incident = { id: "incident-1", raw_context: "context" };
    const analyses = [{ id: "analysis-1", incident_id: incident.id }];
    mockClient({ data: incident, error: null }, { data: analyses, error: null });

    await expect(getIncidentWithAnalyses(incident.id)).resolves.toEqual({ incident, analyses });
  });
});
