// Before/after eval: SINGLE-SHOT baseline vs AGENTIC investigator.
//
//   npm run evals:agentic                 # full matrix (5 scenarios × 2 modes × 2 langs × REPEATS)
//   EVAL_REPEATS=3 npm run evals:agentic  # more repeats, tighter error bars
//   npm run evals:agentic -- --quick      # smoke: 1 scenario, en, 1 rep
//   npm run evals:agentic -- --en         # English only
//
// Methodology (continues notes/eval-run-3.md): n repeats per cell, report
// mean ± std, and call a gap "stands out" only when |Δmean| > pooled std.
//
// What's held constant so the comparison is honest: same model, same judge,
// same temperature, same scenarios, same core 5-dim rubric + ground truth.
// What changes: single-shot gets the whole incident blob in ONE prompt (with
// RAG-injected KB, exactly like /api/analyze); agentic gets only the alert and
// must DISCOVER evidence via read-only tools. `overall` = mean of the core 5
// dims for BOTH (comparable). `evidence_grounding` is scored for the agentic
// arm ONLY (the baseline has no trace) and reported separately.
//
// No Supabase required — results print to stdout and write to notes/eval-agentic-latest.json.

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { generateObject } from "ai";
import { SCENARIOS, type Scenario } from "../src/lib/scenarios";
import { AnalysisSchema, type Analysis } from "../src/lib/schema";
import { deepseek, ANALYSIS_MODEL } from "../src/lib/ai";
import { getSystemPrompt, buildUserPrompt, DEFAULT_PROMPT_VERSION, type OutputLanguage } from "../src/lib/prompts";
import { retrieveContext, formatChunksForPrompt } from "../src/lib/kb";
import { judge, judgeWithGrounding } from "../src/lib/eval/judge";
import { overallScore, type RubricDim } from "../src/lib/eval/rubric";
import { calcCost, normalizeUsage } from "../src/lib/cost";
import { investigate, evidenceTranscript } from "../src/lib/agent/investigate";

type Mode = "single" | "agentic";
const CORE_DIMS: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];

type Row = {
  mode: Mode;
  scenario: string;
  language: OutputLanguage;
  overall: number;
  dims: Record<RubricDim, number>;
  grounding?: number; // agentic only
  severity_correct: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  model_calls: number;
  tool_calls: number; // agentic only
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const fmtMS = (xs: number[]) => (xs.length ? `${mean(xs).toFixed(2)}±${std(xs).toFixed(2)}` : "—");

// ── Single-shot baseline: one generateObject call, RAG-injected (== /api/analyze) ──
async function runSingle(scenario: Scenario, language: OutputLanguage): Promise<{ analysis: Analysis; tokens_in: number; tokens_out: number; cost_usd: number }> {
  const queryText = [scenario.title, scenario.service, scenario.symptoms, scenario.context].filter(Boolean).join(" ").slice(0, 4000);
  const retrieved = await retrieveContext(queryText, { limit: 5 });
  const internal_context = formatChunksForPrompt(retrieved.chunks);
  const attempt = () =>
    generateObject({
      model: deepseek(ANALYSIS_MODEL),
      schema: AnalysisSchema,
      system: getSystemPrompt(DEFAULT_PROMPT_VERSION),
      prompt: buildUserPrompt({ service: scenario.service, symptoms: scenario.symptoms, raw_context: scenario.context, language, internal_context }),
      temperature: 0.2,
    });
  let r;
  try {
    r = await attempt();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/parse|invalid json|schema|JSON/i.test(msg)) throw err;
    r = await attempt();
  }
  const { tokens_in, tokens_out } = normalizeUsage(r.usage);
  return { analysis: r.object, tokens_in, tokens_out, cost_usd: calcCost(ANALYSIS_MODEL, tokens_in, tokens_out) ?? 0 };
}

