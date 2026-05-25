import { generateObject } from "ai";
import { deepseek, JUDGE_MODEL } from "@/lib/ai";
import { RubricScores, RUBRIC_DEFINITIONS, type RubricDim } from "./rubric";
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
};

export function buildJudgeUserPrompt(input: JudgeInput): string {
  const expected = input.scenario
    ? `

# Ground truth (for grading domain_correctness)
- Expected severity: ${input.scenario.expected_severity}
- Expected root cause: ${input.scenario.expected_root_cause}`
    : "";

  return `# Incident response to score

\`\`\`json
${JSON.stringify(input.analysis, null, 2)}
\`\`\`
${expected}

Score it on the 5-dimension rubric now.`;
}

export async function judge(input: JudgeInput) {
  const { object } = await generateObject({
    model: deepseek(JUDGE_MODEL),
    schema: RubricScores,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgeUserPrompt(input),
    temperature: 0,
  });
  return object;
}
