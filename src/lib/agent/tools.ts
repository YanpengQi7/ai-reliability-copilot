// Investigation tools + the control gate + the context budget.
//
// These are the READ-ONLY tools the agent calls inside the loop to discover
// evidence one slice at a time. Three design rules from the roadmap live here:
//
//   1. Tools return a SLICE, never the whole blob. get_logs in particular
//      truncates to a budget (last N lines + total count) so a service with
//      thousands of log lines can't blow the context window.
//   2. The control gate is enforced at the DISPATCH layer, not in the prompt.
//      Only whitelisted read-only tools run; anything with write/delete
//      semantics is refused even if the model asks for it. To prove the gate
//      actually stops something, we deliberately EXPOSE a tempting write tool
//      (execute_rollback) and let the gate reject it.
//   3. Per-tool call caps stop the agent from hammering one tool in a loop.

import { z } from "zod";
import { tool, type Tool } from "ai";
import { getScenario, type Scenario, type LogLine } from "@/lib/scenarios";
import { retrieveContext } from "@/lib/kb";
import { safeErrorDetail } from "@/lib/observability";
import type { InvestigationInput, TraceStep } from "./types";

// ── Budget constants ─────────────────────────────────────────────────
export const LOG_BUDGET_LINES_DEFAULT = 12;
export const LOG_BUDGET_LINES_MAX = 30;
// Hard cap on the characters of any single observation handed back to the model.
// Protects the window even if a handler misbehaves. ~4 chars/token heuristic.
export const MAX_OBSERVATION_CHARS = 2400;
// How many times the agent may call any single tool before the gate refuses.
export const PER_TOOL_CALL_CAP = 4;

// ── Tool specs ───────────────────────────────────────────────────────
// `allowed: false` tools are still shown to the model (tempting), but the
// control gate refuses to dispatch them. This is how we make "read-only" a
// runtime mechanism rather than a prompt request.
type ToolSpec = {
  description: string;
  inputSchema: z.ZodTypeAny;
  allowed: boolean;
};

export const TOOL_SPECS = {
  get_metrics: {
    allowed: true,
    description:
      "Read current metrics for a service in this incident (latency, error rate, CPU, connections, etc.). Returns a snapshot of observed values vs baseline. Pass the affected service name. Optional `filter` narrows to metric names containing a substring (e.g. 'latency', 'cpu', 'connection').",
    inputSchema: z.object({
      service: z.string().describe("Service to read metrics for, e.g. 'payment-svc'"),
      filter: z.string().optional().describe("Optional substring to narrow which metrics are returned"),
    }),
  },
  get_logs: {
    allowed: true,
    description:
      "Read recent log lines for a service. Returns only the most recent N lines plus the total count (logs are truncated to protect context — narrow with `query` to find what you need). Pass an optional `query` substring (e.g. 'OOM', 'connection', 'timeout') and an optional `limit`.",
    inputSchema: z.object({
      service: z.string().describe("Service to read logs for"),
      query: z.string().optional().describe("Case-insensitive substring filter over log text/level"),
      limit: z.number().int().min(1).max(LOG_BUDGET_LINES_MAX).optional().describe(`Max lines to return (default ${LOG_BUDGET_LINES_DEFAULT}, hard max ${LOG_BUDGET_LINES_MAX})`),
    }),
  },
  get_deploy_history: {
    allowed: true,
    description:
      "Read recent deploys, config changes, and infra changes for a service. Use this to correlate the incident start time with a change. Pass the affected service name.",
    inputSchema: z.object({
      service: z.string().describe("Service to read deploy/change history for"),
    }),
  },
  search_runbooks: {
    allowed: true,
    description:
      "Search the internal knowledge base (runbooks, postmortems, service catalog, architecture docs) for relevant guidance. Free-text query — combine service name + symptom, e.g. 'catalog-svc cache stampede mitigation'.",
    inputSchema: z.object({
      query: z.string().describe("Free-text query"),
      limit: z.number().int().min(1).max(8).optional().describe("Max chunks (default 4)"),
    }),
  },
  // ── Deliberately NOT allowed. Present so the control gate has something
  //    real to refuse. A read-only investigator must never take write actions. ──
  execute_rollback: {
    allowed: false,
    description:
      "Roll back a service to its previous deploy. (Write action.)",
    inputSchema: z.object({
      service: z.string(),
      to_version: z.string().optional(),
    }),
  },
  restart_service: {
    allowed: false,
    description: "Restart a service's pods. (Write action.)",
    inputSchema: z.object({ service: z.string() }),
  },
} satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOL_SPECS;

