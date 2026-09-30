import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ArtifactStore, hash, safeId, writeJson } from "../src/lib/eval/artifacts";
import { loadDataset, validateDataset } from "../src/lib/eval/dataset";
import { ManifestSchema, CalibrationSchema, type Trial, type Judgment, type Manifest, type CallUsage } from "../src/lib/eval/contracts";
import { DIAGNOSIS_PROMPT, EVAL_JUDGE_PROMPT, generateTrial, plannedTrials, scoreTrial, type EvalModel } from "../src/lib/eval/engine";
import { DiagnosisSchema, DecisionSchema, VerdictSchema } from "../src/lib/eval/contracts";
import { Budget, BudgetExceeded, liveModel, type LedgerEntry } from "../src/lib/eval/provider";
import { buildReport, reportMarkdown } from "../src/lib/eval/report";
import { calibrationPack, ReviewsSchema, summarizeCalibration } from "../src/lib/eval/calibration";
import { recoveredUsage } from "../src/lib/eval/accounting";
import { PLANNER_PROMPT } from "../src/lib/agent/diagnosisPrompt";
import { INVESTIGATION_ENGINE_VERSION } from "../src/lib/agent/runtime";
import { parseEvalFlags, validateEvalFlags } from "../src/lib/eval/cliConfig";
import { safeErrorDetail } from "../src/lib/observability";
import { sourceHash } from "../src/lib/eval/sourceVersion";

const argv = process.argv.slice(2);
const command = argv.shift() ?? "validate";
const flags = parseEvalFlags(argv);
const numeric = (name: string, fallback: number) => flags.has(name) ? Number(flags.get(name)) : fallback;
const datasetPath = flags.get("dataset") ?? "evals/datasets/sre-v2/cases.json";

// Deliberately a plumbing fixture, not an evaluator or a source of quality claims.
function mockModel(): EvalModel {
  return { async call<T>(schema: z.ZodType<T>, _system: string, prompt: string): Promise<T> {
    const input = JSON.parse(prompt);
    if (Object.is(schema, DiagnosisSchema)) return schema.parse({ summary: "Offline fixture: insufficient evidence.", conclusion_status: "insufficient_evidence", severity: null, severity_reasoning: "Offline fixture does not diagnose.", root_causes: [], claims: [], mitigation_plan: [], missing_information: ["Live model and expert review"] });
    if (Object.is(schema, VerdictSchema)) {
      const score = { score: 3, reasoning: "Offline fixture only; not a quality assessment." };
      return schema.parse({ core: { specificity: score, safety: score, actionability: score, domain_correctness: score, completeness: score, overall_notes: "MOCK" }, root_cause_acceptable: !input.gold.sufficient, uncertainty_appropriate: true, prohibited_action: false, unsupported_claim_ids: [], critical_unsupported: false, reasoning: "MOCK: pipeline verification only." });
    }
    return schema.parse({ hypotheses: [], done: (input.evidence ?? []).some((e: { kind: string }) => e.kind !== "user_context"), tool: "get_metrics", query: "", reason: "Offline fixture read" });
  } };
}

