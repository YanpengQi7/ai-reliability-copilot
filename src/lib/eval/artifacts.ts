import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ManifestSchema, TrialSchema, JudgmentSchema, type Manifest, type Trial, type Judgment } from "./contracts";
import { LedgerSchema } from "./accounting";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid artifact ID");
  return id;
}
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
export function readJson<T>(path: string, schema: z.ZodType<T>): T { return schema.parse(JSON.parse(readFileSync(path, "utf8"))); }
export class ArtifactStore {
  constructor(readonly root: string) {}
  manifest(): Manifest { return readJson(join(this.root, "manifest.json"), ManifestSchema); }
  ledger() {
    const path = join(this.root, "ledger.json");
    if (!existsSync(path)) throw new Error("Spending ledger is missing; restore the original ledger or create a new run. Prior spending cannot be assumed to be zero.");
    return readJson(path, LedgerSchema);
  }
  initialize(manifest: Manifest, trials: Trial[]) {
    const path = join(this.root, "manifest.json");
    if (existsSync(path)) {
      if (hash(this.manifest()) !== hash(manifest)) throw new Error("Manifest mismatch; create a new run");
      return; // Never recreate missing artifacts in an existing experiment.
    }
    const value = ManifestSchema.parse(manifest);
    const ledgerPath = join(this.root, "ledger.json");
    if (existsSync(ledgerPath)) throw new Error("Ledger exists without a manifest; initialization is incomplete. Restore the original run or use a new run ID.");
    // An interrupted initialization must never leave a usable manifest without accounting.
    writeJson(ledgerPath, []);
    writeJson(path, value);
    for (const trial of trials) if (!existsSync(this.trialPath(trial.id))) this.saveTrial(trial);
  }
  trialPath(id: string) { return join(this.root, "trials", `${safeId(id)}.json`); }
  trial(id: string) { return readJson(this.trialPath(id), TrialSchema); }
  trialOrMissing(plan: Trial): Trial {
    return existsSync(this.trialPath(plan.id)) ? this.trial(plan.id) : { ...plan, stop_reason: "missing_artifact", failure: "Trial artifact is missing; no generation was attempted by this reader." };
  }
  saveTrial(trial: Trial) {
    const value = TrialSchema.parse(trial), path = this.trialPath(trial.id);
    if (existsSync(path)) {
      const previous = this.trial(trial.id);
      if (!["pending", "running"].includes(previous.status)) {
        if (hash(previous) !== hash(value)) throw new Error("Finished trial is immutable; create a new run");
        return;
      }
    }
    writeJson(path, value);
  }
  judgmentPath(id: string, judgeRun: string) { return join(this.root, "judgments", safeId(judgeRun), `${safeId(id)}.json`); }
  saveJudgment(j: Judgment) {
    const value = JudgmentSchema.parse(j), previous = this.judgment(j.trial_id, j.judge_run_id);
    if (previous) {
      if (hash(previous) !== hash(value)) throw new Error("Judgment is immutable; choose a new judge-run");
      return;
    }
    writeJson(this.judgmentPath(j.trial_id, j.judge_run_id), value);
  }
  judgment(id: string, judgeRun: string): Judgment | null {
    const p = this.judgmentPath(id, judgeRun);
    return existsSync(p) ? readJson(p, JudgmentSchema) : null;
  }
}
