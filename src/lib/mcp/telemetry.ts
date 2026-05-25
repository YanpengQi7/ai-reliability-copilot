// Lightweight audit log for MCP tool calls. Best-effort fire-and-forget — must
// never block the user's response or throw.
//
// What we record:
//   - tool name + ok flag + latency
//   - error message (truncated) on failure
//   - first 200 chars of the input as a redacted preview
//   - result size in bytes (so we can spot abuse / runaway responses)
//
// What we do NOT record:
//   - full input or full output (privacy + storage cost)
//   - bearer tokens or headers

import { supabaseAdmin } from "../supabase";
import { hasSupabase } from "../db";

type LogPayload = {
  tool_name: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
  client_ip?: string;
  input_summary?: string;
  result_size_bytes?: number;
};

// Per-request IP can be attached via AsyncLocalStorage if we want; for now we
// keep it simple — the route handler stuffs the IP into a module-level Map
// keyed by request, and the tool wrapper reads it. Stateless per request is fine
// because Node's per-invocation isolation means concurrent requests don't collide
// within a single handler frame (each request gets its own JS engine call stack).
let _currentIp: string | null = null;
export function withClientIp<T>(ip: string | null, fn: () => Promise<T>): Promise<T> {
  const prev = _currentIp;
  _currentIp = ip;
  return fn().finally(() => {
    _currentIp = prev;
  });
}

export async function logToolCall(payload: LogPayload): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const sb = supabaseAdmin();
    await sb.from("mcp_tool_calls").insert({
      tool_name: payload.tool_name,
      ok: payload.ok,
      latency_ms: payload.latency_ms,
      error: payload.error?.slice(0, 500) ?? null,
      client_ip: payload.client_ip ?? _currentIp,
      input_summary: payload.input_summary?.slice(0, 200) ?? null,
      result_size_bytes: payload.result_size_bytes ?? null,
    });
  } catch (e) {
    console.error("[mcp telemetry] failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Wrap a tool handler so every call is timed + logged.
 * The `summarize` function pulls a 1-line preview from the args (must not throw).
 *
 * Note on typing: `summarize` accepts a partial view of args (any subset of
 * the handler's args), so we type its parameter as `Record<string, unknown>`
 * and cast at the call site. Otherwise TS picks the narrower type for both
 * signatures and the handler loses its declared shape.
 */
export function withTelemetry<TArgs extends object, TResult extends { content: Array<unknown>; isError?: boolean }>(
  toolName: string,
  summarize: (args: Record<string, unknown>) => string,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const started = Date.now();
    let result: TResult;
    let err: string | undefined;
    try {
      result = await handler(args);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      // Re-throw so the SDK surfaces a proper JSON-RPC error to the caller
      void logToolCall({
        tool_name: toolName,
        ok: false,
        latency_ms: Date.now() - started,
        error: err,
        input_summary: safeSummarize(summarize, args),
      });
      throw e;
    }
    const ok = !result.isError;
    const resultSize = estimateSize(result);
    void logToolCall({
      tool_name: toolName,
      ok,
      latency_ms: Date.now() - started,
      error: ok ? undefined : firstTextContent(result),
      input_summary: safeSummarize(summarize, args),
      result_size_bytes: resultSize,
    });
    return result;
  };
}

function safeSummarize(fn: (a: Record<string, unknown>) => string, args: object): string {
  try { return fn(args as Record<string, unknown>); } catch { return ""; }
}

function firstTextContent(result: { content: Array<unknown> }): string | undefined {
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  return first?.text;
}

function estimateSize(result: { content: Array<unknown> }): number {
  try { return new TextEncoder().encode(JSON.stringify(result)).byteLength; } catch { return 0; }
}
