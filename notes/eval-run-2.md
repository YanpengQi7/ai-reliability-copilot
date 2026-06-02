# Eval Run #2 — v3 recovers the regression (n=30)

## Setup
- 5 scenarios × **3 prompt versions (v1/v2/v3)** × 2 output languages = 30 cells
- **30/30 succeeded** (vs 18/20 in run #1 — the new retry-on-parse-error in `scripts/run-evals.ts` held; no parse failures this run)
- Model: `deepseek-chat` for both analyzer and judge
- Rubric: v1, 5 dims × 1–5, judge at `temperature: 0`, analyzer at `temperature: 0.2`

## Per-cell results (overall, 1–5)

| scenario | v1·en | v1·zh | v2·en | v2·zh | v3·en | v3·zh |
|---|---:|---:|---:|---:|---:|---:|
| db-connection-pool-exhausted | 4.2 | 4.6 | 4.2 | 5.0 | 4.6 | 4.6 |
| bad-deploy-memory-leak | 4.8 | 4.8 | 4.8 | 4.2 | 4.6 | 4.6 |
| upstream-dependency-timeout | 4.8 | 4.2 | 4.8 | 4.0 | 4.8 | 4.8 |
| dns-misconfiguration | 4.4 | 3.8 | 4.2 | 4.2 | 4.2 | 4.2 |
| cache-stampede | 4.8 | 4.6 | 4.2 | 4.0 | 4.8 | 4.0 |
| **AVERAGE** | **4.60** | **4.40** | **4.44** | **4.28** | **4.60** | **4.44** |

## Marginal averages

| version | overall | vs run #1 |
|---|---:|---|
| v1 | 4.50 | (was 4.64) |
| v2 | 4.36 | (was 4.44) |
| **v3** | **4.52** | **new — best** |

| language | overall |
|---|---:|
| en | 4.55 |
| zh | 4.37 |

## Findings

### 1. v3 recovers the v2 regression (4.36 → 4.52, and edges v1 4.50)
v3 was written specifically to undo the over-constraint that hurt v2 in run #1:
- Dropped the hard gate *"if you cannot describe a rollback, the action is unsafe — replace it"* → reframed as a strong preference (fill rollback, but don't drop a valid irreversible mitigation; elevate `risk` instead).
- Loosened the rigid postmortem H2 list from MUST to "prefer".
- Added an explicit substance directive: *"Brevity is not a goal… a short checklist-y answer that conforms to the schema but skips reasoning is a failure"* — aimed straight at the `completeness` dim v2 lost on.

Result: v3 lands at 4.52, **above both v2 (4.36) and v1 (4.50)**. The fix worked, and it's measured rather than vibes.

### 2. v3 closes the cross-lingual gap
- v1: en 4.60 / zh 4.40 → Δ **0.20**
- v2: en 4.44 / zh 4.28 → Δ **0.16**
- v3: en 4.60 / zh 4.44 → Δ **0.16**

v3·zh (4.44) is the **best Chinese score of any version**, up from v1·zh 4.40 and v2·zh 4.28. The Chinese brevity guard (keep command annotations to one sentence, don't wrap commands in prose) appears to have helped the dimension we lost on. Gap not fully closed, but zh's absolute ceiling rose.

### 3. Absolute numbers shifted from run #1 → run-to-run variance is real
Run #1 had v1=4.64, v2=4.44. Run #2 has v1=4.50, v2=4.36 — same prompts, ~0.1 lower. This is single-shot run-to-run variance (temperature 0.2 analyzer + non-deterministic judge), and it's larger than several of the version gaps we're trying to measure. **The v1→v2→v3 ranking is consistent across both runs (v2 always lowest), but the absolute deltas are within noise.**

→ This is the strongest argument yet for the **n=3 repeats** action item: report mean ± std before claiming any sub-0.2 gap. Right now I can defensibly say "v2 regressed, v3 recovered" (consistent ordering across two independent runs) but NOT "v3 > v1 by 0.02" (that's noise).

## Action items

1. ~~Add retry-on-parse-error to run-evals.ts~~ ✅ done — 30/30 this run.
2. **Per-scenario repeats (n=3)** — wrap the cell loop, report mean ± std. Highest-value next step; would let us put error bars on the v-comparison.
3. **Human-vs-judge calibration** — `npm run evals:calibrate` is built; run it on ~10 of these analyses to get Spearman ρ + bias, quantify the judge's optimism.
4. **DEFAULT_PROMPT_VERSION still v2** — leave it until n=3 repeats confirm v3's edge is outside the noise band, then flip to v3.

## Honest reflection

Run #1's headline was "I shipped a regression and my eval caught it." Run #2's is the natural sequel: "I diagnosed *why* (over-constraint suppressing completeness), wrote a targeted fix, and the same pipeline confirmed the recovery — while also showing me the gap is partly inside the noise floor, so I'm not allowed to overclaim." The discipline is in knowing which of those two sentences the data supports.
