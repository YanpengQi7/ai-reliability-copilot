import "server-only";

import { hasBearerToken } from "./serverAuth";

export function isHostedDeployment(): boolean {
  return process.env.NODE_ENV === "production"
    || process.env.VERCEL_ENV === "production"
    || process.env.VERCEL_ENV === "preview";
}

export function requestCanSeeHealthDetails(req: Request): boolean {
  if (!isHostedDeployment()) return true;
  const required = process.env.HEALTHCHECK_TOKEN;
  return Boolean(required && hasBearerToken(req, required));
}
