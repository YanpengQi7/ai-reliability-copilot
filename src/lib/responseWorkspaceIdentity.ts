import "server-only";

import { createHash } from "node:crypto";
import { normalizeAnalysisContent } from "./analysisReview";

/** A saved run and its exact contents own their progress; reruns start fresh. */
export function savedResponseWorkspaceId(incidentId: string, analysis: unknown): string {
  const source = JSON.stringify({ incidentId, analysis: normalizeAnalysisContent(analysis) });
  return `saved:${createHash("sha256").update(source).digest("hex")}`;
}
