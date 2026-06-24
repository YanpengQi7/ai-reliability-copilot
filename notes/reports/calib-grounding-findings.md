# Judge calibration: the evidence_grounding dimension (stable findings)

> `notes/generated/calib-grounding.md` is regenerated on every `npm run calib:grounding` run —
> it holds only the latest run. This file is the stable, human-reviewed conclusion.
> Per-run snapshots are preserved in `notes/archive/`.

## Why we looked

The full before/after eval (`notes/generated/eval-agentic-latest.json`, n=3) put
**evidence_grounding at 4.93/5** — near ceiling. Near-ceiling on a brand-new
dimension is a smell: either the agent really is well-grounded, or the judge can't
grade it. We don't quote a number we haven't pressure-tested.

## Method

Two independent signals per agentic run:
1. **Deterministic grounded ratio** (`scripts/calib-grounding.ts`): extract every
   number/metric token from the analysis's evidence-bearing fields
   (`severity_reasoning` + each `root_cause.evidence`) and check whether it literally
   appears in the investigation trace. A reproducible FLOOR on grounding (undercounts
   paraphrased/derived claims and quoted rubric thresholds — those are eyeballed).
2. **The LLM judge's** `evidence_grounding` score, graded against the same trace.

If the judge sits at ceiling while the deterministic ratio is mixed, the judge isn't
grading — it's rubber-stamping.

## What we found

| grounding judge | per-scenario scores (en) | mean | variance | tracks deterministic ratio? |
|---|---|---|---|---|
| **deepseek-chat** | 5, 5, 5, 5, 5 | 5.00 | **zero** | no — flat ceiling regardless of evidence |
| **deepseek-reasoner** | 5, **1**, 5, 4, 5 | 4.00 | real | **yes** |

Tightening the rubric anchors (forcing "verbatim-traceable = 5, one derived figure
caps at 4, any unsupported number ≤3") did **not** move deepseek-chat off a flat 5.00.
The weakness is the judge model, not the prompt.

deepseek-reasoner discriminates and **agrees with the deterministic check**: it gave
the lowest score (1) to `bad-deploy-memory-leak` — the run whose deterministic ratio
was lowest (72%) and which leans on a derived "~3.2% failures" figure not literally in
the trace (it's inferred from success rate 99.7%→96.8%) — and 5 to
`upstream-dependency-timeout` (94% traceable).

## Decision (applied)

- **`JUDGE_MODEL_GROUNDING = "deepseek-reasoner"`** (`src/lib/ai.ts`) is now the default
  judge for evidence_grounding. The core-5 dims keep `deepseek-chat` (JUDGE_MODEL) so
  the before/after `overall` stays comparable with the historical single-shot evals.
- The agent is **not fabricating evidence** — once the deterministic check's false
  negatives (rubric thresholds like `>5 min`/`>1%`, timestamps, slash-metrics it failed
  to match) are removed, nearly every numeric claim is traceable. The only real soft
  spot is a derived percentage in one scenario.

## Honest caveats / what's still open

- Calibration was **n=1 per scenario** — `bad-deploy`'s harsh `1` may be partly noise;
  whether it deserves 1 vs 3 needs repeats. The robust claim is "the flat-5.00 pathology
  is gone and the score now tracks evidence," not the exact per-scenario number.
- The deterministic check is a crude floor, not ground truth. A human spot-check of a
  few traces would tighten it further.
- **Before quoting grounding as a headline number, re-run the full eval with the reasoner
  judge** (the 4.93 in `notes/generated/eval-agentic-latest.json` was graded by the uncalibrated
  deepseek-chat and should be treated as void for grounding).

Reproduce: `npm run calib:grounding` (reasoner, default) vs
`npm run calib:grounding -- --judge deepseek-chat` (the broken baseline).
