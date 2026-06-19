import "server-only";

import { bearerToken, secureTokenEqual } from "@/lib/serverAuth";

function isHostedDeployment(): boolean {
  return process.env.NODE_ENV === "production"
    || process.env.VERCEL_ENV === "production"
    || process.env.VERCEL_ENV === "preview";
}

/**
 * Persisted incident data is private by default on hosted deployments.
 * Local development remains open so the project is easy to run.
 */
export function publicIncidentDataEnabled(): boolean {
  return !isHostedDeployment() || process.env.ALLOW_PUBLIC_INCIDENT_DATA === "true";
}

function configuredAccessToken(): string | undefined {
  return process.env.INCIDENT_ACCESS_TOKEN || process.env.WEBHOOK_SECRET;
}

/** Machine clients may access private incident data with a dedicated token. */
export function requestHasIncidentDataAccess(req: Request): boolean {
  if (publicIncidentDataEnabled()) return true;
  const required = configuredAccessToken();
  if (!required) return false;
  const supplied = bearerToken(req) ?? req.headers.get("x-incident-access-token");
  return secureTokenEqual(supplied, required);
}
