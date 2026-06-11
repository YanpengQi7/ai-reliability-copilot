// One error envelope for every API route.
//
// Before this, each route hand-rolled `NextResponse.json({ error, message,
// statusCode }, { status })` — and two routes kept duplicate `jsonError`
// helpers, while /api/webhook/alert silently omitted `statusCode` from the
// body. This module is the single source of truth for the shape the frontend
// parses (see ErrorResponse in the root CLAUDE.md): { error, message,
// statusCode, nextAction? }.

import type { ZodError } from "zod";

export type ApiErrorBody = {
  error: string; // machine-readable code, e.g. "VALIDATION_ERROR"
  message: string; // human-readable, safe to surface to users
  statusCode: number;
  nextAction?: string; // optional guidance the client can act on
  requestId?: string;
};

type ApiErrorOpts = {
  nextAction?: string;
  headers?: Record<string, string>;
  requestId?: string;
};

/** Build a JSON error response with the standard envelope. */
export function apiError(
  status: number,
  code: string,
  message: string,
  opts: ApiErrorOpts = {},
): Response {
  const body: ApiErrorBody = { error: code, message, statusCode: status };
  if (opts.nextAction) body.nextAction = opts.nextAction;
  if (opts.requestId) body.requestId = opts.requestId;
  const headers = new Headers(opts.headers);
  if (opts.requestId) headers.set("x-request-id", opts.requestId);
  return Response.json(body, { status, headers });
}

/** 400 from a failed Zod parse — joins the issue messages for readability. */
export function validationError(err: ZodError): Response {
  const message = err.issues.map((i) => i.message).join("; ") || "Invalid request body";
  return apiError(400, "VALIDATION_ERROR", message);
}

/** 400 for a body that isn't valid JSON. */
export function invalidJson(): Response {
  return apiError(400, "INVALID_JSON", "Body must be JSON");
}

export async function readApiError(res: Response, fallback: string): Promise<string> {
  const requestId = res.headers.get("x-request-id");
  let message = fallback;
  try {
    const body = await res.json() as Partial<ApiErrorBody>;
    if (body.message) message = body.message;
  } catch {
    // Keep the fallback for non-JSON upstream errors.
  }
  return requestId ? `${message} (request ${requestId})` : message;
}
