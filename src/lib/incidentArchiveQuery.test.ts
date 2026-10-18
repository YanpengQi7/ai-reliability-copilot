import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildArchiveCursorExpression,
  buildArchiveSearchExpression,
  parseIncidentArchiveParams,
  type ArchiveCursor,
  type ArchiveFilters,
} from "./incidentArchive";
import { listIncidentArchivePage } from "./incidentArchiveQuery";

const admin = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({ supabaseAdmin: admin }));

const EMPTY: ArchiveFilters = { q: "", service: "", from: "", to: "" };
const ID = "11111111-1111-4111-8111-111111111111";
const TIME = "2026-10-04T12:34:56.123456+00:00";
type RequestSeen = { url: URL; init: RequestInit | undefined };

function row(index: number, created_at: string | null = TIME) {
  return {
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    title: `Incident ${index}`,
    service: "checkout",
    symptoms: "Timeouts",
    created_at,
  };
}

function fakeSupabaseClient(
  data: unknown = [],
  respond?: (request: RequestSeen) => Response | Promise<Response>,
) {
  const requests: RequestSeen[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: new URL(input instanceof Request ? input.url : String(input)), init };
    requests.push(request);
    return respond ? respond(request) : new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  });
  const client = createClient("https://fixture.invalid", "fixture-no-real-credential", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { client, requests, fetch };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  admin.mockReset();
});

