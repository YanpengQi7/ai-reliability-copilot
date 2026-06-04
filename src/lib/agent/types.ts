// Shared types for the agentic investigator.
//
// The investigator is a hand-written tool-use loop (see investigate.ts). These
// types describe the inputs it takes, the trace it emits, and the final result.

import type { Analysis } from "@/lib/schema";
import type { OutputLanguage } from "@/lib/prompts";

// What the agent investigates. Either a curated scenario (tools read its typed
// signals) or a free-form incident (tools fall back to the raw_context only —
// metrics/logs/deploys tools have nothing structured to return, which is itself
// honest signal to the model).
export type InvestigationInput = {
  service?: string;
  symptoms?: string;
  raw_context: string;
  // When present, tools serve this scenario's structured signals.
  scenarioSlug?: string;
};

// One observation the agent made: the tool it called, what it asked for, and
// what came back (or why it was refused). This is the artifact the trace UI
// renders and the evidence-grounding judge reads.
export type TraceStep = {
  index: number; // 1-based step number in the loop
  tool: string;
  input: Record<string, unknown>;
  // 'ok' = executed; 'refused' = blocked by the control gate;
  // 'error' = handler threw; 'empty' = executed but returned no data.
  status: "ok" | "refused" | "error" | "empty";
  observation: string; // the text the model saw (already budget-trimmed)
  reason?: string; // for refused/error: why
  latency_ms: number;
};

export type UsageTotals = {
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
};

export type InvestigationResult = {
  analysis: Analysis;
  trace: TraceStep[];
  usage: UsageTotals;
  steps: number; // model-loop iterations actually run
  completed: boolean; // false = hit step cap / budget cap before the model was done
  stop_reason: "model_done" | "step_cap" | "no_progress" | "budget_cap";
  language: OutputLanguage;
};
