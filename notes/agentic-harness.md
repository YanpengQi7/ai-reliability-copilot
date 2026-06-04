# From single-shot analyzer to agentic investigator

How the `ai-reliability-copilot` grew a *hand-written* harness, and how to run/measure it.

## The one rule we kept

**The loop is ours, not the SDK's.** No `maxSteps`, no `stopWhen`, no `generateText`
auto-tool-loop. The single model call inside each iteration uses the AI SDK; the
control of the loop — tool dispatch, context trimming, termination, recovery — is
hand-written in [`src/lib/agent/investigate.ts`](../src/lib/agent/investigate.ts).
If you want to know what the harness does, read that `while`.

The trick that makes it clean: `generateText` with tools that have **no `execute`**
function returns the model's tool calls and *stops*. We run the tools ourselves,
append the observations, and call the model again. The SDK never runs the loop.

## Architecture

```
alert (service + symptoms only — NOT the full incident dump)
        │
        ▼
┌─ PHASE 1: investigate (hand-written while-loop, ≤8 steps) ─────────────┐
│  generateText(tools, no execute)  →  tool calls                        │
│        │                                                               │
│        ▼   control gate (dispatch layer)                               │
│   get_metrics / get_logs / get_deploy_history / search_runbooks  (RO)  │
│   execute_rollback / restart_service / unknown  →  REFUSED             │
│        │                                                               │
│        ▼   budget-trim observation, record trace + scratchpad          │
│   append tool results → loop, until model_done / no_progress / cap     │
└────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ PHASE 2: conclude (one generateObject) ───────────────────────────────┐
│  evidence transcript → 9-section AnalysisSchema (same as single-shot)   │
└────────────────────────────────────────────────────────────────────────┘
```

| Concern | File |
|---|---|
| The loop | [`src/lib/agent/investigate.ts`](../src/lib/agent/investigate.ts) |
| Tools + control gate + budget | [`src/lib/agent/tools.ts`](../src/lib/agent/tools.ts) |
| Scratchpad state | [`src/lib/agent/state.ts`](../src/lib/agent/state.ts) |
| Typed scenario signals | [`src/lib/scenarios.ts`](../src/lib/scenarios.ts) (`signals`) |
| Evidence-grounding judge | [`src/lib/eval/judge.ts`](../src/lib/eval/judge.ts) (`judgeWithGrounding`) |
| API | [`src/app/api/investigate/route.ts`](../src/app/api/investigate/route.ts) |
| Trace UI | [`src/app/investigate/page.tsx`](../src/app/investigate/page.tsx) |

## The boring parts (the SRE differentiation)

- **Context budget.** `get_logs` returns the last N lines + the *true* total
  (`showing 30 of 5002`), so a service with thousands of log lines can't blow the
  window. Every observation is char-clamped. Self-test proves it against a 5k-line log.
- **Control gate as a runtime mechanism, not a prompt.** Read-only is enforced at
  the dispatch layer. We deliberately *expose* `execute_rollback` / `restart_service`
  so the gate has something real to refuse — "safety" is falsifiable here.
- **State.** A scratchpad of gathered evidence + executed calls is re-injected each
  round; a dedup guard short-circuits repeat calls; a per-tool cap stops hammering.
- **Recovery.** Empty results, handler errors, duplicate calls, and model errors all
  continue the loop. Hitting the step cap produces a best-effort analysis flagged
  "investigation incomplete" instead of crashing.

## Run it

```bash
npm run agent -- --selftest         # FREE, offline: 9 gate/budget/cap checks
npm run agent -- <scenario-slug>    # one live investigation (prints the trace)
npm run agent -- --all              # all 5 scenarios
npm run agent -- --lang zh <slug>   # Chinese output

npm run evals:agentic -- --quick    # smoke: 1 scenario, single vs agentic
npm run evals:agentic               # full before/after matrix (5×2 modes×2 lang×REPEATS)
EVAL_REPEATS=3 npm run evals:agentic # tighter error bars

npm run dev                         # then open /investigate for the trace UI
```

## Measuring it honestly

`npm run evals:agentic` reports, with mean ± std and a pooled-std "stands out /
inside noise" verdict (same methodology as `notes/eval-run-3.md`):

- **overall** (mean of the core 5 dims) for single vs agentic — comparable because
  both go through the same judge, model, temperature, scenarios, and ground truth.
- **per-dimension** deltas (which dimension did agency actually buy?).
- **evidence_grounding** — an agentic-only 6th dimension, judged *against the trace*
  (does the conclusion cite evidence it really retrieved?). Kept OUT of `overall`
  on purpose: the baseline has no trace, so folding it in would make the headline
  number incomparable with the historical single-shot evals.
- **severity accuracy**, **cost & model-calls per run**, and the **cost multiple**
  (agentic makes N model calls — did it buy N× the quality?).

### The framing that decides whether the result is real

The single-shot baseline already gets the KB **injected via RAG**. The agentic arm's
real edge is not "evidence vs. no evidence" — it's that the typed `signals`
(metrics/logs/deploys) are reachable *only* through tools the baseline never had,
and that the agent chooses *which* slice to pull. State the comparison as
**"one-shot with everything pre-stuffed" vs. "agent that discovers the relevant
slice"** — that's the honest claim, and the one worth writing about.

> Smoke (n=1, not significant — illustrates the pipeline): single overall 4.80,
> agentic 5.00 (safety 4→5), grounding 5/5, agentic 1.9× the cost. Run the full
> matrix with repeats for real error bars before quoting anything.
```