async function scoreRow(
  mode: Mode,
  scenario: Scenario,
  language: OutputLanguage,
): Promise<Row> {
  const gt = { title: scenario.title, context: scenario.context, expected_severity: scenario.expected_severity, expected_root_cause: scenario.expected_root_cause };

  if (mode === "single") {
    const s = await runSingle(scenario, language);
    const scores = await judge({ analysis: s.analysis, scenario: gt });
    return {
      mode, scenario: scenario.slug, language,
      overall: overallScore(scores),
      dims: Object.fromEntries(CORE_DIMS.map((d) => [d, scores[d].score])) as Record<RubricDim, number>,
      severity_correct: s.analysis.severity === scenario.expected_severity,
      tokens_in: s.tokens_in, tokens_out: s.tokens_out, cost_usd: s.cost_usd, model_calls: 1, tool_calls: 0,
    };
  }

  // agentic
  const r = await investigate({
    input: { service: scenario.service, symptoms: scenario.symptoms, raw_context: scenario.context, scenarioSlug: scenario.slug },
    language,
  });
  const trace = evidenceTranscript(r.trace);
  const scores = await judgeWithGrounding({ analysis: r.analysis, scenario: gt, trace });
  return {
    mode, scenario: scenario.slug, language,
    overall: overallScore(scores),
    dims: Object.fromEntries(CORE_DIMS.map((d) => [d, scores[d].score])) as Record<RubricDim, number>,
    grounding: scores.evidence_grounding.score,
    severity_correct: r.analysis.severity === scenario.expected_severity,
    tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out, cost_usd: r.usage.cost_usd,
    model_calls: r.usage.model_calls, tool_calls: r.trace.filter((s) => s.status === "ok").length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes("--quick");
  const languages: OutputLanguage[] = args.includes("--en") || quick ? ["en"] : ["en", "zh"];
  const scenarios = quick ? SCENARIOS.slice(0, 1) : SCENARIOS;
  const repeats = quick ? 1 : Math.max(1, parseInt(process.env.EVAL_REPEATS ?? "2", 10));
  const modes: Mode[] = ["single", "agentic"];

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing in .env.local");
    process.exit(1);
  }

  console.log(`Matrix: ${scenarios.length} scenario(s) × ${modes.length} modes × ${languages.length} lang × ${repeats} rep = ${scenarios.length * modes.length * languages.length * repeats} runs\n`);

  const rows: Row[] = [];
  for (const scenario of scenarios) {
    for (const mode of modes) {
      for (const language of languages) {
        for (let rep = 0; rep < repeats; rep++) {
          process.stdout.write(`→ ${mode.padEnd(7)} ${scenario.slug.padEnd(30)} ${language} ${rep + 1}/${repeats} `);
          try {
            const row = await scoreRow(mode, scenario, language);
            rows.push(row);
            console.log(`overall ${row.overall.toFixed(2)}${row.grounding != null ? ` ground ${row.grounding}` : ""} sev${row.severity_correct ? "✓" : "✗"} $${row.cost_usd.toFixed(4)} ${row.tool_calls ? `${row.tool_calls}tools` : ""}`);
          } catch (err) {
            console.log(`✗ ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
          }
        }
      }
    }
  }

  // ── Report ──────────────────────────────────────────────────────────
  const of = (f: (r: Row) => boolean) => rows.filter(f);
  const overalls = (f: (r: Row) => boolean) => of(f).map((r) => r.overall);

  console.log(`\n${"═".repeat(60)}\nRESULTS (mean ± std over ${repeats} repeat(s))\n${"═".repeat(60)}`);

  console.log(`\n## Overall (mean of core 5 dims) by mode`);
  for (const m of modes) console.log(`  ${m.padEnd(8)} ${fmtMS(overalls((r) => r.mode === m))}  (n=${overalls((r) => r.mode === m).length})`);

  console.log(`\n## Overall by mode × language`);
  for (const m of modes) for (const l of languages) console.log(`  ${m.padEnd(8)} ${l}  ${fmtMS(overalls((r) => r.mode === m && r.language === l))}`);

  console.log(`\n## Per-dimension (mean ± std) — single vs agentic`);
  console.log(`  ${"dimension".padEnd(20)} ${"single".padStart(12)} ${"agentic".padStart(12)}  verdict`);
  for (const d of CORE_DIMS) {
    const sx = of((r) => r.mode === "single").map((r) => r.dims[d]);
    const ax = of((r) => r.mode === "agentic").map((r) => r.dims[d]);
    const delta = mean(ax) - mean(sx);
    const pooled = Math.sqrt((std(sx) ** 2 + std(ax) ** 2) / 2);
    const verdict = Math.abs(delta) > pooled ? (delta > 0 ? "agentic ↑" : "single ↑") : "inside noise";
    console.log(`  ${d.padEnd(20)} ${fmtMS(sx).padStart(12)} ${fmtMS(ax).padStart(12)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} → ${verdict}`);
  }

  console.log(`\n## Evidence grounding (agentic only — baseline has no trace)`);
  const g = of((r) => r.mode === "agentic" && r.grounding != null).map((r) => r.grounding!);
  console.log(`  ${fmtMS(g)}  (n=${g.length})`);

  console.log(`\n## Severity accuracy by mode`);
  for (const m of modes) {
    const xs = of((r) => r.mode === m);
    const correct = xs.filter((r) => r.severity_correct).length;
    console.log(`  ${m.padEnd(8)} ${correct}/${xs.length} (${((correct / xs.length) * 100).toFixed(0)}%)`);
  }

  console.log(`\n## Cost & calls by mode (mean per run)`);
  for (const m of modes) {
    const xs = of((r) => r.mode === m);
    const avgCost = mean(xs.map((r) => r.cost_usd));
    const avgCalls = mean(xs.map((r) => r.model_calls));
    const avgTokIn = mean(xs.map((r) => r.tokens_in));
    const avgTokOut = mean(xs.map((r) => r.tokens_out));
    console.log(`  ${m.padEnd(8)} $${avgCost.toFixed(5)}/run · ${avgCalls.toFixed(1)} model calls · ${avgTokIn.toFixed(0)} tok in / ${avgTokOut.toFixed(0)} out`);
  }

  // Headline: did agentic buy quality, and at what cost multiple?
  const so = overalls((r) => r.mode === "single");
  const ao = overalls((r) => r.mode === "agentic");
  const dOverall = mean(ao) - mean(so);
  const pooled = Math.sqrt((std(so) ** 2 + std(ao) ** 2) / 2);
  const costMult = mean(of((r) => r.mode === "agentic").map((r) => r.cost_usd)) / mean(of((r) => r.mode === "single").map((r) => r.cost_usd));
  console.log(`\n## Headline`);
  console.log(`  overall Δ (agentic − single): ${dOverall >= 0 ? "+" : ""}${dOverall.toFixed(3)} (pooled std ${pooled.toFixed(3)} → ${Math.abs(dOverall) > pooled ? "stands out" : "inside noise"})`);
  console.log(`  agentic costs ${costMult.toFixed(1)}× the single-shot baseline`);

  const out = `notes/eval-agentic-latest.json`;
  writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), repeats, rows }, null, 2));
  console.log(`\nRaw rows written to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
