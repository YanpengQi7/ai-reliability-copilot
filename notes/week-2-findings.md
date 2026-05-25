# Week 2 — Prompt v2 targeting v1 failure modes

## Prompt v1 → v2 changelog

| Weakness in v1 | v2 fix |
|---|---|
| Generic commands ("check logs") | Required full copy-pasteable commands with tool + flags + filter + time range; gave ❌/✅ examples in the system prompt |
| Skimpy postmortem | Mandated 9 exact H2 sections in order; `[FILL IN]` placeholders where data is missing |
| Severity under-rating | Quantitative thresholds (>1% error rate for >5min → SEV1); require `severity_reasoning` to cite the rule |
| Mitigation missing rollback | Stated explicitly: "If you cannot describe a rollback, the action is unsafe — replace it" |
| Flat root-cause likelihood | Required distinct likelihood across hypotheses; "high" requires cited evidence |

## Side-by-side observations (manual review of 5 scenarios)

| Scenario | v1 result | v2 result |
|---|---|---|
| db-connection-pool-exhausted | Got root cause; commands generic | Got root cause; commands include exact `pg_stat_activity` query |
| bad-deploy-memory-leak | SEV3 (under-rated); no rollback in mitigation | SEV2 correctly; rollback to v3.6 listed explicitly |
| upstream-dependency-timeout | Identified Stripe, suggested vague "add circuit breaker" | Identified Stripe + bulkhead pattern + concrete timeout values |
| dns-misconfiguration | Mis-attributed to network policy | Correctly identified the missing us-west-2 NLB |
| cache-stampede | Mentioned stampede but no per-key locking suggestion | Singleflight + TTL jitter + pre-warm before peak |

(Will be quantified rigorously in Week 3 with LLM-as-judge + rubric)

## Architecture
- Both prompts live in `src/lib/prompts.ts` keyed by version
- `getSystemPrompt(version)` is the only call site
- All 3 inference routes (`/api/analyze`, `/api/incidents/[id]/rerun`, `/api/scenarios/[slug]/run`) accept a version parameter
- DB persists `prompt_version` so historical comparisons survive forever
- UI: prompt toggle on home page (default v2); detail page shows version badge on every analysis in history; re-run can pick version
