# Evidence-first evaluation v2

The v2 harness measures supported diagnoses, appropriate uncertainty, severity, and prohibited actions. Its full-context, fixed-workflow and adaptive-investigator arms use the same generation model, frozen evidence pool, diagnosis schema and blinded judge protocol. The full-context arm sees all time-visible evidence; it is a reference baseline, not a claim of equal retrieval cost. Optional `alert` mode sees the alert alone.

This is a new protocol. Do not mix its results with legacy five-scenario reports. The new investigator is an experimental evaluation candidate; the web investigator retains its existing nine-section response contract while receiving the raw-context preservation and retrieval-access fixes.

## Offline verification

```sh
npm run evals:v2 -- validate
npm run evals:v2 -- run --id=local-smoke --mock --limit=2
npm run evals:v2 -- generate --id=local-smoke --mock
npm run evals:v2 -- score --id=local-smoke --judge-run=replay
npm run evals:v2 -- calibrate --id=local-smoke --judge-run=calibration
npm run evals:v2 -- report --id=local-smoke --judge-run=replay
```

Mock mode checks plumbing only. It deliberately returns uncertain fixture answers and cannot pass a release gate. The second `generate` skips existing trials. `score` calls only a judge; it never regenerates an answer.

The 30 synthetic candidate cases contain 20 conservative incident-family clusters, with proposed 18/6/6 development/validation/test splits. They are **draft labels, not an expert-validated benchmark**. Related categories share family IDs so repeats and similar examples are not counted as independent evidence. These public candidates are not a private, unseen holdout. Introduce a separately reviewed and controlled holdout before making external generalization claims.

## Bounded live pilot

Model names and prices are explicit inputs and are saved in the manifest. The example uses the current DeepSeek Flash model and conservative peak/cache-miss estimates from the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing), checked 2026-09-27. API model inventory returned `deepseek-flash` and `deepseek-v4-pro`. Flash thinking is explicitly disabled for bounded structured output; callers can override the application default. The application defaults were updated accordingly; historical results retain their old model names.

```sh
npm run evals:v2 -- run --id=pilot-001 --live --limit=1 \
  --model=deepseek:deepseek-flash --judge-model=deepseek:deepseek-flash \
  --max-usd=0.50 --per-call-usd=0.10 --max-calls=18 --max-minutes=12 \
  --max-output-tokens=6000 \
  --input-price=0.30 --output-price=1.20 \
  --judge-input-price=0.30 --judge-output-price=1.20
```

Prices are USD per million tokens. Each call reserves an estimated upper cost before dispatch; no automatic provider retries are enabled. Unknown usage retains its reservation instead of becoming free. Cached/off-peak charges may be lower. These are application accounting controls, not provider invoice enforcement; configure provider-side spending limits as well if a contractual hard cap is required. The current harness is serial and records tool observations, not private model reasoning.

`--split=dev|validation|test`, `--limit=N`, `--languages=en,zh`, `--repeats=N`, `--modes=full,workflow,agentic`, and `--ablation=default|no_kb|no_state` select the matrix. Never choose hyperparameters from the test results. Most initial candidates have no runbook; add a reviewed KB subset before using the no-KB ablation to draw conclusions.

## Artifacts and interruption

Each `evals/runs/<id>/` contains:

- `manifest.json`: source/dataset/prompt/schema/judge hashes, model configuration, budget and protocol.
- `dataset.json`: immutable input and gold snapshot; gold is never passed to the generator.
- `trials/*.json`: every planned trial, exact observed evidence, answer, tool observations, usage, failures and stop reason.
- `ledger.json`: durable reservations and observed usage, including interrupted or failed calls.
- `judgments/<judge-run>/`: a separate versioned scoring run and its immutable judge configuration.
- `report-<judge-run>.json` and `.md`: latest report with complete denominator, family-clustered paired interval, failure details and gate decision. Content-addressed `report-<judge-run>-<hash>.json` revisions preserve prior reports, and `versions.evaluator` records the current deterministic evaluator source hash.

Raw runs and human annotations are ignored by Git. No private database is queried by the v2 harness. Resume requires unchanged generation source and manifest. An interrupted running trial is preserved as interrupted; use a new run ID to retry explicitly. A stopped process can leave `.lock`; check that no process still owns the run before removing it. Successful calls whose result was lost still retain budget reservations.

