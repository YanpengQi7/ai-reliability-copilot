import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase } from "./db";
import { supabaseAdmin } from "./supabase";
import { isIncidentId } from "./identifiers";
import {
  ARCHIVE_PAGE_SIZE,
  archiveDateBounds,
  buildArchiveCursorExpression,
  buildArchiveSearchExpression,
  encodeIncidentArchiveCursor,
  type ArchiveCursor,
  type ArchiveFilters,
} from "./incidentArchive";

export type IncidentArchiveRow = {
  id: string;
  title: string | null;
  service: string | null;
  symptoms: string | null;
  created_at: string | null;
};

export type IncidentArchivePage = { incidents: IncidentArchiveRow[]; nextCursor: string | null };

const LIST_COLUMNS = "id,title,service,symptoms,created_at";

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function projectIncident(value: unknown): IncidentArchiveRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid incident archive row");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !isIncidentId(row.id)) {
    throw new Error("Invalid incident archive identifier");
  }
  return {
    id: row.id,
    title: nullableText(row.title),
    service: nullableText(row.service),
    symptoms: nullableText(row.symptoms),
    created_at: nullableText(row.created_at),
  };
}

/** One bounded database page. Access control belongs to the calling route. */
export async function listIncidentArchivePage(
  filters: ArchiveFilters,
  cursor: ArchiveCursor | null,
  options: { abortSignal?: AbortSignal; client?: SupabaseClient } = {},
): Promise<IncidentArchivePage> {
  options.abortSignal?.throwIfAborted();
  if (!options.client && !hasSupabase()) return { incidents: [], nextCursor: null };
  const client = options.client ?? supabaseAdmin();
  const query = client.from("incidents").select(LIST_COLUMNS)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(ARCHIVE_PAGE_SIZE + 1);

  const search = buildArchiveSearchExpression(filters.q);
  if (search) query.or(search);
  if (filters.service) query.eq("service", filters.service);
  const dates = archiveDateBounds(filters);
  if (dates.from) query.gte("created_at", dates.from);
  if (dates.toExclusive) query.lt("created_at", dates.toExclusive);
  // Repeated `or` groups are ANDed by PostgREST: search and pagination both apply.
  if (cursor) query.or(buildArchiveCursorExpression(cursor));
  if (options.abortSignal) query.abortSignal(options.abortSignal);

  const { data, error } = await query;
  options.abortSignal?.throwIfAborted();
  if (error) throw error;
  if (data !== null && !Array.isArray(data)) throw new Error("Invalid incident archive response");
  const page = (data ?? []).slice(0, ARCHIVE_PAGE_SIZE).map(projectIncident);
  const last = page.at(-1);
  return {
    incidents: page,
    nextCursor: last && (data?.length ?? 0) > ARCHIVE_PAGE_SIZE
      ? encodeIncidentArchiveCursor({ created_at: last.created_at, id: last.id }, filters)
      : null,
  };
}
