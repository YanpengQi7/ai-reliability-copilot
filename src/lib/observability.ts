type LogLevel = "info" | "warn" | "error";

function safeRequestId(value: string | null): string | null {
  if (!value || value.length > 100) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

export function createRequestContext(req: Request, operation: string) {
  const requestId = safeRequestId(req.headers.get("x-request-id")) ?? crypto.randomUUID();
  const startedAt = Date.now();
  const method = req.method;
  const path = new URL(req.url).pathname;

  function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    const entry = JSON.stringify({
      ...fields,
      level,
      event,
      operation,
      request_id: requestId,
      method,
      path,
      duration_ms: Date.now() - startedAt,
    });
    if (level === "error") console.error(entry);
    else if (level === "warn") console.warn(entry);
    else console.log(entry);
  }

  return {
    requestId,
    log,
    response(response: Response, fields: Record<string, unknown> = {}) {
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      log(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "api_request", {
        status: response.status,
        ...fields,
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
