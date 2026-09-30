# Evidence-first evaluation v2

The v2 harness measures supported diagnoses, appropriate uncertainty, severity, and prohibited actions. Its full-context, fixed-workflow and adaptive-investigator arms use the same generation model, frozen evidence pool, diagnosis schema and blinded judge protocol. The full-context arm sees all time-visible evidence; it is a reference baseline, not a claim of equal retrieval cost. Optional `alert` mode sees the alert alone.

This is a separate protocol from the legacy five-scenario reports. New runs use `shared-investigator-v3`: the same planner, diagnosis schema, prompts, read dispatcher and stopping policy as the web investigator. Older `experimental-eval-v2`, `shared-investigator-v1` and `shared-investigator-v2` runs remain readable historical artifacts and cannot qualify the current product for release.

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

`report --export-public` exports aggregate metrics and case outcomes only for synthetic datasets to `evals/public/latest.json`. Evidence text and model responses are excluded. `/evals/benchmark` shows that export, including an explicit mock banner when applicable. It never scans private run folders. Legacy `/evals` remains the historical database view; its recent-200 aggregation is not a v2 experiment.

## Remaining work requiring additional inputs

- Independent severity/cause labels, broader judge calibration and a genuinely controlled holdout.
- Real authorized telemetry and an adapter integration; a read-only adapter contract and deterministic replay adapter are implemented.
- Persisting web analysis evidence snapshots and atomic KB revisions requires an actual database migration and deployed-schema validation; those are not supplied by the file-based evaluator.
- Durable webhook jobs, browser session access, and measured user/MTTR outcomes remain separate rollout work.

## Implementation pilot (2026-09-27)

Three local live runs cost an estimated $0.0500655 in total (generation and judging, conservative listed prices). `live-smoke-v2-20260927` exposed thinking-budget exhaustion and unsupported retrieval query syntax. `live-smoke-v2-fixed-20260927` completed all calls but exposed claim-contract validation errors. Both remain preserved. `live-contract-v2-20260927` completed all three arms and checks for one pool-exhaustion case; its public aggregate is exported. This is an integration check on a development case, not an unbiased quality estimate. The gate remains **inconclusive**, labels remain draft, and judge calibration is unreviewed. No claim of improved diagnosis accuracy follows from this pilot.


## Integrity and challenge improvements

Reports reconstruct the predeclared trial matrix: missing artifacts stay in the denominator; duplicate records, changed arm assignments, mismatched datasets and duplicate judgments are rejected. Judge model/prompt mismatches and stale response hashes prevent assessment. Successful artifacts require non-null outputs. Observations must both occur and become available before the incident cutoff; report-time evidence must exactly match the snapshot.

Reports now expose required-evidence recall, invalid-claim details, critical unsupported judgments, stop reasons, attempted-run p50/p95 (including failures), and explicit gate reasons. Existing p50/p95 fields retain successful-run latency for compatibility. Evidence recall measures retrieval of authored required IDs, not semantic correctness. A configurable `min_success_rate` (default 0.80) adds an absolute quality floor to both pooled and equally weighted family success: two equally poor arms cannot qualify through relative noninferiority alone. This threshold is provisional, not an achieved production SLA.

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

## Connector evidence types

The shared investigator dispatch boundary checks adapter output against the requested tool: metrics reads accept metrics, log reads accept logs and reported user context, deployment reads accept deploy records, and runbook searches accept runbooks. Any incompatible record rejects the entire returned batch before the evidence registry changes. The investigator receives a tool error and can retry within its existing limits. Runbook search can still return cross-service guidance. Type checks prevent connector routing mistakes; they do not independently verify a record's factual content.


## Shared production engine and offline replay

`src/lib/agent/runtime.ts` owns the agentic loop. Both the web `investigate()` entry point and eval `generateTrial()` call it. Models, evidence adapters, cancellation signals, step limits and checkpoint callbacks are injected. The eval model wrapper retains durable spending reservations; the web path retains its request deadline and at most eight planning calls by default. Planner failures now propagate as failed investigations instead of silently starting a different best-effort model path. Neither path uses hidden model retries.