Re-score saved answers with another judge using a **new** judge-run ID, explicit prices, and the same source protocol. `score` permits code changes so new judge protocols can be recorded independently; its prompt hash is stored with each judgment. `report` and `check` replay saved judgments without a model call.

```sh
npm run evals:v2 -- score --id=pilot-001 --judge-run=independent \
  --judge-model=anthropic:YOUR_VERIFIED_MODEL_ID \
  --judge-input-price=YOUR_INPUT_PRICE --judge-output-price=YOUR_OUTPUT_PRICE
```

The original run's cumulative budget still applies across scoring passes. A budget-limited run is incomplete; do not silently raise its budget or drop failed cases to make it pass.

Observed measurements backed only by prose are deferred to semantic review. Structured measurements are checked against service, metric, unit and window. `derived` means explicit arithmetic over structured evidence IDs; `inference` covers qualitative reasoning and calculations over prose. Passing deterministic checks never proves semantic support.

## Judge calibration and human review

`calibrate` scores 30 **fixed authored answers**, varying service, unit, time window, exact observations and valid derived percentages. It never regenerates those answers. It uses the same judge prompt and schema as trial scoring. This first pack covers six source observations; it is a narrow calibration check, not comprehensive proof against prompt injection or all causal errors.

The command writes `calibration/review-template.json`. Two independent reviewers should each annotate the full evidence and response, without seeing the judge scores. Combine their annotations into `calibration/reviews.json`:

```json
[
  {"sample_id":"calibration-0-observed","reviewer":"reviewer-a","unsupported":false,"notes":"Metric, service, unit and time agree."},
  {"sample_id":"calibration-0-observed","reviewer":"reviewer-b","unsupported":false,"notes":"Supported by e1."}
]
```

Repeat for every sample, then run `calibration-report --id=... --judge-run=...`. Disagreements keep the calibration unreviewed. Precision/recall and confusion counts are reported; uncertainty intervals are descriptive because the mutations share source cases. No human scores are invented or auto-filled.

Use a reviewed summary as `--calibration=evals/runs/<id>/calibration/summary-<judge-run>.json` when creating a new evaluated run. A release gate requires a live calibration with at least 30 graded samples, two agreeing reviewers per item, precision ≥0.85, recall ≥0.90, and an identical judge model/prompt hash. These are pilot thresholds, not achieved results.

For blind five-dimension review of generated answers:

```sh
npm run evals:review -- export pilot-001 reviewer-a
# Annotate evals/reviews/pilot-001/reviewer-a/responses.json, scores 1–5.
npm run evals:review -- summarize pilot-001 reviewer-a primary
```

The export hides model, mode, prompt version and machine scores, and shows complete evidence and responses. It reports per-reviewer MAE and exact agreement. Formal inter-rater agreement/adjudication remains separate; this tool does not promote dataset labels to gold.

## Decisions and public results

`evals/protocol-v2.json` pre-registers minimum family count, success-rate noninferiority margin and maximum cost ratio. Dataset labels must be independently reviewed, critical safety/grounding failures must be absent, coverage must be complete, and calibration must match. Small samples remain inconclusive. “No detected difference” does not prove equivalence.

`check` exits 0 only for a live passing gate; 1 = regression, 2 = incomplete, 3 = inconclusive, 4 = mock. Changing a judge invalidates calibration tied to a different model or prompt. `report` does not fail merely because it reports bad or incomplete results.

`report --export-public` exports aggregates only for synthetic datasets to `evals/public/latest.json`. `/evals/benchmark` shows that export, including an explicit mock banner when applicable. It never scans private run folders. Legacy `/evals` remains the historical database view; its recent-200 aggregation is not a v2 experiment.

## Remaining work requiring additional inputs

- Independent severity/cause labels, broader judge calibration and a genuinely controlled holdout.
- Real authorized telemetry and an adapter integration; a read-only adapter contract and deterministic replay adapter are implemented.
- Persisting web analysis evidence snapshots and atomic KB revisions requires an actual database migration and deployed-schema validation; those are not supplied by the file-based evaluator.
- Durable webhook jobs, browser session access, and measured user/MTTR outcomes remain separate rollout work.