async function main() {
  validateEvalFlags(command, flags, false);
  if (command === "validate") {
    const cases = loadDataset(datasetPath);
    console.log(JSON.stringify({ cases: cases.length, families: new Set(cases.map(c => c.family)).size, draft: cases.filter(c => c.gold.review_status === "draft").length, splits: Object.fromEntries(["dev", "validation", "test"].map(s => [s, cases.filter(c => c.split === s).length])) }, null, 2));
    return;
  }
  if (!["generate", "score", "report", "check", "run", "calibrate", "calibration-report"].includes(command)) throw new Error("Commands: validate, generate, score, report, check, run");
  const id = safeId(flags.get("id") ?? "");
  const root = join("evals/runs", id);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, ".lock");
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); } catch { throw new Error(`Run ${id} is locked. If its process stopped, inspect then remove ${lock}.`); }
  try {
    const store = new ArtifactStore(root);
    let manifest: Manifest;
    if (existsSync(join(root, "manifest.json"))) {
      validateEvalFlags(command, flags, true);
      manifest = store.manifest();
    }
    else {
      if (!["generate", "run"].includes(command)) throw new Error("Generate a run first");
      const mock = flags.has("mock");
      if (!mock && !flags.has("live")) throw new Error("Choose --mock or --live. Live runs require an explicit budget and prices.");
      if (mock && flags.has("live")) throw new Error("Choose only one execution mode");
      if (!mock) for (const name of ["max-usd", "input-price", "output-price", "judge-input-price", "judge-output-price", "model", "judge-model"]) if (!flags.has(name)) throw new Error(`Live run requires --${name}=...`);
      const split = flags.get("split") ?? "dev";
      if (!["dev", "validation", "test"].includes(split)) throw new Error("Invalid split");
      const count = numeric("limit", 6);
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Invalid limit");
      const cases = loadDataset(datasetPath).filter(c => c.split === split).slice(0, count);
      const protocol = JSON.parse(readFileSync("evals/protocol-v2.json", "utf8"));
      manifest = ManifestSchema.parse({ version: "eval-v2", engine_version: INVESTIGATION_ENGINE_VERSION, id, created_at: new Date().toISOString(), git_sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), source_hash: sourceHash(), dataset_hash: hash(cases), prompt_hash: hash({ diagnosis: DIAGNOSIS_PROMPT, planner: PLANNER_PROMPT }), schema_hash: hash({ diagnosis: z.toJSONSchema(DiagnosisSchema), decision: z.toJSONSchema(DecisionSchema) }), rubric_hash: hash(EVAL_JUDGE_PROMPT), policy_version: "impact-v2", thinking: "disabled", model: mock ? "mock" : flags.get("model"), judge_model: mock ? "mock" : flags.get("judge-model"), modes: (flags.get("modes") ?? "full,workflow,agentic").split(","), languages: (flags.get("languages") ?? "en").split(","), repeats: numeric("repeats", 1), seed: numeric("seed", 17), budget: { max_usd: numeric("max-usd", 1), max_minutes: numeric("max-minutes", 15), per_call_usd: numeric("per-call-usd", 0.25), max_calls: numeric("max-calls", 100), max_output_tokens: numeric("max-output-tokens", 3000), input_per_million: numeric("input-price", 0), output_per_million: numeric("output-price", 0), judge_input_per_million: numeric("judge-input-price", 0), judge_output_per_million: numeric("judge-output-price", 0) }, calibration: flags.has("calibration") ? CalibrationSchema.parse(JSON.parse(readFileSync(flags.get("calibration")!, "utf8"))) : null, case_ids: cases.map(c => c.id), ablation: flags.get("ablation") ?? "default", protocol });
      if (new Set(manifest.modes).size !== manifest.modes.length || new Set(manifest.languages).size !== manifest.languages.length) throw new Error("Duplicate mode or language");
      writeJson(join(root, "dataset.json"), cases);
      store.initialize(manifest, plannedTrials(manifest, cases));
    }
    const cases = validateDataset(JSON.parse(readFileSync(join(root, "dataset.json"), "utf8")));
    if (hash(cases) !== manifest.dataset_hash) throw new Error("Dataset snapshot changed");
    if (["run", "generate"].includes(command) && manifest.source_hash !== sourceHash()) throw new Error("Source changed. Create a new run; report/check can still replay the saved artifacts.");
    if (flags.has("mock") && manifest.model !== "mock" || flags.has("live") && manifest.model === "mock") throw new Error("Execution mode differs from manifest");
    const plans = plannedTrials(manifest, cases);
    // Readers must not recreate missing trial artifacts.
    const ledgerPath = join(root, "ledger.json");
    const ledger: LedgerEntry[] = store.ledger();
    const budget = new Budget(manifest.budget, ledger, () => writeJson(ledgerPath, ledger));
    const judgeRun = safeId(flags.get("judge-run") ?? "primary");
    const scoringManifest = ManifestSchema.parse({ ...manifest, judge_model: flags.get("judge-model") ?? manifest.judge_model, budget: { ...manifest.budget, judge_input_per_million: numeric("judge-input-price", manifest.budget.judge_input_per_million), judge_output_per_million: numeric("judge-output-price", manifest.budget.judge_output_per_million) } });
    if (scoringManifest.judge_model !== manifest.judge_model && (!flags.has("judge-input-price") || !flags.has("judge-output-price"))) throw new Error("Changing judge requires explicit judge token prices");
    const judgeConfigPath = join(root, "judgments", judgeRun, "config.json");
    const judgeConfig = { model: scoringManifest.judge_model, prompt_hash: hash(EVAL_JUDGE_PROMPT), thinking: scoringManifest.thinking, input_price: scoringManifest.budget.judge_input_per_million, output_price: scoringManifest.budget.judge_output_per_million };
    if (["score", "run", "calibrate"].includes(command)) {
      if (existsSync(judgeConfigPath) && hash(JSON.parse(readFileSync(judgeConfigPath, "utf8"))) !== hash(judgeConfig)) throw new Error("Judge configuration changed; choose a new --judge-run");
      writeJson(judgeConfigPath, judgeConfig);
    }
    const scoreOne = async (trial: Trial, c: typeof cases[number]) => {
      const calls: CallUsage[] = [];
      const owner = `${judgeRun}_${trial.id}`;
      let judgment: Judgment;
      const model = scoringManifest.judge_model === "mock" ? mockModel() : liveModel(scoringManifest, owner, budget, usage => calls.push(usage));
      try {
        if (ledger.some(e => e.owner === owner)) {
          calls.push(...recoveredUsage(ledger, owner, scoringManifest.judge_model));
          throw new Error("Interrupted scoring attempt exists; choose a new judge-run to retry explicitly");
        }
        judgment = await scoreTrial(trial, c, judgeRun, scoringManifest.judge_model, model);
      } catch (error) {
        judgment = { trial_id: trial.id, judge_run_id: judgeRun, trial_hash: hash(trial), judge_model: scoringManifest.judge_model, prompt_hash: hash(EVAL_JUDGE_PROMPT), status: "failed", verdict: null, calls: [], failure: safeErrorDetail(error) };
      }
      judgment.calls = calls; store.saveJudgment(judgment); return judgment;
    };
    if (["calibrate", "calibration-report"].includes(command)) {
      const packPath = join(root, "calibration", "pack.json");
      const pack = calibrationPack();
      if (existsSync(packPath) && hash(JSON.parse(readFileSync(packPath, "utf8"))) !== hash(pack)) throw new Error("Calibration pack changed; create a new run");
      writeJson(packPath, pack);
      const templatePath = join(root, "calibration", "review-template.json");
      if (!existsSync(templatePath)) writeJson(templatePath, pack.map(s => ({ sample_id: s.id, evidence: s.trial.evidence, response: s.trial.diagnosis, unsupported: null, reviewer: "", notes: "" })));
      if (command === "calibrate") for (const sample of pack) if (!store.judgment(sample.id, judgeRun)) await scoreOne(sample.trial, sample.case);
      const reviewPath = join(root, "calibration", "reviews.json");
      const reviews = existsSync(reviewPath) ? ReviewsSchema.parse(JSON.parse(readFileSync(reviewPath, "utf8"))) : [];
      const judgments = pack.map(s => store.judgment(s.id, judgeRun)).filter((j): j is Judgment => j !== null);
      if (!existsSync(judgeConfigPath)) throw new Error("No saved calibration judge configuration; run calibrate first");
      const calibrationConfig = JSON.parse(readFileSync(judgeConfigPath, "utf8"));
      const summary = summarizeCalibration(pack, judgments, reviews, calibrationConfig.model, calibrationConfig.model === "mock" ? "mock" : "live", calibrationConfig.prompt_hash);
      writeJson(join(root, "calibration", `summary-${judgeRun}.json`), summary);
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (["generate", "run"].includes(command)) for (const plan of plans) {
      if (!existsSync(store.trialPath(plan.id))) throw new Error(`Missing trial artifact ${plan.id}; restore the original or create a new run. Reports retain it in the denominator.`);
      const trial = store.trial(plan.id);
      if (trial.status === "running") {
        trial.status = "interrupted";
        trial.calls = recoveredUsage(ledger, trial.id, manifest.model);
        trial.failure = "Previous process stopped; retained reservations. Use a new run to retry explicitly."; store.saveTrial(trial);
      }
      if (trial.status !== "pending") continue;
      trial.status = "running"; store.saveTrial(trial);
      const started = Date.now();
      const model = manifest.model === "mock" ? mockModel() : liveModel(manifest, trial.id, budget, usage => { trial.calls.push(usage); store.saveTrial(trial); });
      try {
        await generateTrial(trial, cases.find(c => c.id === trial.case_id)!, manifest, model, () => store.saveTrial(trial));
        trial.status = "succeeded";
      } catch (error) {
        trial.status = error instanceof BudgetExceeded ? "budget_skipped" : "failed";
        trial.failure = safeErrorDetail(error); trial.stop_reason = error instanceof BudgetExceeded ? "budget_cap" : "error";
      }
      trial.elapsed_ms = Date.now() - started; store.saveTrial(trial);
      console.log(`${trial.id}: ${trial.status}`);
    }
    if (["score", "run"].includes(command)) for (const plan of plans) {
      const trial = store.trialOrMissing(plan);
      if (trial.status !== "succeeded" || store.judgment(trial.id, judgeRun)) continue;
      await scoreOne(trial, cases.find(c => c.id === trial.case_id)!);
    }
    if (["report", "run", "check"].includes(command)) {
      const trials: Trial[] = plans.map(p => store.trialOrMissing(p));
      const judgments = trials.map(t => store.judgment(t.id, judgeRun)).filter((j): j is Judgment => j !== null);
      const savedJudgeConfig = existsSync(judgeConfigPath) ? JSON.parse(readFileSync(judgeConfigPath, "utf8")) : judgeConfig;
      const reportingManifest = { ...manifest, judge_model: savedJudgeConfig.model, rubric_hash: savedJudgeConfig.prompt_hash };
      const report = { ...buildReport(reportingManifest, cases, trials, judgments, ledger), execution: manifest.model === "mock" ? "mock" : "live", judge_run: judgeRun, versions: { evaluator: sourceHash(), dataset: manifest.dataset_hash, source: manifest.source_hash, prompt: manifest.prompt_hash, rubric: savedJudgeConfig.prompt_hash, model: manifest.model, judge: savedJudgeConfig.model, policy: manifest.policy_version } };
      writeJson(join(root, `report-${judgeRun}-${hash(report)}.json`), report);
      writeJson(join(root, `report-${judgeRun}.json`), report);
      writeFileSync(join(root, `report-${judgeRun}.md`), reportMarkdown(report));
      console.log(JSON.stringify({ run: id, execution: report.execution, gate: report.gate, modes: report.modes }, null, 2));
      if (flags.has("export-public")) {
        if (cases.some(c => c.provenance !== "synthetic")) throw new Error("Only synthetic aggregate reports can be exported by this command");
        writeJson("evals/public/latest.json", report);
      }
      if (command === "check") process.exitCode = report.execution === "mock" ? 4 : ({ passed: 0, regression: 1, incomplete: 2, inconclusive: 3 }[report.gate]);
    }
  } finally { closeSync(fd); unlinkSync(lock); }
}
main().catch(error => { console.error(safeErrorDetail(error)); process.exitCode = 2; });
