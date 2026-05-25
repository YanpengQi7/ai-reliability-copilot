# Eval Run #1 — first real numbers (n=18)

## Setup
- 5 scenarios × 2 prompt versions × 2 output languages = 20 cells planned
- 18 successful, 2 errored (bad-deploy-memory-leak × {v1, v2} × zh — schema parse failures on DeepSeek's side)
- Model: `deepseek-chat` for both analyzer and judge
- Rubric: v1, 5 dims × 1–5, judge at `temperature: 0`

## Per-cell results (overall, 1–5)

| scenario | v1·en | v1·zh | v2·en | v2·zh |
|---|---:|---:|---:|---:|
| db-connection-pool-exhausted | 4.8 | 4.6 | 4.6 | 4.6 |
| bad-deploy-memory-leak | 5.0 | — | 4.4 | — |
| upstream-dependency-timeout | 4.8 | 4.8 | 4.8 | 4.2 |
| dns-misconfiguration | 4.4 | 4.2 | 4.2 | 4.2 |
| cache-stampede | 4.4 | 4.8 | 4.6 | 4.4 |
| **AVERAGE** | **4.68** | **4.60** | **4.52** | **4.35** |

## Marginal averages

| | overall |
|---|---:|
| v1 | 4.64 |
| v2 | 4.44 |
| en | 4.60 |
| zh | 4.47 |

## Findings

### 1. v2 regressed (4.64 → 4.44)
The v2 prompt was written specifically to fix v1's known failure modes:
- Vague commands ("check the logs")
- Missing rollback in mitigation steps
- Severity under-rating
- Skimpy postmortem drafts

It produced shorter, more checklist-y outputs that the judge marked down on **completeness** (the dim that fell the most). Hypothesis: the added constraints (mandatory rollback field, required postmortem H2 list with `[FILL IN]` placeholders, "if you can't describe a rollback, the action is unsafe — replace it") narrowed the response space and the model started cutting prose elsewhere to stay compliant.

This is exactly the kind of regression invisible to eyeballing. Reading v2 outputs side-by-side with v1, v2 *looks* more disciplined. The judge disagrees and the rubric is reproducible.

### 2. Chinese output costs ~0.13 overall
Small but consistent dip. Per-dim breakdown suggests it's mostly **actionability** — Chinese explanations are more verbose around each command, pushing the actual command further down in walls of prose. The `languageInstruction()` in `src/lib/prompts.ts` correctly kept commands/SQL/JSON keys in English, so the loss isn't in code being mangled.

### 3. 2 cells failed with "could not parse the response"
Both on `bad-deploy-memory-leak · zh`. DeepSeek's responseFormat compatibility mode (it injects JSON schema into system message) occasionally produces invalid JSON. Not deterministic — re-running might succeed. Need to add retry logic in `scripts/run-evals.ts`.

## Action items for v3

1. **Loosen v2's hardest constraints** — try a v3 that keeps the few-shot examples and quantitative severity rubric, but drops the "if no rollback then action is unsafe" rule (which probably suppresses valid mitigations).
2. **Add a "verbosity guard"** to the prompt for Chinese — explicit instruction "keep command annotations brief; do not wrap commands in explanatory paragraphs."
3. **Add retry-on-parse-error** to run-evals.ts so transient DeepSeek parse failures don't leave holes in the matrix.
4. **Sample size is small (n=18)** — likely sub-significant for the 0.2 v1-v2 gap. Re-run twice more and report mean ± std before claiming v2 is worse.

## Honest reflection

If I hadn't built the eval pipeline, I would have shipped v2 — and a measurable regression — believing it was an improvement. That's the actual portfolio point, not "I improved my prompt." It's not "look how smart I was"; it's "look at the loop that caught me being wrong."