The canonical output is `DiagnosisSchema`. The web response includes `diagnosis`, `decisions`, `evidence`, `trace` and `engine_version`, plus a deterministic `analysis` presentation retaining the existing section names. Severity can be null; the UI renders “Unknown severity” and shows diagnosis status plus claim citations. Causes and mitigation lists may be empty. The presentation does not fabricate commands, rank probabilities, or pad lists to old minimum counts. Consumers requiring the older non-null `AnalysisSchema` must use the canonical diagnosis or adapt to `InvestigationAnalysis`. The separate single-pass `/api/analyze` product is unchanged and is not covered by this shared-engine claim.

The shared final prompt receives failed and truncated reads as limitations. Stable model context excludes wall-clock tool durations. Checkpoints are detached snapshots. New manifests identify the engine and hash both planner and diagnosis prompts and schemas. Historical exports keep their original engine identity.

To replay a completed default agentic trial through the production entry point without calling any provider:

```sh
npm run evals:v2 -- run --id=shared-smoke --mock --limit=1
# Choose an agentic trial filename from evals/runs/shared-smoke/trials/ (omit .json).
npm run agent:replay -- --id=shared-smoke --trial=TRIAL_ID
```

Replay uses frozen evidence and recorded planner/diagnosis responses, validates prompt/schema identity and trial assignment, and compares evidence, tool observations, call sequence, stopping reason and diagnosis. It rejects changed snapshots and incompatible legacy/ablation runs. It verifies control-flow reproduction, not new model quality or actual live-connector behavior. Production/eval parity tests additionally compare every model request schema, system prompt and input using a recorded response tape. No private evidence or model tape is automatically published.

## Reviewing investigation decisions

The investigation page displays each planner decision, its reason, read outcome, competing hypotheses, supporting and contradicting citations, and missing observations. Citation links open the matching frozen evidence record with source, service, observation/availability times and structured measurements. A separate unresolved-evidence panel keeps outstanding checks visible alongside the final diagnosis. These displays preserve the planner's stated reasoning; they do not assign probabilities or independently verify source content.

Reports audit completed agentic decision histories against retrieval order. A decision may cite the alert or evidence returned by earlier reads, but cannot cite a record first returned by its own or a later read. The audit also checks tool order, missing/extra reads, decisions after stopping and returned IDs absent from the final evidence snapshot. Shared-engine trials with missing or invalid decision histories cannot count as successful even if the final judge accepts their diagnosis. Failed/interrupted trials retain their existing failure accounting.

Metrics distinguish `audited_decision_trials`, `decision_history_errors` and `missing_decision_histories`. Historical runs without decision artifacts are reported as unavailable; the report does not manufacture a history. This is a structural audit of recorded reference timing and control flow, not a semantic assessment of whether a check was useful or an independent authentication of telemetry.

## Withholding invalid diagnoses

The shared runtime validates final diagnoses before returning a production response (introduced in `shared-investigator-v2`, retained by later versions). The same deterministic checks cover claim references, structured measurement attribution and explicit arithmetic, cause references, required citations for supported conclusions, and null severity when the response declares insufficient evidence. Tentative uncited hypotheses remain allowed. A rejected response produces `DIAGNOSIS_REJECTED` without exposing the candidate or evidence in the API error, and without an automatic repair call that changes spending or evaluation behavior.

Evaluation generation retains the rejected candidate and its observation checkpoints for local inspection, marks the trial failed, and preserves all recorded model usage in the planned denominator. Reports expose `diagnosis_integrity_failures` and per-trial `diagnosis_errors` for failed candidates as well as completed historical artifacts. Historical engine versions remain readable but cannot pass the current release gate or replay as the current engine. No rejected candidate is automatically published.

Passing this gate establishes structural integrity only. It cannot establish whether prose is true, whether citations actually support a causal interpretation, whether all consequential assertions were listed as claims, or whether a mitigation is appropriate. Those questions still require semantic evaluation and reviewed labels.

