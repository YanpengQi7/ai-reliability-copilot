// Human-vs-judge calibration tool.
//
// Pulls N recent analyses + their judge scores from Supabase, presents each
// analysis to the user one dimension at a time, collects 1–5 human scores,
// then computes per-dimension and overall Spearman rank correlation between
// human and judge. Writes the raw pairs + summary to a markdown file under
// notes/ for inclusion in EVALUATION.md.
//
// Run: npm run evals:calibrate -- [--n=10] [--out=notes/human-vs-judge-1.md]

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync } from "node:fs";
import { RUBRIC_DEFINITIONS, type RubricDim } from "../src/lib/eval/rubric";

const DIMS: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];

type Args = { n: number; out: string };
function parseArgs(): Args {
  const args: Args = { n: 10, out: `notes/human-vs-judge-${new Date().toISOString().slice(0, 10)}.md` };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "n" && v) args.n = parseInt(v, 10);
    if (k === "out" && v) args.out = v;
  }
  return args;
}

// Spearman = Pearson on ranks. Handles ties via average ranks.
function rank(xs: number[]): number[] {
  const sorted = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-based, averaged for ties
    for (let k = i; k <= j; k++) ranks[sorted[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? NaN : num / denom;
}
function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys));
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "n/a";
}

function previewAnalysis(a: {
  summary: string | null;
  severity: string | null;
  root_causes: unknown;
  investigation_checklist: unknown;
  mitigation_plan: unknown;
  postmortem_draft: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`SEVERITY: ${a.severity ?? "?"}`);
  lines.push(`SUMMARY: ${a.summary ?? "(empty)"}`);
  lines.push("");
  lines.push("ROOT CAUSES:");
  for (const rc of (Array.isArray(a.root_causes) ? a.root_causes : []) as Array<Record<string, unknown>>) {
    lines.push(`  [${rc.likelihood ?? "?"}] ${rc.hypothesis ?? ""}`);
    if (rc.evidence) lines.push(`        evidence: ${String(rc.evidence).slice(0, 200)}`);
  }
  lines.push("");
  lines.push("INVESTIGATION CHECKLIST:");
  for (const s of (Array.isArray(a.investigation_checklist) ? a.investigation_checklist : []) as Array<Record<string, unknown>>) {
    lines.push(`  - ${s.step ?? ""}`);
    if (s.command) lines.push(`    $ ${String(s.command).slice(0, 200)}`);
  }
  lines.push("");
  lines.push("MITIGATION PLAN:");
  for (const m of (Array.isArray(a.mitigation_plan) ? a.mitigation_plan : []) as Array<Record<string, unknown>>) {
    lines.push(`  - action:   ${m.action ?? ""}`);
    if (m.risk) lines.push(`    risk:     ${m.risk}`);
    if (m.rollback) lines.push(`    rollback: ${m.rollback}`);
  }
  lines.push("");
  lines.push(`POSTMORTEM (first 400 chars): ${(a.postmortem_draft ?? "").slice(0, 400)}`);
  return lines.join("\n");
}

