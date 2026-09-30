import { z } from "zod";
import { DecisionSchema, DiagnosisSchema, type Decision, type Diagnosis } from "./diagnosis";
import { DIAGNOSIS_PROMPT, PLANNER_PROMPT } from "./diagnosisPrompt";
import { conclusionEvidence, formatEvidence, mergeEvidence, type EvidenceItem } from "./evidence";
import { dispatchTool, type DispatchContext, type TelemetryAdapter } from "./tools";
import { Scratchpad } from "./state";
import { checkDiagnosis, DiagnosisValidationError } from "./diagnosisValidation";
import type { InvestigationInput, TraceStep } from "./types";

export const INVESTIGATION_ENGINE_VERSION = "shared-investigator-v2";
export interface InvestigationModel {
  call<T>(schema: z.ZodType<T>, system: string, prompt: string, purpose: "generation"): Promise<T>;
}
export type InvestigationState = {
  evidence: EvidenceItem[]; trace: TraceStep[]; decisions: Decision[]; steps: number;
  stop_reason: "single_pass" | "model_done" | "step_cap" | "no_progress";
};
export type RuntimeOptions = {
  input: InvestigationInput;
  alert: { service: string; symptoms: string; at: string };
  model: InvestigationModel;
  language?: "en" | "zh";
  mode?: "alert" | "full" | "workflow" | "agentic";
  initialEvidence: EvidenceItem[];
  fullEvidence?: EvidenceItem[];
  adapter?: TelemetryAdapter;
  allowInternalKb?: boolean;
  abortSignal?: AbortSignal;
  maxSteps?: number;
  useState?: boolean;
  onCheckpoint?: (state: InvestigationState) => void;
};

/** Production and replay use exactly this planner, read policy and diagnosis call. */
export async function runInvestigation(opts: RuntimeOptions): Promise<InvestigationState & { diagnosis: Diagnosis }> {
  const maxSteps = opts.maxSteps ?? 8;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new Error("maxSteps must be an integer from 1 to 12");
  const mode = opts.mode ?? "agentic", language = opts.language ?? "en";
  const state: InvestigationState = { evidence: mergeEvidence(opts.initialEvidence), trace: [], decisions: [], steps: 0, stop_reason: "single_pass" };
  const context: DispatchContext = { ctx: opts.input, callCounts: {}, adapter: opts.adapter, allowInternalKb: opts.allowInternalKb, abortSignal: opts.abortSignal };
  const scratch = new Scratchpad();
  const checkpoint = () => opts.onCheckpoint?.(structuredClone(state));
  // Timing belongs in telemetry, not model context: replays must use stable inputs.
  const promptTrace = (trace: TraceStep[]) => trace.map(s => ({ index: s.index, tool: s.tool, input: s.input, status: s.status, observation: s.observation, reason: s.reason, evidence_ids: s.evidence?.map(e => e.id) ?? [] }));
  const read = async (tool: string, input: Record<string, unknown>) => {
    opts.abortSignal?.throwIfAborted();
    const step: TraceStep = scratch.isDuplicate(tool, input)
      ? { index: state.trace.length + 1, tool, input, status: "empty", reason: "duplicate", observation: "Duplicate call refused; reuse prior evidence or change the query.", latency_ms: 0 }
      : await dispatchTool(state.trace.length + 1, tool, input, context);
    scratch.record(step);
    const before = new Set(state.evidence.map(e => e.content_hash));
    state.trace.push(step);
    // Scenario handlers have text observations; freeze those with stable IDs and time.
    state.evidence = mergeEvidence(opts.initialEvidence, conclusionEvidence({ ...opts.input, raw_context: "" }, state.trace, opts.alert.at));
    checkpoint();
    return state.evidence.filter(e => !before.has(e.content_hash)).length;
  };
  opts.abortSignal?.throwIfAborted();
  if (mode === "full") state.evidence = mergeEvidence(state.evidence, opts.fullEvidence ?? []);
  if (mode === "workflow") {
    for (const tool of ["get_metrics", "get_logs", "get_deploy_history", "search_runbooks"]) await read(tool, tool === "search_runbooks" ? { query: opts.alert.service, limit: 4 } : { service: opts.alert.service });
  }
  if (mode === "agentic") {
    state.stop_reason = "step_cap";
    let stalled = 0;
    for (let step = 0; step < maxSteps; step++) {
      opts.abortSignal?.throwIfAborted();
      state.steps++;
      const plan = DecisionSchema.parse(await opts.model.call(DecisionSchema,
        PLANNER_PROMPT,
        JSON.stringify({ alert: opts.alert, language, evidence: state.evidence, history: promptTrace(state.trace), ...(opts.useState !== false ? { hypotheses: state.decisions.at(-1)?.hypotheses ?? [] } : {}) }), "generation"));
      opts.abortSignal?.throwIfAborted();
      const ids = new Set(state.evidence.map(e => e.id));
      if (plan.hypotheses.some(h => [...h.supporting_ids, ...h.refuting_ids].some(id => !ids.has(id)))) throw new Error("Planner cited evidence it has not seen");
      state.decisions.push(plan);
      checkpoint();
      if (plan.done) { state.stop_reason = "model_done"; break; }
      const input = plan.tool === "search_runbooks" ? { query: plan.query || opts.alert.service, limit: 4 } : plan.tool === "get_metrics" ? { service: opts.alert.service, filter: plan.query } : plan.tool === "get_logs" ? { service: opts.alert.service, query: plan.query, limit: 12 } : { service: opts.alert.service };
      const found = await read(plan.tool, input);
      stalled = found ? 0 : stalled + 1;
      if (stalled >= 2) { state.stop_reason = "no_progress"; break; }
    }
  }
  checkpoint();
  opts.abortSignal?.throwIfAborted();
  const limitations = state.trace.filter(s => s.status !== "ok" || s.reason === "observation_budget");
  const diagnosis = DiagnosisSchema.parse(await opts.model.call(DiagnosisSchema, DIAGNOSIS_PROMPT,
    JSON.stringify({ alert: opts.alert, evidence: formatEvidence(state.evidence), language, stop_reason: state.stop_reason,
      limitations: promptTrace(limitations), ...(opts.useState !== false ? { hypotheses: state.decisions.at(-1)?.hypotheses } : {}) }), "generation"));
  opts.abortSignal?.throwIfAborted();
  const issues = checkDiagnosis(diagnosis, state.evidence);
  if (issues.length) throw new DiagnosisValidationError(diagnosis, issues);
  return { ...state, diagnosis };
}