export const ALLOWED_TOOLS = (Object.keys(TOOL_SPECS) as ToolName[]).filter(
  (n) => TOOL_SPECS[n].allowed,
);

// Build the AI SDK `tools` object handed to generateText. Crucially these have
// NO `execute` — generateText returns the tool calls and STOPS. We run them
// ourselves in the loop. That is what keeps the loop hand-written.
export function buildToolDefs(): Record<string, Tool> {
  const defs: Record<string, Tool> = {};
  for (const name of Object.keys(TOOL_SPECS) as ToolName[]) {
    const spec = TOOL_SPECS[name];
    defs[name] = tool({
      description: spec.description,
      // Cast: iterating heterogeneous Zod object schemas collapses the union to
      // `never` for `tool()`'s inferred input type. The schema is only used to
      // describe the tool to the model; we validate/read the raw input in dispatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: spec.inputSchema as any,
      // no execute → no auto-run, no SDK loop
    });
  }
  return defs;
}

// ── Handlers (read-only) ─────────────────────────────────────────────

function clampObservation(text: string): string {
  if (text.length <= MAX_OBSERVATION_CHARS) return text;
  return text.slice(0, MAX_OBSERVATION_CHARS) + `\n… [truncated to ${MAX_OBSERVATION_CHARS} chars to protect context]`;
}

function fmtLog(l: LogLine): string {
  const ts = l.ts ? `${l.ts} ` : "";
  const lvl = l.level ? `${l.level} ` : "";
  return `${ts}${lvl}${l.text}`.trim();
}

function serviceMismatch(scenario: Scenario, asked?: string): string | null {
  if (!asked) return null;
  if (asked.toLowerCase() === scenario.service.toLowerCase()) return null;
  // Be lenient on substring matches (model may pass 'payment' for 'payment-svc').
  if (
    scenario.service.toLowerCase().includes(asked.toLowerCase()) ||
    asked.toLowerCase().includes(scenario.service.toLowerCase())
  )
    return null;
  return `No telemetry for service "${asked}" in this incident. The affected service is "${scenario.service}". Re-query with that name.`;
}

type HandlerOut = { status: TraceStep["status"]; text: string };