async function main() {
  const { n, out } = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Pull most-recent analyses that have an evaluation.
  const { data: evals, error } = await sb
    .from("evaluations")
    .select("id, analysis_id, scores, overall, created_at")
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) { console.error(error); process.exit(1); }
  if (!evals?.length) { console.error("No evaluations found. Run `npm run evals:run` first."); process.exit(1); }

  const analysisIds = evals.map((e) => e.analysis_id);
  const { data: analyses, error: aerr } = await sb
    .from("analyses")
    .select("id, prompt_version, output_language, summary, severity, root_causes, investigation_checklist, mitigation_plan, postmortem_draft")
    .in("id", analysisIds);
  if (aerr) { console.error(aerr); process.exit(1); }
  const byId = new Map(analyses!.map((a) => [a.id, a]));

  const rl = createInterface({ input, output });
  async function ask(q: string): Promise<string> { return (await rl.question(q)).trim(); }
  async function askScore(label: string, anchors: Record<1 | 3 | 5, string>): Promise<number | null> {
    console.log(`\n  ${label}`);
    console.log(`    1: ${anchors[1]}`);
    console.log(`    3: ${anchors[3]}`);
    console.log(`    5: ${anchors[5]}`);
    for (;;) {
      const v = await ask(`    Your score (1–5, "s" to skip this analysis, "q" to quit): `);
      if (v === "q") return -1;
      if (v === "s") return null;
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 5) return n;
      console.log("    invalid, try again");
    }
  }

  // Collect human scores per (analysis × dim).
  const pairs: Array<{ analysis_id: string; prompt_version: string | null; dim: RubricDim; human: number; judge: number }> = [];
  console.log(`\nLoaded ${evals.length} evaluations. Scoring without seeing judge results first.\n`);

  outer: for (let i = 0; i < evals.length; i++) {
    const ev = evals[i];
    const a = byId.get(ev.analysis_id);
    if (!a) continue;
    console.log(`\n=========================================================`);
    console.log(`[${i + 1}/${evals.length}] analysis ${a.id} · prompt ${a.prompt_version} · lang ${a.output_language}`);
    console.log(`=========================================================`);
    console.log(previewAnalysis(a));
    console.log(`---------------------------------------------------------`);
    const proceed = await ask(`\nScore this one? [y]es / [s]kip / [q]uit: `);
    if (proceed === "q") break;
    if (proceed === "s") continue;

    const human: Partial<Record<RubricDim, number>> = {};
    for (const dim of DIMS) {
      const def = RUBRIC_DEFINITIONS[dim];
      const s = await askScore(def.title, def.anchors);
      if (s === -1) break outer;
      if (s === null) { human[dim] = undefined; break; }
      human[dim] = s;
    }
    const judgeScores = ev.scores as Record<RubricDim, { score: number }> | null;
    if (!judgeScores) continue;
    for (const dim of DIMS) {
      const h = human[dim];
      if (h === undefined) continue;
      pairs.push({
        analysis_id: a.id,
        prompt_version: a.prompt_version,
        dim,
        human: h,
        judge: judgeScores[dim]?.score,
      });
    }
    // Reveal judge after scoring — keeps the human blind during scoring.
    console.log(`\n  judge: ${DIMS.map((d) => `${d.slice(0, 4)}=${judgeScores[d]?.score}`).join("  ")}  overall=${ev.overall}`);
    console.log(`  human: ${DIMS.map((d) => `${d.slice(0, 4)}=${human[d] ?? "—"}`).join("  ")}`);
  }
  rl.close();

  if (pairs.length === 0) { console.log("\nNo scores collected."); return; }

  // Per-dim Spearman + agreement rate (|h - j| ≤ 1)
  console.log(`\n\n=== Results (n=${pairs.length / DIMS.length} analyses, ${pairs.length} dim-scores) ===\n`);
  const lines: string[] = [];
  lines.push(`# Human vs LLM-Judge Calibration\n`);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(`Rubric: rubric-v1 (5 dims × 1–5)`);
  lines.push(`Analyses scored: ${new Set(pairs.map((p) => p.analysis_id)).size}`);
  lines.push(`Total dim-pairs: ${pairs.length}\n`);
  lines.push(`## Per-dimension agreement\n`);
  lines.push(`| dim | Spearman ρ | mean(judge − human) | within ±1 |`);
  lines.push(`|---|---:|---:|---:|`);
  for (const dim of DIMS) {
    const slice = pairs.filter((p) => p.dim === dim);
    const h = slice.map((p) => p.human);
    const j = slice.map((p) => p.judge);
    const rho = spearman(h, j);
    const bias = slice.length ? slice.reduce((a, p) => a + (p.judge - p.human), 0) / slice.length : NaN;
    const within = slice.length ? slice.filter((p) => Math.abs(p.judge - p.human) <= 1).length / slice.length : NaN;
    console.log(`${dim.padEnd(22)} ρ=${fmt(rho)}  bias=${fmt(bias)}  within±1=${fmt(within)}`);
    lines.push(`| ${dim} | ${fmt(rho)} | ${fmt(bias)} | ${fmt(within)} |`);
  }
  // Overall (pool all dims)
  const rho = spearman(pairs.map((p) => p.human), pairs.map((p) => p.judge));
  const bias = pairs.reduce((a, p) => a + (p.judge - p.human), 0) / pairs.length;
  const within = pairs.filter((p) => Math.abs(p.judge - p.human) <= 1).length / pairs.length;
  console.log(`\nPOOLED                 ρ=${fmt(rho)}  bias=${fmt(bias)}  within±1=${fmt(within)}`);
  lines.push(`| **pooled** | **${fmt(rho)}** | **${fmt(bias)}** | **${fmt(within)}** |`);

  lines.push(`\n## Raw pairs\n`);
  lines.push(`| analysis_id | prompt | dim | human | judge |`);
  lines.push(`|---|---|---|---:|---:|`);
  for (const p of pairs) {
    lines.push(`| ${p.analysis_id.slice(0, 8)} | ${p.prompt_version ?? "?"} | ${p.dim} | ${p.human} | ${p.judge} |`);
  }
  lines.push(`\n## Interpretation\n`);
  lines.push(`- **Spearman ρ** measures rank agreement (1.0 = perfect, 0 = uncorrelated).`);
  lines.push(`- **bias = mean(judge − human)** — positive means the judge over-rates relative to the human.`);
  lines.push(`- **within ±1** is the share of dim-scores where judge and human are within 1 point — the easier-to-explain agreement metric for a 1–5 ordinal scale.`);

  writeFileSync(out, lines.join("\n"));
  console.log(`\nWritten to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
