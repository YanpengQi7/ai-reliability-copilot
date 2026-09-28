import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ArtifactStore, hash, safeId, writeJson } from "../src/lib/eval/artifacts";
import { loadDataset } from "../src/lib/eval/dataset";
import { plannedTrials } from "../src/lib/eval/engine";
import { shuffled } from "../src/lib/eval/statistics";

const [command, id, reviewer, judgeRun = "primary"] = process.argv.slice(2);
if (!["export", "summarize"].includes(command) || !id || !reviewer) throw new Error("Usage: npm run evals:review -- export|summarize RUN_ID REVIEWER_ID [JUDGE_RUN]");
const root = join("evals/runs", safeId(id)), store = new ArtifactStore(root), manifest = store.manifest();
const cases = loadDataset(join(root, "dataset.json"));
const trials = plannedTrials(manifest, cases).map(t => store.trial(t.id)).filter(t => t.status === "succeeded");
const directory = join("evals/reviews", safeId(id), safeId(reviewer));
const map = Object.fromEntries(trials.map(t => [hash({ run: id, trial: t.id, reviewer }).slice(0, 16), t.id]));
const template = shuffled(Object.entries(map), manifest.seed).map(([sample_id, trialId]) => {
  const t = trials.find(t => t.id === trialId)!;
  return { sample_id, input: t.input, evidence: t.evidence, response: t.diagnosis, scores: { specificity: null, safety: null, actionability: null, domain_correctness: null, completeness: null }, notes: "" };
});
if (command === "export") {
  if (existsSync(join(directory, "responses.json"))) throw new Error("Review already exists; refusing to overwrite annotations");
  writeJson(join(directory, "responses.json"), template);
  // Keep this mapping from reviewers; it is used only for aggregation.
  writeJson(join(root, `review-map-${safeId(reviewer)}.json`), { manifest_hash: hash(manifest), samples: map });
  console.log(`Blind review: ${directory}/responses.json. No model, prompt version or judge scores are exposed.`);
} else {
  const score = z.number().int().min(1).max(5);
  const schema = z.array(z.object({ sample_id: z.string(), scores: z.object({ specificity: score, safety: score, actionability: score, domain_correctness: score, completeness: score }), notes: z.string() }));
  const responses = schema.parse(JSON.parse(readFileSync(join(directory, "responses.json"), "utf8")));
  if (new Set(responses.map(r => r.sample_id)).size !== responses.length) throw new Error("Duplicate human samples");
  const dims = ["specificity", "safety", "actionability", "domain_correctness", "completeness"] as const;
  const pairs: Record<string, Array<{ human: number; judge: number }>> = Object.fromEntries(dims.map(d => [d, []]));
  for (const r of responses) {
    const trialId = map[r.sample_id];
    if (!trialId) throw new Error("Unknown blind sample ID");
    const j = store.judgment(trialId, safeId(judgeRun));
    if (!j?.verdict || j.status !== "succeeded" || j.trial_hash !== hash(store.trial(trialId))) continue;
    for (const d of dims) pairs[d].push({ human: r.scores[d], judge: j.verdict.core[d].score });
  }
  const summary = { reviewer, planned: template.length, annotated: responses.length, dimensions: Object.fromEntries(dims.map(d => {
    const p = pairs[d];
    return [d, { n: p.length, mae: p.length ? p.reduce((s, x) => s + Math.abs(x.human - x.judge), 0) / p.length : null, exact_agreement: p.length ? p.filter(x => x.human === x.judge).length / p.length : null }];
  })), note: "One reviewer's agreement is not ground truth. Independent second review and adjudication are still required." };
  writeJson(join(directory, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}
