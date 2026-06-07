# Evaluation Methodology

This project treats prompt engineering as an engineering discipline: every change to the system prompt is scored against a fixed rubric across a fixed scenario suite. "It feels better" doesn't ship; "average rubric overall went from 2.8 → 4.3" does.

## Why this matters

Without a rubric and a regression suite, prompt iteration is vibes. You change something, re-run one example, decide it's "better," and ship. You can't justify the change, you can't catch regressions, and you can't onboard anyone.

This pipeline gives us:
1. A **rubric** with 1/3/5 anchors per dimension so two reviewers (human or LLM) converge on similar scores.
2. A **regression suite** of 5 representative scenarios so prompt changes are measured across breadth, not a single cherry-picked example.
3. **LLM-as-judge** for speed + consistency, validated against periodic human review.

## Rubric v1 — 5 dimensions, 1–5 each

See [`src/lib/eval/rubric.ts`](./src/lib/eval/rubric.ts) for the full definition.

| Dim | What it measures | 1 anchor (poor) | 5 anchor (excellent) |
|---|---|---|---|
| **Specificity** | Concreteness of commands/metrics/services | "check the logs" | `kubectl logs -n prod -l app=payment-svc --since=15m \| grep -iE "connection refused"` |
| **Safety** | Avoidance of destructive ops without alternatives; presence of rollback | Recommends DROP TABLE on prod | Every mitigation has rollback; risky ops gated by safer alternative |
| **Actionability** | Can on-call execute in <5 min? | Vague "investigate further" | Every step copy-pasteable, no further research needed |
| **Domain correctness** | Right SRE mechanism, no invented evidence | Mis-attributes OOM to CPU | Correct root cause with correct mechanism |
| **Completeness** | All 9 sections substantively filled | Multiple empty sections | All 9 substantive; postmortem H2 sections in order |

## Scenario suite (regression set)

See [`src/lib/scenarios.ts`](./src/lib/scenarios.ts). Each scenario carries:
- Realistic context: metrics, log snippets, deploy history, on-call notes
- `expected_severity` — for grading
- `expected_root_cause` — for grading `domain_correctness`

| Slug | Category |
|---|---|
| db-connection-pool-exhausted | Database |
| bad-deploy-memory-leak | Deploy |
| upstream-dependency-timeout | Dependency |
| dns-misconfiguration | Network |
| cache-stampede | Capacity |

## Judge

See [`src/lib/eval/judge.ts`](./src/lib/eval/judge.ts). The judge:
- Is itself an LLM call (`generateObject` against `RubricScores`)
- Receives the analysis + (when available) ground truth from the scenario
- Is prompted to cite a concrete element of the analysis to justify each dimension's score
- Runs at `temperature: 0` for stability

## How to run

```bash
# 1. Ensure DeepSeek + Supabase env vars are set in .env.local
# 2. Seed scenarios
npm run seed:scenarios
# 3. Run the batch: 5 scenarios × 2 prompt versions = 10 generations + 10 judgements
npm run evals:run
# 4. View results
open http://localhost:3000/evals
```

## Limitations & honesty

- **Judge ≠ ground truth.** The same model family judges the output, so absolute scores carry a same-vendor optimistic bias. Rather than leave this as a hand-waved "~10–20%", it's now *measured* — see the cross-model results below. Periodic human review (random sample of N=20 per release) remains the ground-truth anchor.

### Cross-model judge results (measuring same-family bias)

`npm run evals:crossjudge` holds each analysis fixed and re-scores it with an independent vendor (`JUDGE_MODEL_CROSS`), so any score delta is the judge, not the generation. Run below: prompt v3, 5 scenarios × en/zh × 2 repeats = **n=20**, Judge A = `deepseek-chat` (same family as the analyzer), Judge B = `anthropic:claude-sonnet-4-6` (independent). Raw dump: `notes/crossjudge-latest.json`.

| dimension | meanA (deepseek) | meanB (claude) | bias B−A | MAE | exact-agree |
|---|---:|---:|---:|---:|---:|
| specificity | 4.55 | 4.30 | −0.25 | 0.25 | 75% |
| safety | 3.90 | 3.90 | **0.00** | 0.10 | **90%** |
| actionability | 4.55 | 4.15 | **−0.40** | 0.40 | 65% |
| domain_correctness | 4.85 | 4.70 | −0.15 | 0.25 | 75% |
| completeness | 4.55 | 4.15 | **−0.40** | 0.40 | 60% |
| **OVERALL** | **4.48** | **4.24** | **−0.24** | 0.28 | 30% |

Overall Pearson r = **0.59**; 70% of items agree within ±0.5 on overall.

**What this says:**
- **The self-bias is real but small: +0.24 on a 1–5 scale (~5%).** My pre-registered guess of "10–20%" was an *overestimate* — measuring beats guessing in both directions.
- **It's concentrated, not uniform.** `safety` has zero bias and 90% exact agreement (both judges converge on whether mitigations are reversible); the gap lives in `actionability` and `completeness` (−0.40 each), where DeepSeek is more generous about "could on-call actually run this" than the independent judge.
- **The bias is consistent across languages** (en −0.22, zh −0.26), so it's a judge property, not a language artifact.
- **Takeaway for the pipeline:** absolute scores should be read with a ~0.2–0.4 same-family discount on the soft dimensions; *relative* comparisons (prompt v1 vs v3) are safer because the bias is roughly constant across versions. Cross-judging the soft dimensions, or anchoring them to human review, is the next step.
- **5 scenarios is narrow.** Will expand to 15–20 as the project matures. Real production has long tails.
- **`temperature: 0.2` on the analyzer** means some run-to-run variance; we don't yet repeat each scenario and average. Roadmap item.
- **In-memory rate limiter** on `/api/analyze` resets on cold start.
- **The 9-section schema is opinionated.** Real incidents don't always fit; this is a tradeoff for structured, comparable output.

## Roadmap
- Human-vs-judge agreement study (target ≥80% agreement on overall ±0.5)
- ✅ Cross-model judge to measure same-family bias (`npm run evals:crossjudge`)
- Per-scenario repeats (N=3) with std-dev reporting
- Adversarial scenarios (multi-cause incidents, missing data, misleading log lines)
- Cost-per-quality tracking (overall_score / cents)
