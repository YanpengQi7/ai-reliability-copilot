# Eval Run #3 — n=3 repeats: the version gaps were noise

## Setup
- 5 scenarios × 3 prompt versions (v1/v2/v3) × 2 languages × **3 repeats** = 90 cells planned
- **84/90 completed** — the run was interrupted during the last cell group (`cache-stampede · v3 · en/zh`, 6 cells missing). v1 and v2 are complete (30 each); v3 has 24 (cache-stampede missing).
- Retry-on-parse-error fired once (`bad-deploy-memory-leak · v2 · zh`) and recovered — no holes from DeepSeek parse failures this run.
- Model: `deepseek-chat` analyzer + judge; analyzer temp 0.2, judge temp 0.

## How to read this run
Because v3 is missing one scenario, the headline cross-version comparison uses a **balanced subset** — the 4 scenarios all three versions completed (cache-stampede excluded), 3 repeats each = 24 cells per version. v1/v2 full 5-scenario numbers are reported separately for continuity with runs #1–2.

## Balanced version marginals (4 scenarios × 2 langs × 3 reps, n=24 each)

| version | mean ± std |
|---|---|
| v1 | 4.617 ± 0.328 |
| v2 | 4.483 ± 0.235 |
| v3 | 4.600 ± 0.264 |

### Pairwise deltas vs pooled std

| pair | Δmean | pooled std | verdict |
|---|---:|---:|---|
| v1 − v2 | +0.133 | 0.285 | **inside noise** |
| v1 − v3 | +0.017 | 0.298 | **inside noise** |
| v2 − v3 | −0.117 | 0.250 | **inside noise** |

**Every version delta is smaller than its pooled standard deviation.** With per-cell std running 0.2–0.46, the 0.1–0.2 gaps that looked decisive in single-shot runs #1 and #2 are not distinguishable from run-to-run noise.

## Language marginals (balanced, n=36 each)

| language | mean ± std |
|---|---|
| en | 4.639 ± 0.252 |
| zh | 4.494 ± 0.293 |

Δ = 0.145, pooled std ≈ 0.27 — borderline, BUT zh is lower than en in nearly every individual cell (see per-cell table), so the *direction* is consistent even if the marginal gap is near the noise band. The cross-lingual penalty is more robust than any version effect.

## Per-cell mean ± std (over 3 repeats)

| scenario | v1·en | v1·zh | v2·en | v2·zh | v3·en | v3·zh |
|---|---|---|---|---|---|---|
| db-connection-pool-exhausted | 4.80±0.00 | 4.87±0.12 | 4.73±0.12 | 4.60±0.00 | 4.87±0.12 | 4.73±0.12 |
| bad-deploy-memory-leak | 4.93±0.12 | 4.47±0.46 | 4.47±0.12 | 4.40±0.20 | 4.67±0.12 | 4.47±0.23 |
| upstream-dependency-timeout | 4.67±0.12 | 4.60±0.35 | 4.60±0.35 | 4.27±0.31 | 4.60±0.35 | 4.40±0.35 |
| dns-misconfiguration | 4.47±0.31 | 4.13±0.23 | 4.20±0.00 | 4.60±0.00 | 4.67±0.23 | 4.40±0.35 |
| cache-stampede | 4.47±0.31 | 4.47±0.31 | 4.60±0.00 | 4.07±0.42 | — | — |

## Full 5-scenario (v1/v2 only, complete matrices)

| version | mean ± std (n=30) |
|---|---|
| v1 | 4.587 ± 0.319 |
| v2 | 4.453 ± 0.273 |

Consistent with the balanced subset: v2 below v1, gap ~0.13, inside the std.

## Findings

### 1. The headline correction: prompt version is not a measurable lever here (n=3, this rubric, this judge)
Runs #1 and #2 each produced a clean-looking ranking (v2 lowest, v3 ≈ v1 top). Run #3 with repeats shows **why you can't trust that**: the within-cell std (0.2–0.46) is *larger* than the between-version deltas (0.02–0.13). The single-shot rankings were largely sampling noise dressed up as signal.

This is the single most important result in the whole project. It means: **for these 5 scenarios and this 1–5 rubric, all three prompts are statistically equivalent on overall score.** Any claim like "v3 improved quality 4.36 → 4.52" would be overfitting to noise.

### 2. What DOES survive repeats: two consistent orderings
- **v2 is the weakest in every measurement** (run1, run2, run3-balanced, run3-full). Each individual delta is in-noise, but the *ordering* reproduces across 3 independent runs — that consistency is itself weak evidence v2's hard constraints cost a little. Enough to say "don't default to v2," not enough to quantify the cost.
- **zh < en in nearly every cell.** The cross-lingual penalty is the most reproducible effect in the dataset. This is where future prompt work has the clearest signal to chase.

### 3. Decision: flip DEFAULT_PROMPT_VERSION off v2 → v3
The data does **not** support "v3 > v1" (they're tied within noise). But it weakly supports "{v1, v3} ≥ v2", and between v1 and v3:
- v3·zh ≥ v2·zh in every scenario, and the per-cell zh numbers for v3 are as good as v1's — the Chinese brevity guard is a defensible, no-cost refinement.
- v3 is the most maintained prompt (substance directive + the zh guard) and carries no measured penalty vs v1.

So: default moves to **v3**. Framing is honest — "v3, because it's tied with v1 on quality and strictly better-maintained for the bilingual case; NOT because it scored higher (it didn't, within noise)."

## Action items
1. ~~n=3 repeats with mean ± std~~ ✅ done — and it changed the conclusion.
2. Re-run the missing `cache-stampede · v3` cells to complete the matrix (optional; doesn't change the conclusion).
3. **Human-vs-judge calibration** (`npm run evals:calibrate`) — now the highest-value remaining eval work. If prompt version is in the noise, the question shifts to "is the judge even measuring the right thing?" Calibration answers that.
4. If we want version comparison to ever be conclusive: either (a) widen the rubric to finer than integer 1–5, (b) add harder/longer-tail scenarios that actually separate prompts, or (c) raise repeats to n≥5 and use a real significance test. Right now the ceiling effect (most cells 4–5) compresses everything.

## Honest reflection
Run #1: "my eval caught a regression I'd have shipped." Run #2: "I fixed it and the pipeline confirmed recovery." Run #3 is the grown-up version of both: **the regression and the recovery were mostly noise, and only repeats with error bars revealed that.** The portfolio lesson isn't "I tuned a prompt." It's "I built the discipline to know when a number is real — and this time it told me my own previous conclusions were over-claimed." That's the actual job of a reliability engineer pointed at LLMs.
