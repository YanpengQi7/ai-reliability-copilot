// Cross-model judge: measure the same-family optimistic bias.
//
// The core eval (run-evals.ts) has DeepSeek judging DeepSeek, so its absolute
// scores carry a same-vendor bias we've only *estimated* ("~10-20%", EVALUATION.md).
// This script MEASURES it: for each generated analysis we hold the analysis FIXED
// and score it with two judges from different vendors —
//   Judge A  = JUDGE_MODEL        (deepseek-chat, the primary judge)
//   Judge B  = JUDGE_MODEL_CROSS  (openai:gpt-4o-mini by default, independent)
// Any score delta is attributable to the judge, not the generation.
//
// Output: per-dimension and overall  meanA / meanB / bias(B−A) / MAE / exact-agree,
// Pearson r on the paired overall scores, and the share of items where the two
// judges land within ±0.5 on overall. The headline number is the overall bias:
// if Judge A (same family as the generator) sits systematically above the
// independent Judge B, that quantifies the self-bias.
//
// Self-contained: prints + dumps notes/generated/crossjudge-latest.json. Does NOT touch
// Supabase (holds the judge as the only variable, and stays runnable with just
// the two API keys).
//
// Run:  npm run evals:crossjudge
// Env:  EVAL_VERSION (default v3), EVAL_REPEATS (default 2),
//       JUDGE_MODEL_CROSS (default openai:gpt-4o-mini)

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { generateObject } from "ai";
import { SCENARIOS } from "../src/lib/scenarios";
import { AnalysisSchema } from "../src/lib/schema";
import { deepseek, resolveModel, ANALYSIS_MODEL, JUDGE_MODEL, JUDGE_MODEL_CROSS } from "../src/lib/ai";
import { getSystemPrompt, buildUserPrompt, type PromptVersion, type OutputLanguage } from "../src/lib/prompts";
import { judge } from "../src/lib/eval/judge";
import { overallScore, type RubricDim } from "../src/lib/eval/rubric";
import { parseEvalRepeats } from "../src/lib/eval/runConfig";

const VERSION = (process.env.EVAL_VERSION as PromptVersion) ?? "v3";
const LANGUAGES: OutputLanguage[] = ["en", "zh"];
const REPEATS = parseEvalRepeats(process.env.EVAL_REPEATS, 2);
const JUDGE_A = JUDGE_MODEL; // same family as the generator
const JUDGE_B = JUDGE_MODEL_CROSS; // independent vendor

const DIMS: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];