describe("listIncidentArchivePage HTTP query", () => {
  it("uses an explicit metadata projection, stable null-last order, and one bounded sentinel", async () => {
    const { client, requests } = fakeSupabaseClient();
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toEqual({ incidents: [], nextCursor: null });
    expect(requests).toHaveLength(1);
    expect(requests[0].init?.method).toBe("GET");
    expect(requests[0].url.pathname).toBe("/rest/v1/incidents");
    expect(requests[0].url.searchParams.get("select")).toBe("id,title,service,symptoms,created_at");
    expect(requests[0].url.searchParams.get("order")).toBe("created_at.desc.nullslast,id.desc");
    expect(requests[0].url.searchParams.get("limit")).toBe("26");
    expect(requests[0].url.searchParams.has("or")).toBe(false);
    expect(requests[0].url.searchParams.has("offset")).toBe(false);
  });

  it("keeps exact service punctuation inside one eq parameter and converts inclusive UTC days to exclusive end", async () => {
    const service = ' api_%* / 中文,"(id.eq.fake) ';
    const { client, requests } = fakeSupabaseClient();
    await listIncidentArchivePage({ ...EMPTY, service, from: "2026-10-01", to: "2026-10-04" }, null, { client });
    const params = requests[0].url.searchParams;
    expect(params.get("service")).toBe(`eq.${service}`);
    expect(params.getAll("created_at")).toEqual(["gte.2026-10-01T00:00:00Z", "lt.2026-10-05T00:00:00Z"]);
    expect(params.has("id")).toBe(false);
    expect(params.has("or")).toBe(false);
  });

  it.each([
    'pool),(id.eq.00000000-0000-4000-8000-000000000000),title.imatch."x',
    'literal %_* \\ / "quotes",(commas) 中文',
    "[abc].*+?^${value}|end",
  ])("transports keyword grammar and regex characters as one escaped literal expression: %s", async q => {
    const { client, requests } = fakeSupabaseClient();
    await listIncidentArchivePage({ ...EMPTY, q }, null, { client });
    const params = requests[0].url.searchParams;
    expect(params.getAll("or")).toEqual([`(${buildArchiveSearchExpression(q)})`]);
    expect(params.has("id")).toBe(false);
    expect(params.has("title")).toBe(false);
    const expression = params.get("or")!;
    // Each quoted regex remains a single PostgREST value despite commas/quotes in the input.
    const values = [...expression.matchAll(/(?:title|service|symptoms)\.imatch\."((?:\\.|[^"\\])*)"/g)];
    expect(values).toHaveLength(3);
    for (const [, quoted] of values) {
      const regex = quoted.replace(/\\([\\"])/g, "$1");
      expect(new RegExp(regex, "i").test(q)).toBe(true);
      expect(new RegExp(regex, "i").test("unrelated ordinary metadata")).toBe(false);
    }
  });

  it("preserves both keyword OR and cursor OR as separate conditions combined by PostgREST", async () => {
    const q = 'bad,(id.gt.fake),"%_*';
    const cursor: ArchiveCursor = { id: ID, created_at: TIME };
    const { client, requests } = fakeSupabaseClient();
    await listIncidentArchivePage({ ...EMPTY, q, service: "checkout" }, cursor, { client });
    expect(requests[0].url.searchParams.getAll("or")).toEqual([
      `(${buildArchiveSearchExpression(q)})`,
      `(${buildArchiveCursorExpression(cursor)})`,
    ]);
  });

  it("preserves cursor microsecond precision and timezone instead of rounding through Date", async () => {
    const cursor: ArchiveCursor = { id: ID, created_at: "2026-10-04T12:34:56.123457+05:30" };
    const { client, requests } = fakeSupabaseClient();
    await listIncidentArchivePage(EMPTY, cursor, { client });
    const expression = requests[0].url.searchParams.get("or")!;
    expect(expression).toContain('created_at.lt."2026-10-04T12:34:56.123457+05:30"');
    expect(expression).toContain('created_at.eq."2026-10-04T12:34:56.123457+05:30"');
    expect(expression).toContain(`id.lt.${ID}`);
    expect(expression).toContain("created_at.is.null");
  });

  it("continues null timestamps with only null rows and descending ID", async () => {
    const { client, requests } = fakeSupabaseClient();
    await listIncidentArchivePage(EMPTY, { id: ID, created_at: null }, { client });
    expect(requests[0].url.searchParams.getAll("or")).toEqual([`(and(created_at.is.null,id.lt.${ID}))`]);
  });

  it("uses only the injected fetch, even when global networking would fail", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No real network allowed"));
    const { client, fetch } = fakeSupabaseClient([row(0)]);
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toMatchObject({ incidents: [row(0)] });
    expect(fetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
  });
});

describe("listIncidentArchivePage result boundaries", () => {
  it.each([0, 1, 24, 25])("returns %i rows without advertising another page", async count => {
    const rows = Array.from({ length: count }, (_, i) => row(i));
    const { client } = fakeSupabaseClient(rows);
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toEqual({ incidents: rows, nextCursor: null });
  });

  it("returns 25 visible rows and scopes a cursor to the last visible row, never the sentinel", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(i));
    const filters = { q: "timeout", service: "checkout", from: "2026-10-01", to: "2026-10-04" };
    const { client } = fakeSupabaseClient(rows);
    const result = await listIncidentArchivePage(filters, null, { client });
    expect(result.incidents).toEqual(rows.slice(0, 25));
    expect(result.nextCursor).toBeTypeOf("string");
    const parsed = parseIncidentArchiveParams({ ...filters, after: result.nextCursor! });
    expect(parsed.issues).toEqual([]);
    expect(parsed.cursor).toEqual({ id: rows[24].id, created_at: TIME });
    const changed = parseIncidentArchiveParams({ ...filters, q: "different", after: result.nextCursor! });
    expect(changed.cursor).toBeNull();
    expect(changed.issues).toContainEqual({ field: "after", code: "invalid_cursor" });
  });

  it("scopes a null-timestamp continuation without converting null to an epoch date", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => row(i, null));
    const { client } = fakeSupabaseClient(rows);
    const result = await listIncidentArchivePage(EMPTY, null, { client });
    expect(parseIncidentArchiveParams({ after: result.nextCursor! }).cursor).toEqual({ id: rows[24].id, created_at: null });
  });

  it("projects safe metadata again even when a backend returns raw context and unrelated columns", async () => {
    const rows = [{ ...row(0), raw_context: "PRIVATE_BODY_TOKEN", analysis: { summary: "PRIVATE_ANALYSIS" }, secret: "PRIVATE_KEY" }];
    const { client } = fakeSupabaseClient(rows);
    const result = await listIncidentArchivePage(EMPTY, null, { client });
    expect(result.incidents).toEqual([row(0)]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("preserves nullable metadata without exposing additional fields", async () => {
    const metadata = { id: ID, title: null, service: null, symptoms: null, created_at: null };
    const { client } = fakeSupabaseClient([metadata]);
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toEqual({ incidents: [metadata], nextCursor: null });
  });

  it("normalizes non-text metadata to null while rejecting unsafe identifiers", async () => {
    const { client } = fakeSupabaseClient([{ id: ID, title: 42, service: [], symptoms: {}, created_at: false }]);
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toEqual({
      incidents: [{ id: ID, title: null, service: null, symptoms: null, created_at: null }], nextCursor: null,
    });
    const invalid = fakeSupabaseClient([{ ...row(0), id: "../not-an-incident" }]);
    await expect(listIncidentArchivePage(EMPTY, null, { client: invalid.client })).rejects.toThrow("Invalid incident archive identifier");
  });

  it("normalizes null backend data to an empty page", async () => {
    const { client } = fakeSupabaseClient(null);
    await expect(listIncidentArchivePage(EMPTY, null, { client })).resolves.toEqual({ incidents: [], nextCursor: null });
  });

  it("returns empty without constructing a default client when configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(listIncidentArchivePage(EMPTY, null)).resolves.toEqual({ incidents: [], nextCursor: null });
    expect(admin).not.toHaveBeenCalled();
  });
});

