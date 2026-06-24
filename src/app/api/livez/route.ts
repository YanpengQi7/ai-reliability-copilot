import { NextResponse } from "next/server";
import { createRequestContext } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dependency-free liveness probe for platform health checks. */
export async function GET(req: Request) {
  const ctx = createRequestContext(req, "livez");
  return ctx.response(NextResponse.json({
    status: "ok",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    ts: new Date().toISOString(),
  }), { healthy: true });
}
