// The agentic investigator — a HAND-WRITTEN tool-use loop.
//
// This is the heart of the harness. The control of the loop lives here, not in
// the AI SDK: we call the model for ONE turn at a time (generateText with tools
// that have no `execute`, so it returns tool calls and stops), then WE dispatch
// the tools, WE trim and append the observations, WE decide whether to continue,
// and WE produce the final structured output. No maxSteps, no stopWhen, no
// SDK-run loop. If you want to know what the harness does, read this `while`.
//
// Phases:
//   1. INVESTIGATE (loop): model ↔ read-only tools, until it's confident,
//      stops making progress, or hits the step cap.
//   2. CONCLUDE (one call): feed the gathered evidence to generateObject and
//      emit the 9-section AnalysisSchema the rest of the app already speaks.

import { generateText, generateObject, type ModelMessage } from "ai";
import { deepseek, ANALYSIS_MODEL } from "@/lib/ai";
import { AnalysisSchema } from "@/lib/schema";
import { getSystemPrompt, DEFAULT_PROMPT_VERSION, type OutputLanguage, type PromptVersion } from "@/lib/prompts";
import { normalizeUsage, calcCost } from "@/lib/cost";
import { safeErrorDetail } from "@/lib/observability";
import { buildToolDefs, dispatchTool, ALLOWED_TOOLS, type DispatchContext } from "./tools";
import { Scratchpad } from "./state";
import type { InvestigationInput, InvestigationResult, TraceStep, UsageTotals } from "./types";

export type InvestigateOptions = {
  input: InvestigationInput;
  language?: OutputLanguage;
  promptVersion?: PromptVersion;
  model?: string;
  maxSteps?: number; // hard cap on model-loop iterations
  abortSignal?: AbortSignal;
};

const DEFAULT_MAX_STEPS = 8;

function investigatorSystem(input: InvestigationInput): string {
  const toolsLine = ALLOWED_TOOLS.join(", ");
  const dataNote = input.scenarioSlug
    ? "You do NOT have the full incident dump. You must DISCOVER the evidence by calling tools — each returns one slice (metrics, logs, deploys, runbooks)."
    : "Structured telemetry tools may return nothing for this incident; lean on the raw context in the task and on search_runbooks.";
  return `You are a Senior Site Reliability Engineer running a live incident investigation. You work by gathering evidence with read-only tools, one step at a time, like a real on-call engineer at a terminal.

Available read-only tools: ${toolsLine}.

${dataNote}

How to investigate:
- Form a hypothesis, then call the tool that would confirm or kill it. Correlate metrics with deploys and logs — the cause is usually a recent change.
- Beware misleading signals (e.g. healthy CPU while connections are exhausted). Check more than one slice before concluding.
- You are STRICTLY READ-ONLY. You diagnose and recommend; you never change production. If you try to call a write/mutating tool it will be refused — recommend that action in your final mitigation plan instead.
- When you can name a root cause with evidence (or have ruled out the obvious hypotheses), STOP calling tools and reply in plain text with: the likely root cause, the key evidence you found, and what you'd still want to check. Do not pad the investigation with redundant calls.`;
}

function taskMessage(input: InvestigationInput): string {
  // The "alert" the on-call engineer wakes up to. For scenarios we deliberately
  // withhold the full context blob so the agent must use tools to discover it.
  const lines = [
    "# Incident alert",
    `Affected service: ${input.service || "(unknown — discover it)"}`,
    `Reported symptoms: ${input.symptoms || "(none provided)"}`,
  ];
  if (!input.scenarioSlug && input.raw_context) {
    lines.push("", "Raw context provided with the alert:", "```", input.raw_context, "```");
  }
  lines.push("", "Investigate and find the root cause. Start by gathering evidence with your tools.");
  return lines.join("\n");
}

function accumulate(into: UsageTotals, usage: Parameters<typeof normalizeUsage>[0], model: string): void {
  const { tokens_in, tokens_out } = normalizeUsage(usage);
  into.model_calls += 1;
  into.tokens_in += tokens_in;
  into.tokens_out += tokens_out;
  const c = calcCost(model, tokens_in, tokens_out);
  if (c != null) into.cost_usd += c;
}

// Render the gathered evidence as the input to the final structured-output call.
// Exported so the evidence-grounding judge can score claims against it.
export function evidenceTranscript(trace: TraceStep[]): string {
  const ok = trace.filter((s) => s.status === "ok" || s.status === "empty");
  if (ok.length === 0) return "(no tool evidence was gathered)";
  return ok
    .map((s) => `## [step ${s.index}] ${s.tool}(${JSON.stringify(s.input)})\n${s.observation}`)
    .join("\n\n");
}

