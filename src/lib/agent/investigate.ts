import { generateText, Output } from "ai";
import { z } from "zod";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { getScenario } from "@/lib/scenarios";
import type { OutputLanguage } from "@/lib/prompts";
import { normalizeUsage, calcCost } from "@/lib/cost";
import type { TelemetryAdapter } from "./tools";
import { alertEvidence, conclusionEvidence } from "./evidence";
import { runInvestigation, INVESTIGATION_ENGINE_VERSION, type InvestigationModel, type InvestigationState } from "./runtime";
import { presentDiagnosis } from "./presentation";
import type { InvestigationInput, InvestigationResult, TraceStep, UsageTotals } from "./types";

export type InvestigateOptions = {
  input: InvestigationInput;
  language?: OutputLanguage;
  model?: string;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  adapter?: TelemetryAdapter;
  allowInternalKb?: boolean;
  // Injection points for deterministic production replays; never exposed as HTTP inputs.
  modelClient?: InvestigationModel;
  alertAt?: string;
  onCheckpoint?: (state: InvestigationState) => void;
};

export function evidenceTranscript(trace: TraceStep[]): string {
  const ok = trace.filter(s => s.status === "ok" || s.status === "empty");
  return ok.length ? ok.map(s => `## [step ${s.index}] ${s.tool}(${JSON.stringify(s.input)})\n${s.observation}`).join("\n\n") : "(no tool evidence was gathered)";
}

export async function investigate(opts: InvestigateOptions): Promise<InvestigationResult> {
  const scenario = opts.input.scenarioSlug ? getScenario(opts.input.scenarioSlug) : undefined;
  if (opts.input.scenarioSlug && !scenario) throw new Error("Unknown investigation scenario");
  const input = { ...opts.input, service: scenario?.service ?? opts.input.service, symptoms: opts.input.symptoms || scenario?.symptoms };
  const language = opts.language ?? "en", model = opts.model ?? ANALYSIS_MODEL;
  const at = opts.alertAt ?? new Date().toISOString();
  const alert = { service: input.service || "unknown", symptoms: input.symptoms || "No symptoms provided", at };
  const usage: UsageTotals = { model_calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  const client: InvestigationModel = opts.modelClient ?? {
    async call<T>(schema: z.ZodType<T>, system: string, prompt: string): Promise<T> {
      opts.abortSignal?.throwIfAborted();
      const result = await generateText({ model: deepseek(model), output: Output.object({ schema }), system, prompt,
        temperature: 0, maxRetries: 0, maxOutputTokens: 3000, abortSignal: opts.abortSignal,
        providerOptions: { deepseek: { thinking: { type: "disabled" } } } });
      const tokens = normalizeUsage(result.totalUsage);
      usage.model_calls++;
      usage.tokens_in += tokens.tokens_in; usage.tokens_out += tokens.tokens_out;
      usage.cost_usd += calcCost(model, tokens.tokens_in, tokens.tokens_out) ?? 0;
      return schema.parse(result.output);
    },
  };
  const result = await runInvestigation({ input, alert, model: client, language,
    initialEvidence: [alertEvidence(alert), ...conclusionEvidence(input, [], at)],
    adapter: opts.adapter, allowInternalKb: opts.allowInternalKb, abortSignal: opts.abortSignal,
    maxSteps: opts.maxSteps, onCheckpoint: opts.onCheckpoint });
  return { analysis: presentDiagnosis(result.diagnosis, result.stop_reason), diagnosis: result.diagnosis,
    engine_version: INVESTIGATION_ENGINE_VERSION, trace: result.trace, evidence: result.evidence,
    decisions: result.decisions, usage, steps: result.steps, completed: result.stop_reason === "model_done",
    stop_reason: result.stop_reason, language };
}
