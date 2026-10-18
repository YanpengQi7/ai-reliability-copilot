import "server-only";

import { createHash } from "node:crypto";
import { isIncidentId } from "./identifiers";

export const ARCHIVE_PAGE_SIZE = 25;
export const ARCHIVE_LIMITS = { q: 200, service: 500, cursor: 1024 } as const;

export type ArchiveFilters = { q: string; service: string; from: string; to: string };
export type ArchiveCursor = { created_at: string | null; id: string };
export type ArchiveSearchParams = Record<string, string | string[] | undefined>;
export type ArchiveParamIssue = {
  field: "q" | "service" | "from" | "to" | "after";
  code: "multiple" | "too_long" | "invalid_date" | "date_range" | "invalid_cursor" | "invalid_text";
};

const FILTER_KEYS = ["q", "service", "from", "to"] as const;
const CURSOR_KEYS = new Set(["v", "created_at", "id", "scope"]);
const CONTROL_TEXT = /[\u0000-\u001f\u007f-\u009f]/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDate(match[1])) return false;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false;
  const zone = match[5];
  // PostgreSQL permits numeric offsets through 15:59; names and operators are not cursor values.
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 15 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value.replace(" ", "T")));
}

function validCursor(value: unknown): value is ArchiveCursor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return Object.hasOwn(cursor, "id") && typeof cursor.id === "string" && isIncidentId(cursor.id)
    && Object.hasOwn(cursor, "created_at") && (cursor.created_at === null || validTimestamp(cursor.created_at));
}

function canonicalFilters(filters: ArchiveFilters): ArchiveFilters {
  return { q: filters.q, service: filters.service, from: filters.from, to: filters.to };
}

function filterScope(filters: ArchiveFilters): string {
  return createHash("sha256").update(JSON.stringify(canonicalFilters(filters))).digest("hex");
}

function decodeCursor(token: string, filters: ArchiveFilters): ArchiveCursor | null {
  if (!token || token.length > ARCHIVE_LIMITS.cursor || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) return null;
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
    const value = payload as Record<string, unknown>;
    if (Object.keys(value).length !== CURSOR_KEYS.size || Object.keys(value).some(key => !CURSOR_KEYS.has(key))
      || value.v !== 1 || value.scope !== filterScope(filters) || !validCursor(value)) return null;
    return { created_at: value.created_at as string | null, id: value.id as string };
  } catch {
    return null;
  }
}

/** Invalid filters are safe to display, but callers must not query while issues exist. */
export function parseIncidentArchiveParams(params: ArchiveSearchParams): {
  filters: ArchiveFilters; cursor: ArchiveCursor | null; issues: ArchiveParamIssue[];
} {
  const filters: ArchiveFilters = { q: "", service: "", from: "", to: "" };
  const issues: ArchiveParamIssue[] = [];
  for (const field of FILTER_KEYS) {
    const raw = params[field];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      issues.push({ field, code: "multiple" });
      continue;
    }
    if (typeof raw !== "string" || CONTROL_TEXT.test(raw)) {
      issues.push({ field, code: "invalid_text" });
      continue;
    }
    if ((field === "q" || field === "service") && raw.length > ARCHIVE_LIMITS[field]) {
      issues.push({ field, code: "too_long" });
      continue;
    }
    // Existing incident records retain service boundary spaces, so exact-service
    // links must retain them too. Whitespace-only service names mean no filter.
    const value = field === "service" && raw.trim() ? raw : raw.trim();
    if ((field === "from" || field === "to") && value && !validDate(value)) {
      issues.push({ field, code: "invalid_date" });
      continue;
    }
    filters[field] = value;
  }
  if (filters.from && filters.to && filters.from > filters.to) issues.push({ field: "to", code: "date_range" });

  const rawCursor = params.after;
  let cursor: ArchiveCursor | null = null;
  if (Array.isArray(rawCursor)) {
    issues.push({ field: "after", code: "multiple" });
  } else if (rawCursor !== undefined && rawCursor !== "") {
    if (typeof rawCursor !== "string" || CONTROL_TEXT.test(rawCursor)) {
      issues.push({ field: "after", code: "invalid_cursor" });
    } else if (rawCursor.length > ARCHIVE_LIMITS.cursor) {
      issues.push({ field: "after", code: "too_long" });
    } else if (!issues.length) {
      cursor = decodeCursor(rawCursor, filters);
      if (!cursor) issues.push({ field: "after", code: "invalid_cursor" });
    }
  }
  return { filters, cursor, issues };
}

/** UTC calendar arithmetic avoids local time and Date's special handling of years 00–99. */
export function archiveDateBounds(filters: ArchiveFilters): { from: string | null; toExclusive: string | null } {
  if ((filters.from && !validDate(filters.from)) || (filters.to && !validDate(filters.to))
    || (filters.from && filters.to && filters.from > filters.to)) throw new Error("Invalid archive date filters.");
  let toExclusive: string | null = null;
  if (filters.to) {
    let [year, month, day] = filters.to.split("-").map(Number);
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    toExclusive = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`;
  }
  return { from: filters.from ? `${filters.from}T00:00:00Z` : null, toExclusive };
}

export function encodeIncidentArchiveCursor(cursor: ArchiveCursor, filters: ArchiveFilters): string {
  if (!validCursor(cursor)) throw new Error("Invalid archive cursor.");
  return Buffer.from(JSON.stringify({ v: 1, created_at: cursor.created_at, id: cursor.id, scope: filterScope(filters) }), "utf-8").toString("base64url");
}

export function archiveHref(filters: ArchiveFilters, after?: string): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
  if (after) params.set("after", after);
  const query = params.toString();
  return query ? `/incidents?${query}` : "/incidents";
}

export function hasArchiveFilters(filters: ArchiveFilters): boolean {
  return FILTER_KEYS.some(key => Boolean(filters[key]));
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** imatch avoids PostgREST's LIKE '*' alias; this ARE contains literal user text only. */
export function buildArchiveSearchExpression(q: string): string | null {
  if (!q) return null;
  if (q.length > ARCHIVE_LIMITS.q || CONTROL_TEXT.test(q)) throw new Error("Invalid archive search text.");
  const literal = q.replace(/[.\^$*+?()[\]{}|\\]/g, "\\$&");
  const value = quoted(literal);
  return ["title", "service", "symptoms"].map(field => `${field}.imatch.${value}`).join(",");
}

/** Ordered newest-first, with undated rows last and UUIDs breaking timestamp ties. */
export function buildArchiveCursorExpression(cursor: ArchiveCursor): string {
  if (!validCursor(cursor)) throw new Error("Invalid archive cursor.");
  if (cursor.created_at === null) return `and(created_at.is.null,id.lt.${cursor.id})`;
  const timestamp = quoted(cursor.created_at);
  return `created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${cursor.id}),created_at.is.null`;
}
