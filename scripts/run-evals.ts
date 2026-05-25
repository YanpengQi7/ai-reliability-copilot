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
import { getSystemPrompt, buildUserPrompt, type PromptVersion } from "../src/lib/prompts";
import { judge } from "../src/lib/eval/judge";
import { RUBRIC_VERSION, overallScore } from "../src/lib/eval/rubric";

const VERSIONS: PromptVersion[] = ["v1", "v2"];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const results: Array<{ scenario: string; version: PromptVersion; overall: number; latency_ms: number }> = [];

  for (const scenario of SCENARIOS) {
    for (const version of VERSIONS) {
      console.log(`\n→ ${scenario.slug} · ${version}`);
      try {
        const started = Date.now();
        const { object: analysis } = await generateObject({
          model: deepseek(ANALYSIS_MODEL),
          schema: AnalysisSchema,
          system: getSystemPrompt(version),
          prompt: buildUserPrompt({
            service: scenario.service,
            symptoms: scenario.symptoms,
            raw_context: scenario.context,
          }),
          temperature: 0.2,
        });
        const latency_ms = Date.now() - started;

        // Persist incident + analysis
        const { data: inc, error: e1 } = await sb
          .from("incidents")
          .insert({
            title: `[Eval][${version}] ${scenario.title}`,
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
            summary: analysis.summary,
            severity: analysis.severity,
            root_causes: analysis.root_causes,
            investigation_checklist: analysis.investigation_checklist,
            mitigation_plan: analysis.mitigation_plan,
            customer_impact: analysis.customer_impact,
            postmortem_draft: analysis.postmortem_draft,
            follow_ups: analysis.follow_ups,
            latency_ms,
          })
          .select("id")
          .single();
        if (e2) throw e2;

        // Judge
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
        results.push({ scenario: scenario.slug, version, overall, latency_ms });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${msg}`);
      }
    }
  }

  // Summary table
  console.log("\n=== Summary ===");
  console.log("scenario".padEnd(34), "v1".padStart(6), "v2".padStart(6));
  for (const scenario of SCENARIOS) {
    const v1 = results.find((r) => r.scenario === scenario.slug && r.version === "v1")?.overall ?? NaN;
    const v2 = results.find((r) => r.scenario === scenario.slug && r.version === "v2")?.overall ?? NaN;
    console.log(scenario.slug.padEnd(34), String(v1).padStart(6), String(v2).padStart(6));
  }
  const avg = (v: PromptVersion) => {
    const xs = results.filter((r) => r.version === v).map((r) => r.overall);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "n/a";
  };
  console.log("AVERAGE".padEnd(34), avg("v1").padStart(6), avg("v2").padStart(6));
}

main();
