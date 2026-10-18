import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LIMITS, ARCHIVE_PAGE_SIZE, archiveDateBounds, archiveHref,
  buildArchiveCursorExpression, buildArchiveSearchExpression, encodeIncidentArchiveCursor,
  hasArchiveFilters, parseIncidentArchiveParams, type ArchiveCursor, type ArchiveFilters,
} from "./incidentArchive";

const empty: ArchiveFilters = { q: "", service: "", from: "", to: "" };
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const cursor: ArchiveCursor = { created_at: "2026-10-04T15:00:00.123456+00:00", id };

function rewriteCursor(token: string, patch: Record<string, unknown>): string {
  const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
  return Buffer.from(JSON.stringify({ ...payload, ...patch }), "utf-8").toString("base64url");
}

describe("parseIncidentArchiveParams", () => {
  it("defaults empty filters and ignores unrelated query keys", () => {
    expect(parseIncidentArchiveParams({ unknown: "raw log contents", after: "" })).toEqual({ filters: empty, cursor: null, issues: [] });
    expect(ARCHIVE_PAGE_SIZE).toBe(25);
  });

  it("trims search/dates, supports Unicode and retains exact service boundary spaces", () => {
    expect(parseIncidentArchiveParams({ q: "  连接池 latency  ", service: " checkout ", from: " 2026-10-01 ", to: "2026-10-04" })).toEqual({
      filters: { q: "连接池 latency", service: " checkout ", from: "2026-10-01", to: "2026-10-04" }, cursor: null, issues: [],
    });
    expect(parseIncidentArchiveParams({ q: "   ", service: "   " }).filters).toEqual(empty);
    const filters = { ...empty, service: " checkout " };
    const token = encodeIncidentArchiveCursor(cursor, filters);
    expect(parseIncidentArchiveParams({ service: " checkout ", after: token }).cursor).toEqual(cursor);
    expect(parseIncidentArchiveParams({ service: "checkout", after: token }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
  });

  it.each(["q", "service", "from", "to", "after"] as const)("rejects repeated %s values", field => {
    const result = parseIncidentArchiveParams({ [field]: ["first", "second"] });
    expect(result.issues).toEqual([{ field, code: "multiple" }]);
    expect(result.cursor).toBeNull();
    expect(result.filters).toEqual(empty);
  });

  it("accepts exact text limits and rejects overflow without truncation", () => {
    const q = "q".repeat(ARCHIVE_LIMITS.q), service = "s".repeat(ARCHIVE_LIMITS.service);
    expect(parseIncidentArchiveParams({ q, service }).filters).toEqual({ ...empty, q, service });
    expect(parseIncidentArchiveParams({ q: `${q}x`, service: `${service}x` })).toEqual({
      filters: empty, cursor: null, issues: [{ field: "q", code: "too_long" }, { field: "service", code: "too_long" }],
    });
  });

  it.each(["NUL\u0000", "line\nnext", "tab\tvalue", "escape\u001b", "delete\u007f", "control\u0085"])("rejects control text: %s", q => {
    expect(parseIncidentArchiveParams({ q }).issues).toEqual([{ field: "q", code: "invalid_text" }]);
    expect(parseIncidentArchiveParams({ service: q }).filters.service).toBe("");
  });

  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "0000-01-01", "10000-01-01", "2026-1-2", "today", "2026-01-01T00:00:00Z"])("rejects impossible or non-calendar dates: %s", from => {
    expect(parseIncidentArchiveParams({ from })).toEqual({ filters: empty, cursor: null, issues: [{ field: "from", code: "invalid_date" }] });
  });

  it("accepts Gregorian leap days, early years and the upper date limit", () => {
    for (const date of ["0001-01-01", "0004-02-29", "2000-02-29", "2024-02-29", "9999-12-31"]) {
      expect(parseIncidentArchiveParams({ from: date, to: date }).issues).toEqual([]);
    }
  });

  it("reports reversed date bounds while retaining valid values for correction", () => {
    const result = parseIncidentArchiveParams({ from: "2026-10-04", to: "2026-10-01" });
    expect(result.filters).toEqual({ ...empty, from: "2026-10-04", to: "2026-10-01" });
    expect(result.issues).toEqual([{ field: "to", code: "date_range" }]);
    expect(result.cursor).toBeNull();
  });
});

