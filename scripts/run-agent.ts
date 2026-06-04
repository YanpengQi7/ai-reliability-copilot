// Drive the agentic investigator from the CLI.
//
//   npm run agent                         # investigate the first scenario (LLM)
//   npm run agent -- <slug>               # investigate a specific scenario
//   npm run agent -- --all                # investigate all 5 scenarios
//   npm run agent -- --lang zh <slug>     # Chinese output
//   npm run agent -- --selftest           # NO LLM — deterministic checks of the
//                                          # control gate, budget, dup-guard
//
// The --selftest path is free and offline: it proves the boring-but-critical
// harness mechanics (read-only gate refuses writes, get_logs truncates a huge
// log, per-tool cap fires) without spending a token.

import { config } from "dotenv";
config({ path: ".env.local" });

import { SCENARIOS, getScenario, type Scenario } from "../src/lib/scenarios";
import { investigate } from "../src/lib/agent/investigate";
import { dispatchTool, type DispatchContext, LOG_BUDGET_LINES_MAX, PER_TOOL_CALL_CAP } from "../src/lib/agent/tools";
import type { OutputLanguage } from "../src/lib/prompts";
import type { TraceStep } from "../src/lib/agent/types";

function statusIcon(s: TraceStep["status"]): string {
  return { ok: "✓", empty: "∅", refused: "⛔", error: "✗" }[s] ?? "?";
}

function printTrace(trace: TraceStep[]) {
  for (const s of trace) {
    const first = s.observation.split("\n")[0];
    console.log(`  ${statusIcon(s.status)} [${s.index}] ${s.tool}(${JSON.stringify(s.input)}) — ${s.status}`);
    console.log(`      ↳ ${first.slice(0, 160)}`);
  }
}

async function runOne(scenario: Scenario, language: OutputLanguage) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`▶ ${scenario.slug}  (${language})`);
  console.log(`  alert: ${scenario.service} — ${scenario.symptoms}`);
  console.log("─".repeat(72));

  const started = Date.now();
  const r = await investigate({
    input: { service: scenario.service, symptoms: scenario.symptoms, raw_context: scenario.context, scenarioSlug: scenario.slug },
    language,
  });
  const wall = ((Date.now() - started) / 1000).toFixed(1);

  printTrace(r.trace);
  console.log("─".repeat(72));
  console.log(`  stop: ${r.stop_reason} · loop steps: ${r.steps} · model calls: ${r.usage.model_calls} · completed: ${r.completed}`);
  console.log(`  tokens: ${r.usage.tokens_in} in / ${r.usage.tokens_out} out · cost: $${r.usage.cost_usd.toFixed(5)} · wall: ${wall}s`);
  console.log(`\n  SEVERITY: ${r.analysis.severity} — ${r.analysis.severity_reasoning.slice(0, 140)}`);
  console.log(`  SUMMARY:  ${r.analysis.summary.slice(0, 220)}`);
  console.log(`  TOP ROOT CAUSE: [${r.analysis.root_causes[0].likelihood}] ${r.analysis.root_causes[0].hypothesis.slice(0, 180)}`);
  console.log(`  EXPECTED:       ${scenario.expected_root_cause.slice(0, 180)}`);

  const usedTools = new Set(r.trace.filter((s) => s.status === "ok").map((s) => s.tool));
  if (usedTools.size === 0) console.log(`  ⚠️  no successful tool calls — agent concluded without evidence`);
  return r;
}

