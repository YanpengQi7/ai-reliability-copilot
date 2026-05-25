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

const VERSIONS: PromptVersion[] = ["v1", "v2"];
const LANGUAGES: OutputLanguage[] = ["en", "zh"];

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
        console.log(`\n→ ${scenario.slug} · ${version} · ${language}`);
        try {
          const started = Date.now();
          const { object: analysis, usage } = await generateObject({
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
          const latency_ms = Date.now() - started;
          const { tokens_in, tokens_out } = normalizeUsage(usage);
          const cost_usd = calcCost(ANALYSIS_MODEL, tokens_in, tokens_out);

          const { data: inc, error: e1 } = await sb
            .from("incidents")
            .insert({
              title: `[Eval][${version}][${language}] ${scenario.title}`,
              service: scenario.service,
              symptoms: scenario.symptoms,
              raw_context: scenario.context,
            })
            .select("id")
            .single();
          if (e1) throw e1;
          const { data: ana, error: e2 } = await sb
            .from("analyses")
            .insert({
              incident_id: inc.id,
              model: ANALYSIS_MODEL,
              prompt_version: version,
              output_language: language,
              summary: analysis.summary,
              severity: analysis.severity,
              severity_reasoning: analysis.severity_reasoning,
              root_causes: analysis.root_causes,
              investigation_checklist: analysis.investigation_checklist,
              mitigation_plan: analysis.mitigation_plan,
              customer_impact: analysis.customer_impact,
              postmortem_draft: analysis.postmortem_draft,
              follow_ups: analysis.follow_ups,
              latency_ms,
              tokens_in,
              tokens_out,
              cost_usd,
            })
            .select("id")
            .single();
          if (e2) throw e2;

          const scores = await judge({ analysis, scenario });
          const overall = overallScore(scores);

          await sb.from("evaluations").insert({
            analysis_id: ana.id,
            rubric_version: RUBRIC_VERSION,
            scores,
            overall,
            judge_model: JUDGE_MODEL,
            judge_notes: scores.overall_notes,
          });

          console.log(`  overall: ${overall} · spec:${scores.specificity.score} saf:${scores.safety.score} act:${scores.actionability.score} dom:${scores.domain_correctness.score} comp:${scores.completeness.score}`);
          results.push({ scenario: scenario.slug, version, language, overall, latency_ms });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${msg}`);
        }
      }
    }
  }

  // Summary tables
  console.log("\n=== Summary: overall by (version, language) ===");
  console.log("scenario".padEnd(34), "v1·en".padStart(6), "v1·zh".padStart(6), "v2·en".padStart(6), "v2·zh".padStart(6));
  for (const scenario of SCENARIOS) {
    const cell = (v: PromptVersion, l: OutputLanguage) =>
      String(results.find((r) => r.scenario === scenario.slug && r.version === v && r.language === l)?.overall ?? "—").padStart(6);
    console.log(scenario.slug.padEnd(34), cell("v1", "en"), cell("v1", "zh"), cell("v2", "en"), cell("v2", "zh"));
  }
  const avg = (filter: (r: typeof results[number]) => boolean) => {
    const xs = results.filter(filter).map((r) => r.overall);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "n/a";
  };
  console.log("AVERAGE".padEnd(34),
    avg((r) => r.version === "v1" && r.language === "en").padStart(6),
    avg((r) => r.version === "v1" && r.language === "zh").padStart(6),
    avg((r) => r.version === "v2" && r.language === "en").padStart(6),
    avg((r) => r.version === "v2" && r.language === "zh").padStart(6),
  );
  console.log("\n=== Marginal averages ===");
  console.log("v1 overall:", avg((r) => r.version === "v1"));
  console.log("v2 overall:", avg((r) => r.version === "v2"));
  console.log("en overall:", avg((r) => r.language === "en"));
  console.log("zh overall:", avg((r) => r.language === "zh"));
}

main();