async function runHandler(
  name: ToolName,
  input: Record<string, unknown>,
  ctx: InvestigationInput,
): Promise<HandlerOut> {
  const scenario = ctx.scenarioSlug ? getScenario(ctx.scenarioSlug) : undefined;

  switch (name) {
    case "search_runbooks": {
      const query = String(input.query ?? "");
      const limit = typeof input.limit === "number" ? input.limit : 4;
      const r = await retrieveContext(query, { limit });
      if (r.chunks.length === 0)
        return { status: "empty", text: `No KB chunks matched (mode=${r.mode}). The runbook KB may be empty for this query.` };
      const body = r.chunks
        .map((c, i) => `[${i + 1}] ${c.document_title ?? c.source_path} (${c.document_kind}) · ${(c.similarity * 100).toFixed(0)}%\n${c.text}`)
        .join("\n\n---\n\n");
      return { status: "ok", text: `KB search (mode=${r.mode}) — ${r.chunks.length} hit(s)\n\n${body}` };
    }

    case "get_metrics": {
      if (!scenario)
        return { status: "empty", text: "No structured metrics available for this incident; rely on the raw context provided in the task." };
      const mm = serviceMismatch(scenario, input.service as string | undefined);
      if (mm) return { status: "empty", text: mm };
      const filter = (input.filter as string | undefined)?.toLowerCase();
      let metrics = scenario.signals.metrics;
      if (filter) metrics = metrics.filter((m) => m.name.toLowerCase().includes(filter) || (m.note ?? "").toLowerCase().includes(filter));
      if (metrics.length === 0)
        return { status: "empty", text: `No metrics matched filter "${input.filter}" for ${scenario.service}. Try without a filter to see all ${scenario.signals.metrics.length} metrics.` };
      const body = metrics
        .map((m) => `- ${m.name}: ${m.value}${m.baseline ? ` (baseline ${m.baseline})` : ""}${m.note ? ` — ${m.note}` : ""}`)
        .join("\n");
      return { status: "ok", text: `Metrics for ${scenario.service} (${metrics.length}${filter ? ` matching "${input.filter}"` : ""}):\n${body}` };
    }

    case "get_logs": {
      if (!scenario)
        return { status: "empty", text: "No structured logs available for this incident; rely on the raw context provided in the task." };
      const mm = serviceMismatch(scenario, input.service as string | undefined);
      if (mm) return { status: "empty", text: mm };
      const query = (input.query as string | undefined)?.toLowerCase();
      let lines = scenario.signals.logs;
      if (query) lines = lines.filter((l) => fmtLog(l).toLowerCase().includes(query));
      const total = lines.length;
      if (total === 0)
        return { status: "empty", text: `No log lines matched query "${input.query}" for ${scenario.service}.` };
      const rawLimit = typeof input.limit === "number" ? input.limit : LOG_BUDGET_LINES_DEFAULT;
      const limit = Math.min(Math.max(1, rawLimit), LOG_BUDGET_LINES_MAX);
      // BUDGET: return only the most recent `limit` lines, but always report the total.
      const shown = lines.slice(-limit);
      const omitted = total - shown.length;
      const header = `Logs for ${scenario.service}${query ? ` matching "${input.query}"` : ""}: showing ${shown.length} of ${total} line(s)${omitted > 0 ? ` (${omitted} older line(s) omitted by budget — narrow with \`query\` to see them)` : ""}.`;
      return { status: "ok", text: `${header}\n${shown.map(fmtLog).join("\n")}` };
    }

    case "get_deploy_history": {
      if (!scenario)
        return { status: "empty", text: "No structured deploy history available for this incident; rely on the raw context provided in the task." };
      const mm = serviceMismatch(scenario, input.service as string | undefined);
      if (mm) return { status: "empty", text: mm };
      const body = scenario.signals.deploys.map((d) => `- ${d.ts}: ${d.change}`).join("\n");
      return { status: "ok", text: `Recent changes for ${scenario.service}:\n${body}` };
    }

    // Write tools never reach here (gate refuses first), but guard anyway.
    case "execute_rollback":
    case "restart_service":
      return { status: "refused", text: "Write action refused by control gate." };

    default:
      return { status: "error", text: `Unknown tool "${name}".` };
  }
}

// ── The control gate + dispatch ──────────────────────────────────────
// Single entry point the loop calls. Enforces: (1) tool exists, (2) tool is on
// the read-only whitelist, (3) per-tool call cap not exceeded. Only then runs
// the handler. Returns a fully-formed TraceStep.
export type DispatchContext = {
  ctx: InvestigationInput;
  callCounts: Record<string, number>;
};

export async function dispatchTool(
  index: number,
  toolName: string,
  input: Record<string, unknown>,
  dctx: DispatchContext,
): Promise<TraceStep> {
  const started = Date.now();
  const base = { index, tool: toolName, input };

  // Gate 1: unknown tool.
  if (!(toolName in TOOL_SPECS)) {
    return { ...base, status: "refused", observation: `Tool "${toolName}" does not exist.`, reason: "unknown_tool", latency_ms: Date.now() - started };
  }
  // Gate 2: read-only whitelist. This is the line that makes the agent safe.
  if (!TOOL_SPECS[toolName as ToolName].allowed) {
    return {
      ...base,
      status: "refused",
      observation: `REFUSED: "${toolName}" is a write/mutating action. This investigator is strictly read-only — it diagnoses and recommends, it does not change production. Recommend this action in the mitigation_plan instead.`,
      reason: "not_read_only",
      latency_ms: Date.now() - started,
    };
  }
  // Gate 3: per-tool call cap.
  const count = (dctx.callCounts[toolName] ?? 0) + 1;
  dctx.callCounts[toolName] = count;
  if (count > PER_TOOL_CALL_CAP) {
    return {
      ...base,
      status: "refused",
      observation: `REFUSED: "${toolName}" called ${count} times (cap ${PER_TOOL_CALL_CAP}). You already have this evidence — stop re-querying and move toward a conclusion.`,
      reason: "call_cap",
      latency_ms: Date.now() - started,
    };
  }

  // Recovery: a handler throwing must not crash the loop.
  try {
    const out = await runHandler(toolName as ToolName, input, dctx.ctx);
    return { ...base, status: out.status, observation: clampObservation(out.text), latency_ms: Date.now() - started };
  } catch (err) {
    const msg = safeErrorDetail(err);
    return { ...base, status: "error", observation: `Tool "${toolName}" failed: ${msg}. Continue with other evidence.`, reason: "handler_threw", latency_ms: Date.now() - started };
  }
}
