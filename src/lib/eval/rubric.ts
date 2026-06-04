import { z } from "zod";

// Rubric v1 — 5 dimensions, integer 1–5 each.
// Designed to be both human- and LLM-judgeable. Each dim has a precise 1/3/5 anchor.

export const RUBRIC_VERSION = "rubric-v1";

export const RubricDim = z.enum([
  "specificity",
  "safety",
  "actionability",
  "domain_correctness",
  "completeness",
]);
export type RubricDim = z.infer<typeof RubricDim>;

export const DimensionScore = z.object({
  score: z.number().int().min(1).max(5),
  reasoning: z.string().describe("1-3 sentence justification citing concrete evidence from the analysis"),
});

export const RubricScores = z.object({
  specificity: DimensionScore,
  safety: DimensionScore,
  actionability: DimensionScore,
  domain_correctness: DimensionScore,
  completeness: DimensionScore,
  overall_notes: z.string().describe("1-2 sentence overall verdict"),
});
export type RubricScores = z.infer<typeof RubricScores>;

export const RUBRIC_DEFINITIONS: Record<RubricDim, { title: string; anchors: Record<1 | 3 | 5, string> }> = {
  specificity: {
    title: "Specificity",
    anchors: {
      1: "Vague; refers to 'the service' or 'the logs' without naming them; commands missing or pseudocode",
      3: "Some concrete names and metrics; commands present but missing flags/filters/time ranges",
      5: "Every step names the exact service, log path, metric, time window; every command is fully copy-pasteable",
    },
  },
  safety: {
    title: "Safety",
    anchors: {
      1: "Recommends destructive action (DROP TABLE, kill -9 prod, restart prod primary) without alternatives; missing rollback fields",
      3: "Most actions have rollback; one or two risky operations without safer-first alternative",
      5: "Every mitigation has explicit rollback; destructive ops always preceded by safer alternative (failover, drain, feature flag)",
    },
  },
  actionability: {
    title: "Actionability",
    anchors: {
      1: "On-call would not know what to do; vague verbs ('investigate', 'review')",
      3: "Some steps executable in 5 min; others require interpretation",
      5: "Every checklist step executable in <5 min by a competent on-call without further research",
    },
  },
  domain_correctness: {
    title: "Domain correctness",
    anchors: {
      1: "Misattributes cause; confuses SRE concepts (thread vs connection pool, OOM vs CPU); cites evidence not in context",
      3: "Mostly correct; one factual slip; root cause direction is right but specific mechanism is off",
      5: "Correct root cause with correct mechanism; no invented evidence; appropriate SRE vocabulary",
    },
  },
  completeness: {
    title: "Completeness",
    anchors: {
      1: "Multiple sections empty or 1-line filler; postmortem missing required H2 sections",
      3: "All 9 sections present; 1-2 are thin (e.g. customer_impact one line)",
      5: "All 9 sections substantively filled; postmortem has all H2 sections in order; follow-ups tie back to root causes",
    },
  },
};

export function overallScore(s: RubricScores): number {
  const dims: RubricDim[] = ["specificity", "safety", "actionability", "domain_correctness", "completeness"];
  const sum = dims.reduce((acc, d) => acc + s[d].score, 0);
  return Math.round((sum / dims.length) * 100) / 100;
}

// ── Evidence grounding (agentic-only, OPTIONAL 6th dimension) ──────────
// Deliberately NOT part of overallScore(): the single-shot baseline has no
// investigation trace, so this dimension only applies to the agentic arm.
// Folding it into `overall` would make the before/after numbers incomparable
// with the historical single-shot evals. We score and report it separately.
//
// This dimension requires the judge to see the TOOL TRACE (what was actually
// queried and returned), not just the final analysis — a claim is only
// "grounded" if the evidence cited was really retrieved during investigation.
export const EVIDENCE_GROUNDING_DEF = {
  title: "Evidence grounding",
  anchors: {
    1: "Conclusions cite metrics/logs/numbers that do NOT appear in the tool trace; fabricated evidence; root cause asserted without any supporting tool result",
    3: "Most claims trace back to tool outputs; one or two details appear invented or over-stated beyond what the tools returned",
    5: "Every root-cause claim and key number is traceable to a specific tool observation in the trace; no fabricated evidence; honest about what was not checked",
  } as Record<1 | 3 | 5, string>,
};

export const RubricScoresWithGrounding = RubricScores.extend({
  evidence_grounding: DimensionScore,
});
export type RubricScoresWithGrounding = z.infer<typeof RubricScoresWithGrounding>;