describe("UTC date bounds", () => {
  it("makes the selected final day inclusive with an exclusive next-day boundary", () => {
    expect(archiveDateBounds({ ...empty, from: "2026-10-01", to: "2026-10-04" })).toEqual({ from: "2026-10-01T00:00:00Z", toExclusive: "2026-10-05T00:00:00Z" });
    expect(archiveDateBounds(empty)).toEqual({ from: null, toExclusive: null });
  });

  it.each([
    ["2024-02-28", "2024-02-29"], ["2024-02-29", "2024-03-01"],
    ["1900-02-28", "1900-03-01"], ["2000-02-28", "2000-02-29"],
    ["0001-12-31", "0002-01-01"], ["2026-12-31", "2027-01-01"],
    ["9999-12-31", "10000-01-01"],
  ])("uses exact calendar arithmetic for %s", (to, next) => {
    expect(archiveDateBounds({ ...empty, to }).toExclusive).toBe(`${next}T00:00:00Z`);
  });

  it("rejects direct invalid bounds rather than silently rolling invalid dates", () => {
    expect(() => archiveDateBounds({ ...empty, to: "2026-02-30" })).toThrow("Invalid archive date filters.");
    expect(() => archiveDateBounds({ ...empty, from: "2026-10-04", to: "2026-10-01" })).toThrow();
  });
});

