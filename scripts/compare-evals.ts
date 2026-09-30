import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hash, safeId, writeJson } from "../src/lib/eval/artifacts";
import { compareRuns, comparisonMarkdown, loadComparisonRun } from "../src/lib/eval/comparison";
import { sourceHash } from "../src/lib/eval/sourceVersion";
import { safeErrorDetail } from "../src/lib/observability";

function main() {
  const allowed = new Set(["baseline", "candidate", "baseline-judge-run", "candidate-judge-run"]);
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || flags.has(match[1])) throw new Error("Use unique --baseline=RUN --candidate=RUN flags, with optional --baseline-judge-run=ID and --candidate-judge-run=ID");
    flags.set(match[1], safeId(match[2]));
  }
  if (!flags.has("baseline") || !flags.has("candidate")) throw new Error("Usage: npm run evals:compare -- --baseline=RUN --candidate=RUN");
  const baseline = loadComparisonRun(join("evals/runs", flags.get("baseline")!), flags.get("baseline-judge-run") ?? "primary");
  const candidateRoot = join("evals/runs", flags.get("candidate")!);
  const candidate = loadComparisonRun(candidateRoot, flags.get("candidate-judge-run") ?? "primary");
  if (baseline.manifest.id !== flags.get("baseline") || candidate.manifest.id !== flags.get("candidate")) throw new Error("Saved run identity differs from its directory");
  const comparison = { ...compareRuns(baseline, candidate), evaluator_hash: sourceHash() };
  const output = join(candidateRoot, "comparisons", `comparison-${hash(comparison)}`);
  writeJson(`${output}.json`, comparison);
  writeFileSync(`${output}.md`, comparisonMarkdown(comparison), { mode: 0o600 });
  console.log(JSON.stringify({ baseline: comparison.baseline.run, candidate: comparison.candidate.run,
    complete: comparison.complete, modes: comparison.modes, json: resolve(`${output}.json`), markdown: resolve(`${output}.md`), note: comparison.note }, null, 2));
}
try { main(); } catch (error) { console.error(safeErrorDetail(error)); process.exitCode = 2; }
