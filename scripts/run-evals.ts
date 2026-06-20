// Batch eval runner: for each scenario × each prompt version, generate an analysis,
// then score it with the judge. Writes everything to Supabase.
// Run: npm run evals:run

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { SCENARIOS } from "../src/lib/scenarios";
import { AnalysisSchema } from "../src/lib/schema";
import { deepseek, ANALYSIS_MODEL, JUDGE_MODEL } from "../src/lib/ai";
import { getSystemPrompt, buildUserPrompt, type PromptVersion, type OutputLanguage } from "../src/lib/prompts";
import { judge } from "../src/lib/eval/judge";
import { RUBRIC_VERSION, overallScore } from "../src/lib/eval/rubric";
import { calcCost, normalizeUsage } from "../src/lib/cost";
import { buildAnalysisRecord } from "../src/lib/analysisRecord";
import { buildIncidentRecord } from "../src/lib/incidentRecord";

const VERSIONS: PromptVersion[] = ["v1", "v2", "v3"];
const LANGUAGES: OutputLanguage[] = ["en", "zh"];
// Repeats per cell — lets us report mean ± std and tell a real gap from run-to-run noise.
// Override with EVAL_REPEATS=1 for a quick smoke run.
const REPEATS = Math.max(1, parseInt(process.env.EVAL_REPEATS ?? "3", 10));

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
// Sample standard deviation (n−1). With n=1 std is undefined → return 0 for display.
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function fmtMS(xs: number[]): string {
  if (!xs.length) return "—".padStart(11);
  return `${mean(xs).toFixed(2)}±${std(xs).toFixed(2)}`.padStart(11);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const results: Array<{ scenario: string; version: PromptVersion; language: OutputLanguage; overall: number; latency_ms: number }> = [];

  for (const scenario of SCENARIOS) {
    for (const version of VERSIONS) {
      for (const language of LANGUAGES) {
       for (let rep = 0; rep < REPEATS; rep++) {
        console.log(`\n→ ${scenario.slug} · ${version} · ${language}${REPEATS > 1 ? ` · run ${rep + 1}/${REPEATS}` : ""}`);
        try {
          const started = Date.now();
          // DeepSeek's JSON schema mode occasionally returns invalid JSON — retry once on parse failure.
          let analysis: import("zod").z.infer<typeof AnalysisSchema>;
          let usage: Awaited<ReturnType<typeof generateObject>>["usage"];
          {
            const attempt = async () => generateObject({
              model: deepseek(ANALYSIS_MODEL),
              schema: AnalysisSchema,
              system: getSystemPrompt(version),
              prompt: buildUserPrompt({
                service: scenario.service,
                symptoms: scenario.symptoms,
                raw_context: scenario.context,
                language,
              }),
              temperature: 0.2,
            });
            try {
              const r = await attempt();
              analysis = r.object;
              usage = r.usage;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (!/parse|invalid json|schema/i.test(msg)) throw err;
              console.log(`  ↻ retry after parse error: ${msg.slice(0, 80)}`);
              const r = await attempt();
              analysis = r.object;
              usage = r.usage;
            }
          }
          const latency_ms = Date.now() - started;
          const { tokens_in, tokens_out } = normalizeUsage(usage);
          const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);

          const { data: inc, error: e1 } = await sb
            .from("incidents")
            .insert(buildIncidentRecord({
              title: `[Eval][${version}][${language}] ${scenario.title}`,
              service: scenario.service,
              symptoms: scenario.symptoms,
              rawContext: scenario.context,
            }))
            .select("id")
            .single();
          if (e1 || !inc) throw e1 ?? new Error("Eval incident insert returned no row.");
          const { data: ana, error: e2 } = await sb
            .from("analyses")
            .insert(buildAnalysisRecord({
              incidentId: inc.id,
              analysis,
              model: ANALYSIS_MODEL,
              promptVersion: version,
              outputLanguage: language,
              latencyMs: latency_ms,
              usage: { tokens_in, tokens_out, cost_usd },
            }))
            .select("id")
            .single();
          if (e2 || !ana) {
            const { error: cleanupError } = await sb.from("incidents").delete().eq("id", inc.id);
            if (cleanupError) {
              console.error(`  ✗ failed to clean up incident ${inc.id}: ${cleanupError.message}`);
            }
            throw e2 ?? new Error("Eval analysis insert returned no row.");
          }

          const scores = await judge({ analysis, scenario });
          const overall = overallScore(scores);

          const { error: e3 } = await sb.from("evaluations").insert({
            analysis_id: ana.id,
            rubric_version: RUBRIC_VERSION,
            scores,
            overall,
            judge_model: JUDGE_MODEL,
            judge_notes: scores.overall_notes,
          });
          if (e3) throw e3;

          console.log(`  overall: ${overall} · spec:${scores.specificity.score} saf:${scores.safety.score} act:${scores.actionability.score} dom:${scores.domain_correctness.score} comp:${scores.completeness.score}`);
          results.push({ scenario: scenario.slug, version, language, overall, latency_ms });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${msg}`);
        }
       }
      }
    }
  }

  // Summary tables — columns auto-generated from VERSIONS × LANGUAGES.
  // With REPEATS>1 each cell aggregates over its repeats as mean±std.
  const overallsFor = (filter: (r: typeof results[number]) => boolean) =>
    results.filter(filter).map((r) => r.overall);
  const cells: Array<[PromptVersion, OutputLanguage]> = [];
  for (const v of VERSIONS) for (const l of LANGUAGES) cells.push([v, l]);

  console.log(`\n=== Summary: overall by (version, language) — mean±std over ${REPEATS} run(s) ===`);
  console.log("scenario".padEnd(34), ...cells.map(([v, l]) => `${v}·${l}`.padStart(11)));
  for (const scenario of SCENARIOS) {
    console.log(
      scenario.slug.padEnd(34),
      ...cells.map(([v, l]) => fmtMS(overallsFor((r) => r.scenario === scenario.slug && r.version === v && r.language === l))),
    );
  }
  console.log("CELL MEAN".padEnd(34),
    ...cells.map(([v, l]) => fmtMS(overallsFor((r) => r.version === v && r.language === l))),
  );

  console.log("\n=== Marginal averages (mean±std over all runs in the group) ===");
  for (const v of VERSIONS) {
    const xs = overallsFor((r) => r.version === v);
    console.log(`${v} overall:`, `${mean(xs).toFixed(3)} ± ${std(xs).toFixed(3)}  (n=${xs.length})`);
  }
  for (const l of LANGUAGES) {
    const xs = overallsFor((r) => r.language === l);
    console.log(`${l} overall:`, `${mean(xs).toFixed(3)} ± ${std(xs).toFixed(3)}  (n=${xs.length})`);
  }

  // Pairwise version deltas with a crude significance flag: is |Δmean| larger than
  // the pooled std? Not a t-test, but enough to say "inside the noise" vs "stands out".
  console.log("\n=== Pairwise version deltas (overall) ===");
  for (let i = 0; i < VERSIONS.length; i++) {
    for (let j = i + 1; j < VERSIONS.length; j++) {
      const a = overallsFor((r) => r.version === VERSIONS[i]);
      const b = overallsFor((r) => r.version === VERSIONS[j]);
      const delta = mean(a) - mean(b);
      const pooled = Math.sqrt((std(a) ** 2 + std(b) ** 2) / 2);
      const verdict = Math.abs(delta) > pooled ? "stands out" : "inside noise";
      console.log(`${VERSIONS[i]} − ${VERSIONS[j]}: ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}  (pooled std ${pooled.toFixed(3)} → ${verdict})`);
    }
  }
}

main();