describe("filter-bound keyset cursors", () => {
  it("retains microseconds and timezone offset without converting to milliseconds", () => {
    const exact = { created_at: "2026-10-04T15:00:00.123456-07:00", id };
    const token = encodeIncidentArchiveCursor(exact, empty);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseIncidentArchiveParams({ after: token })).toEqual({ filters: empty, cursor: exact, issues: [] });
    expect(buildArchiveCursorExpression(exact)).toBe(`created_at.lt."2026-10-04T15:00:00.123456-07:00",and(created_at.eq."2026-10-04T15:00:00.123456-07:00",id.lt.${id}),created_at.is.null`);
  });

  it("breaks timestamp ties by UUID and then includes undated rows", () => {
    const first = encodeIncidentArchiveCursor(cursor, empty);
    const second = encodeIncidentArchiveCursor({ ...cursor, id: otherId }, empty);
    expect(first).not.toBe(second);
    expect(buildArchiveCursorExpression(cursor)).toContain(`and(created_at.eq."${cursor.created_at}",id.lt.${id})`);
    expect(buildArchiveCursorExpression(cursor)).toMatch(/,created_at\.is\.null$/);
  });

  it("paginates the undated tail by UUID only", () => {
    const nullCursor = { created_at: null, id };
    const token = encodeIncidentArchiveCursor(nullCursor, empty);
    expect(parseIncidentArchiveParams({ after: token }).cursor).toEqual(nullCursor);
    expect(buildArchiveCursorExpression(nullCursor)).toBe(`and(created_at.is.null,id.lt.${id})`);
  });

  it("binds cursors to every canonical filter and ignores object key order", () => {
    const filters = { q: "pool", service: " checkout ", from: "2026-10-01", to: "2026-10-04" };
    const token = encodeIncidentArchiveCursor(cursor, filters);
    const reordered = { to: filters.to, service: filters.service, q: filters.q, from: filters.from };
    expect(encodeIncidentArchiveCursor(cursor, reordered)).toBe(token);
    expect(parseIncidentArchiveParams({ ...filters, after: token }).cursor).toEqual(cursor);
    for (const field of ["q", "service", "from", "to"] as const) {
      const changed = field === "from" ? "2026-10-02" : field === "to" ? "2026-10-05" : `${filters[field]} changed`;
      expect(parseIncidentArchiveParams({ ...filters, [field]: changed, after: token }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
    }
  });

  it("rejects wrong versions, unknown fields, wrong scope and malformed shapes", () => {
    const token = encodeIncidentArchiveCursor(cursor, empty);
    for (const patch of [{ v: 2 }, { v: "1" }, { extra: "raw context" }, { scope: "wrong" }, { id: "not-a-uuid" }, { created_at: 17 }]) {
      expect(parseIncidentArchiveParams({ after: rewriteCursor(token, patch) }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
    }
    for (const payload of ["null", "[]", "{}", "1", '{"v":1}']) {
      const encoded = Buffer.from(payload, "utf-8").toString("base64url");
      expect(parseIncidentArchiveParams({ after: encoded }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
    }
  });

  it.each([
    "2026-02-30T15:00:00Z", "2026-10-04T24:00:00Z", "2026-10-04T15:60:00Z", "2026-10-04T15:00:60Z",
    "2026-10-04T15:00:00.1234567Z", "2026-10-04T15:00:00+16:00", "2026-10-04T15:00:00+00:60",
    "2026-10-04T15:00:00", "infinity", '2026-10-04T15:00:00Z",id.neq.null',
  ])("rejects invalid or injected timestamp strings: %s", created_at => {
    const token = encodeIncidentArchiveCursor(cursor, empty);
    expect(parseIncidentArchiveParams({ after: rewriteCursor(token, { created_at }) }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
    expect(() => buildArchiveCursorExpression({ created_at, id })).toThrow("Invalid archive cursor.");
    expect(() => encodeIncidentArchiveCursor({ created_at, id }, empty)).toThrow();
  });

  it("rejects invalid UUID/operator injection even for null timestamps", () => {
    expect(() => buildArchiveCursorExpression({ created_at: null, id: `${id},title.neq.null` })).toThrow();
  });

  it("rejects malformed/noncanonical encodings and oversized tokens", () => {
    const valid = encodeIncidentArchiveCursor(cursor, empty);
    for (const token of [`${valid}=`, ` ${valid}`, "!invalid!", "a", Buffer.from([0xff, 0xfe]).toString("base64url")]) {
      expect(parseIncidentArchiveParams({ after: token }).issues).toEqual([{ field: "after", code: "invalid_cursor" }]);
    }
    expect(parseIncidentArchiveParams({ after: "x".repeat(ARCHIVE_LIMITS.cursor + 1) }).issues).toEqual([{ field: "after", code: "too_long" }]);
  });

  it("does not decode a cursor when the filters themselves are invalid", () => {
    const token = encodeIncidentArchiveCursor(cursor, empty);
    const parsed = parseIncidentArchiveParams({ q: "x".repeat(ARCHIVE_LIMITS.q + 1), after: token });
    expect(parsed.cursor).toBeNull();
    expect(parsed.issues).toEqual([{ field: "q", code: "too_long" }]);
  });
});

describe("archive URLs", () => {
  it("round-trips literal filter text and bound cursors without adding unknown keys", () => {
    const filters = { q: 'pool, "服务" & 50%_ * / [x]', service: " checkout & payments ", from: "2026-10-01", to: "2026-10-04" };
    const token = encodeIncidentArchiveCursor(cursor, filters);
    const href = archiveHref({ ...filters, unknown: "ignored" } as ArchiveFilters, token);
    const url = new URL(href, "https://example.com");
    expect(Array.from(url.searchParams.keys())).toEqual(["q", "service", "from", "to", "after"]);
    expect(parseIncidentArchiveParams(Object.fromEntries(url.searchParams))).toEqual({ filters, cursor, issues: [] });
    expect(archiveHref(filters)).not.toContain("after=");
  });

  it("omits empty values and recognizes any active filter", () => {
    expect(archiveHref(empty)).toBe("/incidents");
    expect(hasArchiveFilters(empty)).toBe(false);
    for (const field of ["q", "service", "from", "to"] as const) expect(hasArchiveFilters({ ...empty, [field]: "value" })).toBe(true);
  });
});

describe("literal PostgreSQL search expressions", () => {
  function patterns(expression: string): string[] {
    return Array.from(expression.matchAll(/(?:title|service|symptoms)\.imatch\.("(?:[^"\\]|\\.)*")/g), match => JSON.parse(match[1]));
  }

  it.each(["50%_", "literal*star", "path/checkout", "连接池", ".^$*+?()[]{}|\\", 'title"),id.neq.null,(service', "checkout:prod,blue"])("treats every character of %s as literal text", q => {
    const expression = buildArchiveSearchExpression(q);
    expect(expression).not.toBeNull();
    const decoded = patterns(expression!);
    expect(decoded).toHaveLength(3);
    expect(new Set(decoded).size).toBe(1);
    const matcher = new RegExp(decoded[0], "i");
    expect(matcher.test(`prefix ${q} suffix`)).toBe(true);
    expect(matcher.test("entirely unrelated incident")).toBe(false);
    expect(expression).not.toContain(".ilike.");
  });

  it("adds no arbitrary OR operators even when quotes/commas/parentheses are supplied", () => {
    const expression = buildArchiveSearchExpression('"),id.gt.0,or=(title.neq.null)')!;
    const decoded = patterns(expression);
    expect(decoded).toHaveLength(3);
    expect(expression).toBe(["title", "service", "symptoms"].map(field => `${field}.imatch.${JSON.stringify(decoded[0])}`).join(","));
  });

  it("returns null for no search and rejects direct invalid inputs", () => {
    expect(buildArchiveSearchExpression("")).toBeNull();
    expect(() => buildArchiveSearchExpression("x".repeat(ARCHIVE_LIMITS.q + 1))).toThrow("Invalid archive search text.");
    expect(() => buildArchiveSearchExpression("pool\u0000")).toThrow();
  });
});
