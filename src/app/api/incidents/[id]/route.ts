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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "DB_UNCONFIGURED", message: "Supabase not configured", statusCode: 503 },
      { status: 503 },
    );
  }
  const result = await getIncidentWithAnalyses(id);
  if (!result) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "incident not found", statusCode: 404 },
      { status: 404 },
    );
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    incident: result.incident,
    analysis: result.analyses[0] ?? null,
    url: `${base}/incidents/${id}`,
  });
}
