import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArtifactStore, safeId } from "../src/lib/eval/artifacts";
import { validateDataset } from "../src/lib/eval/dataset";
import { replayProductionTrial } from "../src/lib/eval/replay";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !args[0].startsWith("--id=") || !args[1].startsWith("--trial=")) throw new Error("Usage: npm run agent:replay -- --id=RUN --trial=TRIAL");
  const root = join("evals/runs", safeId(args[0].slice(5)));
  const store = new ArtifactStore(root), trial = store.trial(safeId(args[1].slice(8)));
  const cases = validateDataset(JSON.parse(readFileSync(join(root, "dataset.json"), "utf8")), { snapshotPolicy: "audit" });
  const result = await replayProductionTrial(store.manifest(), cases, trial);
  console.log(JSON.stringify({ verified: true, execution: "offline_recorded_responses", engine: result.engine_version, trial: trial.id, steps: result.steps, stop_reason: result.stop_reason,
    note: "Verifies recorded control flow and diagnosis presentation through the production entry point. No provider calls; not a fresh model-quality measurement." }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Replay failed"); process.exitCode = 1; });
