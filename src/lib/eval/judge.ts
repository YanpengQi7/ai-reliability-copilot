import { generateObject } from "ai";
import { deepseek, JUDGE_MODEL, JUDGE_MODEL_GROUNDING } from "@/lib/ai";
import { RubricScores, RubricScoresWithGrounding, RUBRIC_DEFINITIONS, EVIDENCE_GROUNDING_DEF, type RubricDim } from "./rubric";
import type { Analysis } from "@/lib/schema";

function rubricDescription(): string {
  const dims = Object.keys(RUBRIC_DEFINITIONS) as RubricDim[];
  return dims
    .map((d) => {
      const r = RUBRIC_DEFINITIONS[d];
      return `## ${r.title} (1-5)
- 1: ${r.anchors[1]}
- 3: ${r.anchors[3]}
- 5: ${r.anchors[5]}`;
    })
    .join("\n\n");
}

export const JUDGE_SYSTEM_PROMPT = `You are an expert SRE quality reviewer. Score an incident response on a 5-dimension rubric. Be strict, calibrated, and cite concrete evidence from the response itself.

Anchors are 1 (poor), 3 (acceptable), 5 (excellent). Use the full range — most analyses should be 3 or 4. Reserve 5 for genuinely excellent work, reserve 1 for obvious failures.

For each dimension, the reasoning field MUST quote or paraphrase at least one concrete element from the response (a specific command, a section title, a number) to justify the score.

# Rubric

${rubricDescription()}

Output strictly conforms to the provided JSON schema.`;

export type JudgeInput = {
  analysis: Analysis;
  scenario?: {
    title: string;
    context: string;
    expected_severity: string;
    expected_root_cause: string;
  };
  // Agentic-only: the investigation transcript (tool calls + observations).
  // When present, the judge ALSO scores evidence_grounding against it.
  trace?: string;
};

export function buildJudgeUserPrompt(input: JudgeInput): string {
  const expected = input.scenario
    ? `

# Ground truth (for grading domain_correctness)
- Expected severity: ${input.scenario.expected_severity}
- Expected root cause: ${input.scenario.expected_root_cause}`
    : "";

  const traceBlock = input.trace
    ? `

# Investigation trace (tool calls + observations the analyst actually saw)
${input.trace}

Use this trace to score **evidence_grounding**: every numeric claim, log line, or root-cause assertion in the response must be traceable to a tool observation above. Penalize any evidence that does not appear in the trace.`
    : "";

  return `# Incident response to score

\`\`\`json
${JSON.stringify(input.analysis, null, 2)}
\`\`\`
${expected}${traceBlock}

Score it on the ${input.trace ? "6" : "5"}-dimension rubric now.`;
}

function groundingRubricBlock(): string {
  const r = EVIDENCE_GROUNDING_DEF;
  return `\n\n## ${r.title} (1-5)
- 1: ${r.anchors[1]}
- 3: ${r.anchors[3]}
- 5: ${r.anchors[5]}`;
}

// Core 5-dimension judge (used by the single-shot baseline + historical evals).
//
// `model` override: defaults to the DeepSeek judge for back-compat. Pass a
// different-vendor model (e.g. resolveModel(JUDGE_MODEL_CROSS)) to run the
// cross-model judge that measures same-family bias — see
// scripts/run-evals-crossjudge.ts. The analysis being scored is held fixed,
// so any score delta is attributable to the judge, not the generation.
export async function judge(input: JudgeInput, model = deepseek(JUDGE_MODEL)) {
  const { object } = await generateObject({
    model,
    schema: RubricScores,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgeUserPrompt({ ...input, trace: undefined }),
    temperature: 0,
  });
  return object;
}

// 6-dimension judge for the agentic arm: the core 5 PLUS evidence_grounding,
// graded against the supplied investigation trace.
//
// `judgeModel` override: calibration (notes/generated/calib-grounding.md) showed
// deepseek-chat returns a flat 5.00 on evidence_grounding with zero variance —
// too weak to discriminate verbatim-grounded from derived claims even with
// tightened anchors. The override lets us grade grounding with a stronger model
// (e.g. deepseek-reasoner) while the core-5 eval keeps deepseek-chat for
// comparability with the historical single-shot evals.
export async function judgeWithGrounding(input: JudgeInput & { trace: string }, judgeModel: string = JUDGE_MODEL_GROUNDING) {
  const { object } = await generateObject({
    model: deepseek(judgeModel),
    schema: RubricScoresWithGrounding,
    system: `${JUDGE_SYSTEM_PROMPT}${groundingRubricBlock()}`,
    prompt: buildJudgeUserPrompt(input),
    temperature: 0,
  });
  return object;
}