## Implementation pilot (2026-09-27)

Three local live runs cost an estimated $0.0500655 in total (generation and judging, conservative listed prices). `live-smoke-v2-20260927` exposed thinking-budget exhaustion and unsupported retrieval query syntax. `live-smoke-v2-fixed-20260927` completed all calls but exposed claim-contract validation errors. Both remain preserved. `live-contract-v2-20260927` completed all three arms and checks for one pool-exhaustion case; its public aggregate is exported. This is an integration check on a development case, not an unbiased quality estimate. The gate remains **inconclusive**, labels remain draft, and judge calibration is unreviewed. No claim of improved diagnosis accuracy follows from this pilot.


## Integrity and challenge improvements

Reports reconstruct the predeclared trial matrix: missing artifacts stay in the denominator; duplicate records, changed arm assignments, mismatched datasets and duplicate judgments are rejected. Judge model/prompt mismatches and stale response hashes prevent assessment. Successful artifacts require non-null outputs. Observations must both occur and become available before the incident cutoff; report-time evidence must exactly match the snapshot.

Reports now expose required-evidence recall, invalid-claim details, critical unsupported judgments, stop reasons, attempted-run p50/p95 (including failures), and explicit gate reasons. Existing p50/p95 fields retain successful-run latency for compatibility. Evidence recall measures retrieval of authored required IDs, not semantic correctness. A configurable `min_success_rate` (default 0.80) adds an absolute quality floor: two equally poor arms cannot qualify through relative noninferiority alone. This threshold is provisional, not an achieved production SLA.

The web investigator stops after two rounds with no new observation content, even when queries differ. The experimental investigator stores structured hypothesis/check decisions separately from tool observations, and uses the final hypothesis state during synthesis except in the no-state ablation. These are operational decisions, not private reasoning traces. Human review exports bind annotations to the exact manifest, trial and displayed evidence/answer; stale or edited content is rejected at aggregation.

Six additional **draft development challenges** cover service confusion, future recovery, malicious runbook instructions, contradictory observations, request/user denominator confusion, and stale deployment correlation:

```sh
npm run evals:v2 -- validate --dataset=evals/datasets/sre-v2/challenges.json
npm run evals:v2 -- run --id=challenge-offline --mock \
  --dataset=evals/datasets/sre-v2/challenges.json --limit=6
```

They are separate from the original 30-case dataset and are not a held-out test set. CI validates and exercises both datasets offline.


All v2 arms now receive an explicitly unverified `alert-context` evidence item, so claims about the alert have a citeable source without treating the alert as verified telemetry. Missing observations belong in `missing_information`, not unsupported observed claims. The severity policy clarifies that confirmed customer impact does not become SEV3 merely because it affects a small subset; request share must not be compared to an affected-user threshold. This clarifies impact-v2 semantics rather than changing its thresholds.

## Recovery and configuration safeguards

Finished trials (including failed, interrupted and budget-limited trials) and saved judgments are immutable through the artifact store. Identical saves are idempotent; changed outputs require a new run or judge-run. Initializing an existing experiment never recreates deleted trial files. Reports account for a missing artifact as incomplete without modifying raw trial records; generation refuses to silently replace it. Restore the original artifact or start a new run after interrupted initialization or file loss.

Resume commands use the saved manifest. New-run flags such as model, dataset, split and budget are rejected on resume rather than silently ignored. Re-scoring accepts explicit judge overrides, validated against the same schema as initial configuration. Boolean switches only accept `--live` or `--live=true` (similarly for mock/export); values such as `--live=false` fail rather than accidentally enabling live calls. Negative token prices and negative spending reservations are rejected before dispatch.

`calibration-report --id=... --judge-run=...` uses that scoring run's saved judge model and prompt hash, allowing faithful historical replay after the current judge prompt changes. This does not make old calibration compatible with a new judge protocol.

## Investigator read boundaries

The web investigator keeps tool-derived state in untrusted user context instead of interpolating it into system instructions. State excerpts are bounded and repeated summaries are deduplicated. Query signatures are canonicalized across object-key order. Failed reads can be retried once with the same arguments; successful, empty and refused reads remain deduplicated, and existing per-tool/step caps still apply.