## Comparing investigation versions

Compare two idle saved runs without generating diagnoses or making judge/provider calls:

```sh
npm run evals:compare -- --baseline=BASELINE_RUN --candidate=CANDIDATE_RUN
npm run evals:compare -- --baseline=BASELINE_RUN --candidate=CANDIDATE_RUN --baseline-judge-run=replay --candidate-judge-run=primary
```

The command replays both reports under the current evaluator and requires identical frozen datasets, planned trial assignments, severity policy, statistical protocol and judge configuration (model, rubric and thinking mode). Run IDs, generation prompts, source/engine versions, generation models, ablations, budgets and execution seeds may differ; changed settings are listed so the comparison cannot silently attribute a combined change to one component. Selected judge-runs require their original saved configuration. Dataset mismatches require matching runs; judge mismatches require re-scoring the fixed answers with a common judge.

The JSON and Markdown files are saved under the candidate's ignored `evals/runs/CANDIDATE_RUN/comparisons/` directory with input snapshot hashes and evaluator source identity. Original trials, judgments and ledgers are not changed or recreated. Per-mode and category results show fixes, regressions, persistent failures, paired coverage and family-clustered intervals. Case transitions retain both versions' failure reasons and distinguish newly introduced and resolved reasons. New prohibited actions or critical unsupported assertions are highlighted even when both versions failed that case.

Missing trials, stale judgments and incompatible assessments remain unassessed, rather than becoming failures or fixes. Failed/interrupted generations remain assessed failures. All planned pairs remain in the coverage denominator. Unknown usage or unresolved reservations prevent a numeric cost delta; known generation spending and full-run accounting remain visible. Ledger accounting includes every judge-run and calibration call, so it is not presented as the cost of the selected judge-run alone.

Mock comparisons are marked `mock_plumbing`; draft labels or missing judge calibration produce `unreviewed_exploration`. `inference_ready` requires complete paired coverage, reviewed labels, compatible calibrated judges, live execution and the protocol's minimum independent families. It describes statistical prerequisites, not release eligibility, an unseen holdout or a causal claim. Run comparisons never replace the product release gate or establish production readiness. Reports expose `trial_outcomes` so downstream comparison tools can reuse the same assessment and integrity rules.


## Enforcing evidence ingestion contracts

`shared-investigator-v3` checks evidence content hashes and the investigation's fixed timestamp cutoff in the shared runtime. Both `observed_at` and `available_at` must be at or before `alert.at`; equality is allowed, and fractional-second precision is preserved beyond JavaScript milliseconds. Initial and full-context snapshots are validated before any model call. Adapter batches are validated before records enter planner or diagnosis prompts, including records that would otherwise be omitted by the observation budget. Adapters must provide a point-in-time snapshot for that cutoff; an evolving live investigation needs a new snapshot with a later cutoff.

Evidence creation normalizes the schema's property order, including structured measurements, and excludes unknown fields before hashing. Changed observations need new IDs and fresh hashes. Conflicting IDs, incorrect hashes, future timestamps, reserved IDs, wrong service/kind and malformed adapter records reject the whole batch. Rejected batches do not change the observation registry or leak their contents into tool observations. The registered initial observations also participate in identity checks.

Contract failures produce an `invalid_evidence` trace reason and cannot be retried with identical tool arguments. Ordinary handler failures retain one bounded retry. Valid evidence from other checks can still support a diagnosis; an adapter contract failure does not automatically make the final diagnosis incorrect. Reports separately count `rejected_evidence_reads` and `trials_with_rejected_evidence`, including unscored and interrupted investigations, without inventing a semantic assessment.

These checks establish consistency with the adapter's declared metadata and recorded content, not independent source authentication or truth. They do not infer timestamps hidden in prose, correct clock skew, or prove that supplied timestamps are honest. Semantic review and trustworthy connector implementations remain necessary. Historical engine versions stay readable but cannot qualify or replay as the current engine.

## Preventing incident-family imbalance from hiding failures