// ── Offline, deterministic harness self-test (no LLM) ─────────────────
async function selftest() {
  console.log("=== Harness self-test (no LLM) ===\n");
  const scenario = SCENARIOS[0];
  const dctx: DispatchContext = { ctx: { service: scenario.service, symptoms: scenario.symptoms, raw_context: scenario.context, scenarioSlug: scenario.slug }, callCounts: {} };
  let pass = 0, fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (cond) pass++; else fail++;
  };

  // 1. Read-only gate refuses a write tool even though the model "asked".
  const rb = await dispatchTool(1, "execute_rollback", { service: scenario.service, to_version: "v2.40" }, dctx);
  check("control gate refuses execute_rollback", rb.status === "refused" && rb.reason === "not_read_only", rb.observation.slice(0, 60));
  const rs = await dispatchTool(2, "restart_service", { service: scenario.service }, dctx);
  check("control gate refuses restart_service", rs.status === "refused");

  // 2. Unknown tool refused.
  const unk = await dispatchTool(3, "rm_minus_rf", { path: "/" }, dctx);
  check("control gate refuses unknown tool", unk.status === "refused" && unk.reason === "unknown_tool");

  // 3. A real read-only tool works.
  const m = await dispatchTool(4, "get_metrics", { service: scenario.service }, dctx);
  check("get_metrics returns data", m.status === "ok" && m.observation.includes("active_connections"));

  // 4. get_logs BUDGET: pad a scenario to thousands of log lines, ensure the
  //    tool returns at most LOG_BUDGET_LINES_MAX and reports the true total.
  const huge: Scenario = JSON.parse(JSON.stringify(scenario));
  for (let i = 0; i < 5000; i++) huge.signals.logs.push({ ts: "14:0" + (i % 9), level: "INFO", text: `noise line ${i} connection ping ok` });
  // Register a temporary scenario lookup by monkeypatching is overkill — instead
  // call the handler against this scenario via a dctx whose ctx points at it.
  // getScenario reads the exported array, so push then pop the clone.
  (SCENARIOS as Scenario[]).push({ ...huge, slug: "__stress__" });
  const bigCtx: DispatchContext = { ctx: { service: huge.service, raw_context: "", scenarioSlug: "__stress__" }, callCounts: {} };
  const lg = await dispatchTool(5, "get_logs", { service: huge.service, query: "connection", limit: 999 }, bigCtx);
  const shownLines = lg.observation.split("\n").length - 1; // minus header line
  check("get_logs caps lines to budget under a 5k-line log", shownLines <= LOG_BUDGET_LINES_MAX, `${shownLines} lines shown`);
  check("get_logs reports the true total", /of \d{3,} line/.test(lg.observation), lg.observation.split("\n")[0].slice(0, 80));
  check("get_logs observation stays within char budget", lg.observation.length <= 2500, `${lg.observation.length} chars`);
  (SCENARIOS as Scenario[]).pop();

  // 5. Per-tool call cap fires.
  const capCtx: DispatchContext = { ctx: dctx.ctx, callCounts: {} };
  let capped = false;
  for (let i = 0; i < PER_TOOL_CALL_CAP + 2; i++) {
    const r = await dispatchTool(i, "get_metrics", { service: scenario.service, filter: `x${i}` }, capCtx);
    if (r.reason === "call_cap") capped = true;
  }
  check(`per-tool call cap fires after ${PER_TOOL_CALL_CAP} calls`, capped);

  // 6. Service mismatch is handled (empty, not crash).
  const mm = await dispatchTool(99, "get_metrics", { service: "totally-wrong-svc" }, { ctx: dctx.ctx, callCounts: {} });
  check("service mismatch returns empty (not error)", mm.status === "empty");

  console.log(`\n${fail === 0 ? "✅" : "❌"} self-test: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();

  let language: OutputLanguage = "en";
  const li = args.indexOf("--lang");
  if (li >= 0 && args[li + 1]) language = args[li + 1] as OutputLanguage;

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing in .env.local");
    process.exit(1);
  }

  if (args.includes("--all")) {
    for (const s of SCENARIOS) await runOne(s, language);
    return;
  }

  const slug = args.find((a) => !a.startsWith("--") && a !== language) ?? SCENARIOS[0].slug;
  const scenario = getScenario(slug);
  if (!scenario) {
    console.error(`No scenario "${slug}". Options: ${SCENARIOS.map((s) => s.slug).join(", ")}`);
    process.exit(1);
  }
  await runOne(scenario, language);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
