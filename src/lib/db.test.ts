import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));

vi.mock("./supabase", () => ({ supabaseAdmin: mocks.supabaseAdmin }));

import { getAnalysis, getIncident, getIncidentWithAnalyses } from "./db";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function mockClient(
  incidentResult: unknown,
  analysesResult: { data: unknown[]; error: unknown } = { data: [], error: null },
) {
  const maybeSingle = vi.fn().mockResolvedValue(incidentResult);
  const incidentAbortSignal = vi.fn();
  const incidentEq = vi.fn(() => ({ abortSignal: incidentAbortSignal, maybeSingle }));
  const incidentSelect = vi.fn(() => ({ eq: incidentEq }));
  const order = vi.fn().mockResolvedValue(analysesResult);
  const analysisAbortSignal = vi.fn();
  const analysisEq = vi.fn(() => ({ abortSignal: analysisAbortSignal, order }));
  const analysisSelect = vi.fn(() => ({ eq: analysisEq }));
  const from = vi.fn((table: string) => table === "incidents"
    ? { select: incidentSelect }
    : { select: analysisSelect });
  mocks.supabaseAdmin.mockReturnValue({ from });
  return { maybeSingle, order, incidentAbortSignal, analysisAbortSignal };
}

describe("getIncidentWithAnalyses", () => {
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

  it("propagates request cancellation to both database queries", async () => {
    const incident = { id: "incident-1", raw_context: "context" };
    const signal = new AbortController().signal;
    const { incidentAbortSignal, analysisAbortSignal } = mockClient({ data: incident, error: null });

    await getIncidentWithAnalyses(incident.id, { abortSignal: signal });

    expect(incidentAbortSignal).toHaveBeenCalledWith(signal);
    expect(analysisAbortSignal).toHaveBeenCalledWith(signal);
  });
});

describe("getIncident", () => {
  it("propagates pre-cancellation before opening a database client", async () => {
    const controller = new AbortController();
    controller.abort(new Error("query cancelled"));

    await expect(getIncident("incident-1", { abortSignal: controller.signal }))
      .rejects.toThrow("query cancelled");
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns null only when the incident does not exist", async () => {
    mockClient({ data: null, error: null });

    await expect(getIncident("missing")).resolves.toBeNull();
  });

  it("propagates database failures", async () => {
    const error = new Error("database unavailable");
    mockClient({ data: null, error });

    await expect(getIncident("incident-1")).rejects.toBe(error);
  });

  it("propagates request cancellation to the database query", async () => {
    const incident = { id: "incident-1", raw_context: "context" };
    const signal = new AbortController().signal;
    const { incidentAbortSignal } = mockClient({ data: incident, error: null });

    await expect(getIncident(incident.id, { abortSignal: signal })).resolves.toEqual(incident);
    expect(incidentAbortSignal).toHaveBeenCalledWith(signal);
  });
});

describe("getAnalysis", () => {
  function mockAnalysisQuery(result: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const abortSignal = vi.fn();
    const eq = vi.fn(() => ({ abortSignal, maybeSingle }));
    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    });
    return { abortSignal };
  }

  it("returns null only when the analysis does not exist", async () => {
    mockAnalysisQuery({ data: null, error: null });

    await expect(getAnalysis("missing")).resolves.toBeNull();
  });

  it("propagates database failures", async () => {
    const error = new Error("database unavailable");
    mockAnalysisQuery({ data: null, error });

    await expect(getAnalysis("analysis-1")).rejects.toBe(error);
  });

  it("propagates request cancellation to the database query", async () => {
    const analysis = { id: "analysis-1", incident_id: "incident-1" };
    const signal = new AbortController().signal;
    const { abortSignal } = mockAnalysisQuery({ data: analysis, error: null });

    await expect(getAnalysis(analysis.id, { abortSignal: signal })).resolves.toEqual(analysis);
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
});