Reports retain the pooled `success_rate` and add `family_success_rate`: compute success over all planned trials within each family, then average those rates with equal family weights. Cases, languages and repeats within a family do not create more independent families. Eight successful cases in one family and one failed case in another produce 8/9 pooled success but only 1/2 family success. Both rates must meet the manifest's `min_success_rate` (default 0.80); a fully assessed, otherwise eligible run below the family floor receives `candidate_below_family_success_floor` and cannot pass release.

`family_coverage` similarly averages assessed/planned coverage across families. `family_results` lists each family's case IDs, planned/assessed/successful/failed/unassessed counts, success rate, coverage and reason counts. A trial contributes once to each distinct reason. `fully_failed_families` includes only fully assessed families with zero successes; `incomplete_families` counts families with unassessed outcomes. Missing or stale judgments remain unassessed, stay in planned denominators and prevent release without being relabeled as failures. Family rates on incomplete runs are conservative descriptive rates, not evidence of a quality regression.

JSON, Markdown and the public benchmark page expose these metrics and the families requiring inspection. Saved-run comparisons disclose both versions' family success and coverage, together with per-family failure reasons. Per-family deltas are unavailable until both runs fully assess that family; they are descriptive, not confidence intervals or causal effects. The existing paired family bootstrap remains the uncertainty estimate. These measures depend on honest, independently reviewed family assignments; renaming correlated cases cannot establish independence. No per-family accuracy guarantee or production SLA follows from the aggregate threshold.

Re-reporting or comparing historical runs applies the current evaluator to their fixed outputs without changing original trials, judgments or generation engine identity. Mock results remain pipeline checks, and unreviewed synthetic runs remain exploratory.

## Detecting renamed incident snapshots

New dataset loading rejects an identical alert and time-visible evidence snapshot assigned to different families or splits. Renaming case/evidence IDs, reordering evidence, duplicating the same observation, changing gold labels, or appending hidden future records cannot manufacture another snapshot. All declared observation metadata (including service, source and timestamps) remains part of the identity. The whole source dataset is checked before selecting a split or calling a model, so renamed copies cannot slip through train/test filtering.

Correlated variants with identical snapshots may stay in the same family and split. They remain planned cases, but `dataset_audit` reports their duplication and unique snapshot count. This check detects exact reuse only; it cannot prove independence, detect every paraphrase or time-shifted copy, establish the history of dataset access, or certify an unseen holdout. Independently reviewed family and split assignments are still necessary.

Historical saved datasets can be opened with the audit policy for reports, comparisons, recorded-response replay and human review. This does not rewrite original artifacts or grant release eligibility. A conflicting report adds `duplicate_snapshots_across_families_or_splits` and cannot pass; comparisons disclose the audit and withhold `inference_ready`. JSON, Markdown and the benchmark page list affected case IDs, families and splits without including alert or observation content. Existing schema, hash, gold-label and family/split checks still apply. New generation continues to require strict dataset loading and an unchanged saved source version.

## Accounting for rejected model output

The live provider adapter records token usage reported by the installed SDK's `NoObjectGeneratedError` when JSON parsing or schema validation rejects a response. It retains only documented input/output totals and the response ID, applies the generation or judge prices from the manifest, settles the existing reservation once, and rethrows the original error. The failed generation or judgment remains failed; there is no repair, retry, new diagnosis or second provider call. Token-exhausted responses also retain any usage available on the result before structured-output access fails.

Missing, negative or non-finite token counts keep cost unresolved and retain the reservation; known partial counts are preserved. Explicitly reported zero usage remains distinct from missing usage. Transport failures and arbitrary errors with a `usage` property do not supply trusted accounting. Ledger entries and usage callbacks never copy raw response text, causes or response bodies from SDK errors. Report spending includes failed calls, and resumed budgets include their settled costs.

These costs remain estimates under the saved prices, not provider invoices. Earlier unknown entries are not reconstructed or changed automatically: if their usage was never saved, reservations remain unresolved. Offline provider tests exercise the actual installed SDK's parsing and schema errors without network or model calls.