Scenario telemetry requires an exact service name (case-insensitive, surrounding whitespace ignored); substring guesses no longer return another service's data. Adapter results are schema-validated, and telemetry for a service other than the requested service is rejected. Runbook search remains cross-service guidance. Oversized records no longer hide later records that fit; omitted records are counted with a narrowing hint. The final web analysis receives failed/empty/truncated read limitations separately from factual evidence, so missing observations do not imply normal operation.

These changes are covered by deterministic tool and investigator tests, plus offline challenge replay. They do not establish live-provider robustness against every prompt-injection technique.

## Stable evidence identities and arithmetic

Evidence merging preserves the first observation and deduplicates identical records. Reusing an ID for different content, provenance, service or measurement is an error, not an update: connectors must issue a new ID for a new observation. The dispatch boundary maintains an investigation-local registry so conflicting later reads fail without replacing earlier evidence. Adapter and dataset IDs cannot occupy the reserved `user-context`, `alert-context` or `tool-<number>` namespaces. Final synthesis and experimental evaluation use the same conflict-detecting merge. Claim checking reports ambiguous references regardless of duplicate-record order.

Explicit arithmetic is checked even when a claim incorrectly labels itself as observed. Percentage complements require inputs within 0–100%; differences require matching service, metric, unit and measurement window; a derived measurement cannot silently change its source window. Semantic review is still required for whether a valid calculation actually supports the diagnosis.

## Run spending reconciliation

Reports include a separate `accounting` summary from the persisted call ledger, covering generation, calibration and all judge-runs. Settled usage replaces its reservation; calls with unknown usage retain their reservation and are never counted as free. This run-wide amount has a different scope from the selected comparison's per-mode costs. All amounts are estimates, not provider invoices. Unresolved call costs prevent a passing release gate, even when quality metrics pass.

Resume validates ledger identities, nonnegative costs, state and usage purpose before dispatch. Recovering an interrupted judgment retains recorded usage in its failed artifact; an explicit new judge-run is required for retry. Missing result files therefore do not erase run-wide spending.

## Semantic grounding and authentic retrieval

A trial fails the supported-diagnosis criterion when a compatible, current judge verdict identifies any unsupported claim, including a noncritical fabrication. Critical unsupported assertions still trigger the separate safety gate. Reports distinguish deterministic `invalid_claims` (citation and arithmetic checks) from `semantic_unsupported_claims` (unique judge-reported assertion IDs per trial) and `trials_with_semantic_unsupported_claims`. IDs for assertions omitted from the candidate's claims are retained; stale or incompatible verdicts do not contribute to these metrics.

Required-evidence coverage counts only records whose complete snapshot matches the frozen, time-visible evidence. An altered record with a valid ID earns no retrieval credit. These checks improve evaluation integrity; they do not independently establish judge accuracy or production readiness.

## Release evaluation split

Only a run containing exclusively `test` cases can pass the release gate. Development, validation and mixed-split runs remain exploratory: even otherwise passing results are `inconclusive` with reason `non_test_dataset`. Quality and safety regressions remain detectable on every split. Reports include case counts in `dataset_splits`; these counts are independent of arm, language and repeat counts.

Use `--split=test` when creating a release evaluation, with enough independent, reviewed incident families and compatible judge calibration. Do not relabel development cases to obtain approval. Split metadata is a necessary boundary, not proof of an unseen holdout: the published synthetic cases remain public, and controlled holdout collection and access must be managed separately. This change does not promote any existing benchmark to release-ready status.

## Missing spending ledger

New runs persist an empty `ledger.json` before writing their manifest, including mock runs. Commands refuse to proceed if an existing run's ledger is missing or malformed; they never reconstruct an empty ledger from missing data. Restore the original ledger from backup or start a new run. This also applies to older runs that lack a ledger. A new run has its own budget; it does not erase spending incurred by previous runs.

If initialization leaves a ledger without a manifest, retrying with that run ID fails rather than overwriting the ledger. Restore the original run or choose a new ID. Report commands read accounting without recreating missing files.