type Pair = { a: number; b: number };
type Row = {
  scenario: string;
  language: OutputLanguage;
  rep: number;
  dims: Record<RubricDim, Pair>;
  overall: Pair;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const mae = (ps: Pair[]) => mean(ps.map((p) => Math.abs(p.a - p.b)));
const bias = (ps: Pair[]) => mean(ps.map((p) => p.b - p.a)); // B − A: negative ⇒ A scores higher
const exactAgree = (ps: Pair[]) => mean(ps.map((p) => (p.a === p.b ? 1 : 0)));

function pearson(ps: Pair[]): number {
  const n = ps.length;
  if (n < 2) return NaN;
  const ma = mean(ps.map((p) => p.a));
  const mb = mean(ps.map((p) => p.b));
  let num = 0, da = 0, db = 0;
  for (const { a, b } of ps) {
    const xa = a - ma, xb = b - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}

const pad = (s: string, n: number) => s.padEnd(n);
const num = (x: number, d = 2) => (Number.isNaN(x) ? "—".padStart(7) : x.toFixed(d).padStart(7));

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("Missing DEEPSEEK_API_KEY in .env.local");
  // The cross judge's key requirement depends on its provider, not always OpenAI.
  const crossProvider = JUDGE_B.includes(":") ? JUDGE_B.slice(0, JUDGE_B.indexOf(":")) : "deepseek";
  const crossKeyEnv = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", deepseek: "DEEPSEEK_API_KEY" }[crossProvider];
  if (crossKeyEnv && !process.env[crossKeyEnv]) {
    throw new Error(`Missing ${crossKeyEnv} in .env.local (needed for cross judge "${JUDGE_B}")`);
  }

  console.log(`Cross-model judge · prompt ${VERSION} · ${REPEATS} repeat(s)`);
  console.log(`  Judge A (same family): ${JUDGE_A}`);
  console.log(`  Judge B (independent): ${JUDGE_B}\n`);

  const judgeB = resolveModel(JUDGE_B);
  const rows: Row[] = [];

  for (const scenario of SCENARIOS) {
    for (const language of LANGUAGES) {
      for (let rep = 0; rep < REPEATS; rep++) {
        const tag = `${scenario.slug} · ${language}${REPEATS > 1 ? ` · run ${rep + 1}/${REPEATS}` : ""}`;
        try {
          // Generate the analysis ONCE, then judge the same artifact twice.
          const { object: analysis } = await generateObject({
            model: deepseek(ANALYSIS_MODEL),
            schema: AnalysisSchema,
            system: getSystemPrompt(VERSION),
            prompt: buildUserPrompt({
              service: scenario.service,
              symptoms: scenario.symptoms,
              raw_context: scenario.context,
              language,
            }),
            temperature: 0.2,
          });

          const input = { analysis, scenario };
          const [sa, sb] = await Promise.all([
            judge(input), // Judge A (default DeepSeek)
            judge(input, judgeB), // Judge B (independent vendor)
          ]);

          const dims = Object.fromEntries(
            DIMS.map((d) => [d, { a: sa[d].score, b: sb[d].score }]),
          ) as Record<RubricDim, Pair>;
          const overall: Pair = { a: overallScore(sa), b: overallScore(sb) };
          rows.push({ scenario: scenario.slug, language, rep, dims, overall });
          console.log(`  ${pad(tag, 52)} A=${overall.a.toFixed(2)}  B=${overall.b.toFixed(2)}  Δ=${(overall.b - overall.a >= 0 ? "+" : "")}${(overall.b - overall.a).toFixed(2)}`);
        } catch (err) {
          console.error(`  ✗ ${tag}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  if (rows.length === 0) {
    console.error("\nNo successful rows — nothing to report.");
    process.exit(1);
  }

  // ── Agreement table ──────────────────────────────────────────────────
  console.log(`\n=== Judge agreement (n=${rows.length} analyses, each judged by both) ===`);
  console.log(`${pad("dimension", 20)}${pad("meanA", 7)}${pad("meanB", 7)}${pad("bias(B−A)", 11)}${pad("MAE", 7)}${pad("exact", 7)}`);
  const reportRow = (label: string, ps: Pair[]) => {
    console.log(
      pad(label, 20) +
        num(mean(ps.map((p) => p.a))) +
        num(mean(ps.map((p) => p.b))) +
        num(bias(ps), 2).padStart(11) +
        num(mae(ps)) +
        num(exactAgree(ps)),
    );
  };
  for (const d of DIMS) reportRow(d, rows.map((r) => r.dims[d]));
  const overallPairs = rows.map((r) => r.overall);
  reportRow("OVERALL", overallPairs);

  const r = pearson(overallPairs);
  const within = mean(overallPairs.map((p) => (Math.abs(p.a - p.b) <= 0.5 ? 1 : 0)));
  const overallBias = bias(overallPairs);
  console.log(`\nOverall Pearson r (A vs B): ${r.toFixed(3)}`);
  console.log(`Within ±0.5 on overall:     ${(within * 100).toFixed(0)}%`);
  console.log(
    `Self-bias (overall bias B−A): ${overallBias.toFixed(3)}  → ` +
      (overallBias < -0.05
        ? `Judge A (${JUDGE_A}) scores HIGHER than the independent judge by ${Math.abs(overallBias).toFixed(2)} pts — same-family optimism is real.`
        : overallBias > 0.05
          ? `Judge A scores LOWER than the independent judge by ${overallBias.toFixed(2)} pts — no same-family optimism in this run.`
          : `negligible (|bias| ≤ 0.05) — the two judges agree on the level.`),
  );

  // ── Per-language bias (the most reproducible effect in past runs) ─────
  console.log(`\n=== Overall bias (B−A) by language ===`);
  for (const l of LANGUAGES) {
    const ps = rows.filter((x) => x.language === l).map((x) => x.overall);
    console.log(`  ${l}: bias ${bias(ps) >= 0 ? "+" : ""}${bias(ps).toFixed(3)}  (meanA ${mean(ps.map((p) => p.a)).toFixed(2)}, meanB ${mean(ps.map((p) => p.b)).toFixed(2)}, n=${ps.length})`);
  }

  const out = {
    generated_at: new Date().toISOString(),
    prompt_version: VERSION,
    repeats: REPEATS,
    judge_a: JUDGE_A,
    judge_b: JUDGE_B,
    n: rows.length,
    overall: { meanA: mean(overallPairs.map((p) => p.a)), meanB: mean(overallPairs.map((p) => p.b)), bias: overallBias, mae: mae(overallPairs), pearson_r: r, within_half_point: within },
    by_dimension: Object.fromEntries(
      DIMS.map((d) => {
        const ps = rows.map((x) => x.dims[d]);
        return [d, { meanA: mean(ps.map((p) => p.a)), meanB: mean(ps.map((p) => p.b)), bias: bias(ps), mae: mae(ps), exact_agree: exactAgree(ps) }];
      }),
    ),
    rows,
  };
  writeFileSync("notes/generated/crossjudge-latest.json", JSON.stringify(out, null, 2));
  console.log(`\nWrote notes/generated/crossjudge-latest.json`);

  const expectedRows = SCENARIOS.length * LANGUAGES.length * REPEATS;
  if (rows.length < expectedRows) {
    console.error(`\n✗ ${expectedRows - rows.length} cross-judge run(s) failed; results are incomplete.`);
    process.exitCode = 1;
  }
}

main();
