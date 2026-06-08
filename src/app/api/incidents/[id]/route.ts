// GET /api/incidents/[id] — JSON view of an incident + its latest analysis.
//
// Used by the `sre` CLI to poll for analysis completion after a webhook submit.
// Browser UI continues to use the RSC page at /incidents/[id].
//
// Response shape:
//   200 { incident, analysis: AnalysisRow | null, url: string }
//   404 { error: "NOT_FOUND", ... }
//   503 { error: "DB_UNCONFIGURED", ... }

import { NextResponse } from "next/server";
import { hasSupabase, getIncidentWithAnalyses } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return apiError(503, "DB_UNCONFIGURED", "Supabase not configured");
  }
  const result = await getIncidentWithAnalyses(id);
  if (!result) {
    return apiError(404, "NOT_FOUND", "incident not found");
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    incident: result.incident,
    analysis: result.analyses[0] ?? null,
    url: `${base}/incidents/${id}`,
  });
}
