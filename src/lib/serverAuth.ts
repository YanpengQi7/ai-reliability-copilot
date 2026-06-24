import "server-only";

import { timingSafeEqual } from "node:crypto";

export function secureTokenEqual(supplied: string | null | undefined, required: string): boolean {
  if (!supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(required);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export function hasBearerToken(req: Request, required: string): boolean {
  return secureTokenEqual(bearerToken(req), required);
}