export async function investigate(opts: InvestigateOptions): Promise<InvestigationResult> {
  const { input } = opts;
  const language: OutputLanguage = opts.language ?? "en";
  const promptVersion = opts.promptVersion ?? DEFAULT_PROMPT_VERSION;
  const model = opts.model ?? ANALYSIS_MODEL;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const tools = buildToolDefs();
  const scratch = new Scratchpad();
  const dctx: DispatchContext = { ctx: input, callCounts: {}, abortSignal: opts.abortSignal };
  const trace: TraceStep[] = [];
  const usage: UsageTotals = { model_calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };

  const messages: ModelMessage[] = [{ role: "user", content: taskMessage(input) }];

  let steps = 0;
  let stopReason: InvestigationResult["stop_reason"] = "step_cap";
  let completed = false;
  let roundsWithoutNewEvidence = 0;

  // ── PHASE 1: the hand-written investigation loop ──────────────────────
  while (steps < maxSteps) {
    steps += 1;

    const system = `${investigatorSystem(input)}\n\n${scratch.render({ stepsUsed: steps, stepCap: maxSteps })}`;

    let turn;
    try {
      turn = await generateText({
        model: deepseek(model),
        system,
        messages,
        tools,
        toolChoice: "auto",
        temperature: 0.2,
        abortSignal: opts.abortSignal,
      });
    } catch (err) {
      if (opts.abortSignal?.aborted) throw err;
      // Recovery: a model/transport error shouldn't kill the run. Stop the loop
      // and let phase 2 produce a best-effort conclusion from what we have.
      const msg = safeErrorDetail(err);
      trace.push({ index: steps, tool: "(model)", input: {}, status: "error", observation: `Model call failed: ${msg}`, reason: "model_error", latency_ms: 0 });
      stopReason = "no_progress";
      break;
    }
    accumulate(usage, turn.usage, model);

    const toolCalls = turn.toolCalls ?? [];

    // No tool calls → the model gave a final text answer. Investigation done.
    if (toolCalls.length === 0) {
      stopReason = "model_done";
      completed = true;
      // Keep the model's closing reasoning so phase 2 can use it.
      if (turn.text?.trim()) {
        messages.push({ role: "assistant", content: turn.text });
      }
      break;
    }

    // Append the assistant turn (with its tool calls) verbatim, so the next
    // model call sees a well-formed transcript.
    messages.push(...turn.response.messages);

    // Dispatch every tool call through the control gate, collect results.
    const toolResultParts: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: { type: "text"; value: string } }> = [];
    let newEvidenceThisRound = 0;

    for (const call of toolCalls) {
      const callInput = (call.input ?? {}) as Record<string, unknown>;

      // Cheap guard: if the model repeats an exact prior call, short-circuit
      // with a nudge instead of burning the handler again.
      let step: TraceStep;
      if (scratch.isDuplicate(call.toolName, callInput)) {
        step = {
          index: trace.length + 1,
          tool: call.toolName,
          input: callInput,
          status: "empty",
          observation: `You already ran ${call.toolName}(${JSON.stringify(callInput)}) — see the investigation state. Use that result or try a different query.`,
          reason: "duplicate",
          latency_ms: 0,
        };
      } else {
        step = await dispatchTool(trace.length + 1, call.toolName, callInput, dctx);
      }

      trace.push(step);
      scratch.record(step);
      if (step.status === "ok") newEvidenceThisRound += 1;

      toolResultParts.push({
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "text", value: step.observation },
      });
    }

    // Feed every observation back in a single tool message.
    messages.push({ role: "tool", content: toolResultParts });

    // No-progress detection: two consecutive rounds that surfaced no new
    // confirmed evidence → stop and conclude with what we have.
    if (newEvidenceThisRound === 0) {
      roundsWithoutNewEvidence += 1;
      if (roundsWithoutNewEvidence >= 2) {
        stopReason = "no_progress";
        break;
      }
    } else {
      roundsWithoutNewEvidence = 0;
    }
  }

  // ── PHASE 2: conclude — emit the 9-section structured analysis ────────
  const investigationNote = completed
    ? "You investigated this incident with read-only tools. Base your analysis ONLY on the evidence you actually gathered below — do not invent metrics or log lines that are not present."
    : `The investigation was CUT SHORT (stop reason: ${stopReason}) before you were fully confident. Produce a best-effort analysis from the evidence gathered so far, and in \`summary\` explicitly note that the investigation was incomplete and what remains unverified.`;

  const finalSystem = `${getSystemPrompt(promptVersion)}\n\n# Evidence discipline\n${investigationNote}`;
  const finalPrompt = `# Incident
Affected service: ${input.service || "(unknown)"}
Reported symptoms: ${input.symptoms || "(none)"}

# Evidence gathered during investigation
${evidenceTranscript(trace)}

Now produce the structured 9-section incident response based on this evidence.${language === "zh" ? "\n\n(Write narrative fields in Simplified Chinese; keep commands, enums, and identifiers in English.)" : ""}`;

  let analysis;
  try {
    const r = await generateObject({
      model: deepseek(model),
      schema: AnalysisSchema,
      system: finalSystem,
      prompt: finalPrompt,
      temperature: 0.2,
      abortSignal: opts.abortSignal,
    });
    analysis = r.object;
    accumulate(usage, r.usage, model);
  } catch (err) {
    // Retry once on parse error (DeepSeek JSON mode is occasionally invalid).
    const msg = err instanceof Error ? err.message : String(err);
    if (!/parse|invalid json|schema|JSON/i.test(msg)) throw err;
    const r = await generateObject({
      model: deepseek(model),
      schema: AnalysisSchema,
      system: finalSystem,
      prompt: finalPrompt,
      temperature: 0.2,
      abortSignal: opts.abortSignal,
    });
    analysis = r.object;
    accumulate(usage, r.usage, model);
  }

  return { analysis, trace, usage, steps, completed, stop_reason: stopReason, language };
}