describe("listIncidentArchivePage cancellation and failures", () => {
  it("throws an already aborted reason before any request", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before query");
    controller.abort(reason);
    const { client, fetch } = fakeSupabaseClient();
    await expect(listIncidentArchivePage(EMPTY, null, { client, abortSignal: controller.signal })).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the exact signal to fetch and propagates its deadline reason", async () => {
    const signal = AbortSignal.timeout(15);
    const { client, requests } = fakeSupabaseClient([], request => new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("Fixture fetch aborted", "AbortError"));
      if (request.init?.signal?.aborted) abort();
      else request.init?.signal?.addEventListener("abort", abort, { once: true });
    }));
    const pending = listIncidentArchivePage(EMPTY, null, { client, abortSignal: signal });
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requests).toHaveLength(1);
    expect(requests[0].init?.signal).toBe(signal);
  });

  it("checks cancellation after a successful fetch before returning stale data", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled after response");
    const { client } = fakeSupabaseClient([], () => {
      controller.abort(reason);
      return new Response(JSON.stringify([row(0)]), { headers: { "content-type": "application/json" } });
    });
    await expect(listIncidentArchivePage(EMPTY, null, { client, abortSignal: controller.signal })).rejects.toBe(reason);
  });

  it("throws backend errors instead of pretending the archive is empty", async () => {
    const { client, requests } = fakeSupabaseClient([], () => new Response(JSON.stringify({
      code: "42501", message: "fixture backend denied query", details: null, hint: null,
    }), { status: 403, headers: { "content-type": "application/json" } }));
    await expect(listIncidentArchivePage(EMPTY, null, { client })).rejects.toMatchObject({ code: "42501", message: "fixture backend denied query" });
    expect(requests).toHaveLength(1);
  });

  it("throws custom-fetch failures without falling back to real networking", async () => {
    vi.useFakeTimers();
    const { client, requests } = fakeSupabaseClient([], () => { throw new Error("fixture offline"); });
    const assertion = expect(listIncidentArchivePage(EMPTY, null, { client })).rejects.toMatchObject({ message: expect.stringContaining("fixture offline") });
    await vi.runAllTimersAsync();
    await assertion;
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.every(request => request.url.hostname === "fixture.invalid")).toBe(true);
  });
});
