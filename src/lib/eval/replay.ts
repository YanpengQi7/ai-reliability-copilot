import { z } from "zod";
import { investigate } from "../agent/investigate";
import { DecisionSchema, DiagnosisSchema } from "../agent/diagnosis";
import { DIAGNOSIS_PROMPT, PLANNER_PROMPT } from "../agent/diagnosisPrompt";
import { INVESTIGATION_ENGINE_VERSION, type InvestigationModel } from "../agent/runtime";
import { hash } from "./artifacts";
import { FixtureAdapter, visibleEvidence } from "./dataset";
import { plannedTrials } from "./engine";
import type { EvalCase, Manifest, Trial } from "./contracts";

/** Re-run a saved agentic trial through the web entry point, without provider calls. */
export async function replayProductionTrial(manifest: Manifest, cases: EvalCase[], trial: Trial) {
  if (manifest.engine_version !== INVESTIGATION_ENGINE_VERSION) throw new Error("Replay requires a current shared-engine run; use the recorded source version for historical runs");
  if (manifest.prompt_hash !== hash({ diagnosis: DIAGNOSIS_PROMPT, planner: PLANNER_PROMPT })) throw new Error("Investigation prompts changed; use the recorded source version");
  if (manifest.schema_hash !== hash({ diagnosis: z.toJSONSchema(DiagnosisSchema), decision: z.toJSONSchema(DecisionSchema) })) throw new Error("Investigation schemas changed; use the recorded source version");
  if (hash(cases) !== manifest.dataset_hash) throw new Error("Dataset snapshot changed");
  const plan = plannedTrials(manifest, cases).find(p => p.id === trial.id);
  if (!plan || ["case_id", "family", "mode", "language", "repeat", "input"].some(k => hash(trial[k as keyof Trial]) !== hash(plan[k as keyof Trial]))) throw new Error("Trial assignment differs from manifest");
  if (trial.mode !== "agentic" || manifest.ablation !== "default" || trial.status !== "succeeded" || !trial.diagnosis) throw new Error("Production replay requires a completed, default agentic trial");
  const c = cases.find(c => c.id === trial.case_id)!;
  const decisions = trial.decisions ?? [];
  let cursor = 0, conclusions = 0;
  const model: InvestigationModel = { async call(schema) {
    if (Object.is(schema, DecisionSchema)) {
      if (cursor >= decisions.length) throw new Error("Replay exhausted recorded planner responses");
      return schema.parse(decisions[cursor++]);
    }
    if (!Object.is(schema, DiagnosisSchema) || cursor !== decisions.length || conclusions++) throw new Error("Replay call sequence differs from recording");
    return schema.parse(trial.diagnosis);
  } };
  const result = await investigate({ input: { service: c.alert.service, symptoms: c.alert.symptoms, raw_context: "" },
    alertAt: c.alert.at, language: trial.language, adapter: new FixtureAdapter(visibleEvidence(c), c.alert.at),
    modelClient: model, allowInternalKb: false });
  const trace = result.trace.map(s => ({ tool: s.tool, input: s.input, evidence_ids: s.evidence?.map(e => e.id) ?? [], observation: s.observation, status: s.status, reason: s.reason }));
  const recordedTrace = trial.trace.map(s => ({ tool: s.tool, input: s.input, evidence_ids: s.evidence_ids, observation: s.observation, status: s.status, reason: s.reason }));
  if (cursor !== decisions.length || conclusions !== 1 || hash(trace) !== hash(recordedTrace) || hash(result.evidence) !== hash(trial.evidence) || hash(result.diagnosis) !== hash(trial.diagnosis) || result.stop_reason !== trial.stop_reason) throw new Error("Production replay differs from recorded investigation");
  return result;
}
