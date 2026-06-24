// Judge calibration for the evidence_grounding dimension.
//
// The full eval put evidence_grounding at 4.93/5 (near ceiling). That could mean
// the agent really is well-grounded — or that the DeepSeek judge is lenient. This
// script provides an INDEPENDENT, deterministic cross-check so we don't take the
// judge's word for it.
//
// Method: for each agentic run, pull the concrete evidence CLAIMS the analysis
// makes (every number/metric token in severity_reasoning + each root_cause.evidence)
// and check whether each one actually appears in the investigation trace the agent
// saw. The "grounded ratio" is a crude but reproducible second opinion. Where the
// judge gave a high grounding score but the ratio is low (claims not in the trace),
// the judge is being lenient — and we list the ungrounded tokens for human review.
//
//   npm run calib:grounding            # all 5 scenarios, en
//   npm run calib:grounding -- --all   # include zh
//
// Writes notes/generated/calib-grounding.md for the audit.

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { SCENARIOS } from "../src/lib/scenarios";
import { investigate, evidenceTranscript } from "../src/lib/agent/investigate";
import { judgeWithGrounding } from "../src/lib/eval/judge";
import { JUDGE_MODEL_GROUNDING } from "../src/lib/ai";
import type { OutputLanguage } from "../src/lib/prompts";

// Normalize for forgiving substring matching: lowercase, strip spaces around
// units, collapse whitespace. "12 %" and "12%" both → "12%".
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/\s*(%|ms|mi|gi|s|x)\b/g, "$1");
}

// Extract evidence-bearing tokens: numbers with optional unit, and version-ish
// strings like v2.41. These are the things a grounding claim hangs on.
function extractClaims(text: string): string[] {
  const out = new Set<string>();
  // numbers with optional unit/suffix (12%, 4.8s, 500, 99.7%, 512Mi, 12x, 28s)
  const numRe = /\b\d[\d.,]*\s*(%|ms|mi|gi|s|x|\/\s*\d+)?/gi;
  for (const m of text.match(numRe) ?? []) {
    const t = m.trim();
    // drop bare small integers <10 with no unit — too noisy (e.g. "3 hypotheses")
    if (/^\d{1,1}$/.test(t)) continue;
    out.add(norm(t));
  }
  // version strings
  for (const m of text.match(/\bv\d+(\.\d+)+/gi) ?? []) out.add(norm(m));
  return [...out];
}

function audit(claims: string[], traceText: string): { grounded: string[]; ungrounded: string[] } {
  const t = norm(traceText);
  const grounded: string[] = [];
  const ungrounded: string[] = [];
  for (const c of claims) {
    // also try the unit-stripped numeric core, to avoid false negatives on units
    const core = c.replace(/[%a-z/]/g, "").trim();
    if (t.includes(c) || (core.length >= 2 && t.includes(core))) grounded.push(c);
    else ungrounded.push(c);
  }
  return { grounded, ungrounded };
}

async function main() {
  const includeZh = process.argv.includes("--all");
  const languages: OutputLanguage[] = includeZh ? ["en", "zh"] : ["en"];
  // --judge <model> overrides the grounding judge (e.g. deepseek-reasoner).
  const ji = process.argv.indexOf("--judge");
  const judgeModel = ji >= 0 && process.argv[ji + 1] ? process.argv[ji + 1] : JUDGE_MODEL_GROUNDING;
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing");
    process.exit(1);
  }

  const lines: string[] = [
    "# Evidence-grounding calibration audit",
    "",
    `Generated ${new Date().toISOString()}. Grounding judge: **${judgeModel}**. Independent deterministic cross-check of the judge's evidence_grounding score.`,
    "",
    "For each agentic run: **judge score** (1-5, DeepSeek) vs **grounded ratio** (numeric/metric claims in the analysis that actually appear in the trace).",
    "A high judge score next to a low grounded ratio = lenient judge. Ungrounded tokens are listed for human review (some are false negatives — paraphrase/derived — flagged for eyeballing).",
    "",
    "| scenario | lang | judge | grounded ratio | ungrounded tokens |",
    "|---|---|---|---|---|",
  ];

  type Rec = { scenario: string; lang: OutputLanguage; judge: number; ratio: number; ungrounded: string[] };
  const recs: Rec[] = [];

  for (const scenario of SCENARIOS) {
    for (const lang of languages) {
      process.stdout.write(`→ ${scenario.slug} ${lang} `);
      try {
        const r = await investigate({
          input: { service: scenario.service, symptoms: scenario.symptoms, raw_context: scenario.context, scenarioSlug: scenario.slug },
          language: lang,
        });
        const trace = evidenceTranscript(r.trace);
        const scores = await judgeWithGrounding({ analysis: r.analysis, scenario: { title: scenario.title, context: scenario.context, expected_severity: scenario.expected_severity, expected_root_cause: scenario.expected_root_cause }, trace }, judgeModel);

        // Claims live in the evidence-bearing prose fields.
        const claimText = [r.analysis.severity_reasoning, ...r.analysis.root_causes.map((rc) => rc.evidence), r.analysis.summary].join(" \n ");
        const claims = extractClaims(claimText);
        const { grounded, ungrounded } = audit(claims, trace);
        const ratio = claims.length ? grounded.length / claims.length : 1;

        recs.push({ scenario: scenario.slug, lang, judge: scores.evidence_grounding.score, ratio, ungrounded });
        lines.push(`| ${scenario.slug} | ${lang} | ${scores.evidence_grounding.score} | ${grounded.length}/${claims.length} (${(ratio * 100).toFixed(0)}%) | ${ungrounded.length ? "`" + ungrounded.join("`, `") + "`" : "—"} |`);
        console.log(`judge ${scores.evidence_grounding.score} · grounded ${(ratio * 100).toFixed(0)}% · ${ungrounded.length} ungrounded`);
      } catch (err) {
        console.log(`✗ ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`);
      }
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const avgJudge = mean(recs.map((r) => r.judge));
  const avgRatio = mean(recs.map((r) => r.ratio));
  lines.push(
    "",
    "## Verdict",
    "",
    `- Mean judge grounding score: **${avgJudge.toFixed(2)} / 5** (= ${((avgJudge / 5) * 100).toFixed(0)}% of ceiling)`,
    `- Mean deterministic grounded ratio: **${(avgRatio * 100).toFixed(0)}%** of evidence tokens traceable`,
    `- Gap: ${avgJudge >= 4.5 && avgRatio >= 0.9 ? "judge's high score is CORROBORATED by the deterministic check — grounding really is strong." : avgJudge >= 4.5 && avgRatio < 0.9 ? `judge looks LENIENT — it scored ${avgJudge.toFixed(1)}/5 while only ${(avgRatio * 100).toFixed(0)}% of claims are traceable. Tighten the grounding anchors / use a stronger judge before quoting grounding as a win.` : "scores roughly agree."}`,
    "",
    "> Caveat: the deterministic check undercounts — paraphrased or derived claims (e.g. 'connection pool exhausted' with no number) won't match a token even when fully grounded. Treat the ratio as a FLOOR on grounding and eyeball the ungrounded list.",
  );

  writeFileSync("notes/generated/calib-grounding.md", lines.join("\n"));
  console.log(`\nMean judge ${avgJudge.toFixed(2)}/5 vs deterministic grounded ${(avgRatio * 100).toFixed(0)}%. Audit → notes/generated/calib-grounding.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
