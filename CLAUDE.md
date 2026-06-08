@AGENTS.md

# AI Reliability Copilot — agent context

This file is read first by Claude Code / agents joining the project. Skim top-to-bottom, then dive into the file you need.

---

## 30-second orientation

**What this is:** Next.js app that turns a production incident (logs + metrics + on-call notes) into a structured 9-section LLM response (severity, root causes, investigation checklist, mitigation, postmortem draft, follow-ups). Ships with a 5-scenario regression suite + LLM-as-judge eval pipeline.

**Why it exists:** A side project exploring AI engineering for SRE workflows. The *product* is the LLM tool; the *engineering* is the eval pipeline.

**Live:** https://ai-reliability-copilot.vercel.app · **Repo:** https://github.com/YanpengQi7/ai-reliability-copilot

**For users (not contributors):** point them at [USAGE.md](./USAGE.md) — 5 workflows, env setup, deploy guide, all in Chinese.

**Stack:** Next.js 16 App Router, TS, Tailwind v4, AI SDK 6, DeepSeek, Supabase, Vercel. **i18n: zh/en** (UI + LLM output, independent toggles).

---

## Architecture at a glance

```
Browser ──→ /api/analyze   (streamObject, no DB writes — pure inference)
        ──→ /api/incidents/save   (persists incident + analysis after stream)
        ──→ /api/incidents/[id]/rerun   (re-generate with different prompt/lang)
        ──→ /api/scenarios/[slug]/run   (one-click scenario → analysis)
        ──→ /api/evaluate   (LLM-as-judge scores one analysis)

Supabase tables: incidents → analyses (FK cascade) → evaluations (FK cascade)
                 scenarios (standalone curated library)
```

All server inserts go through `supabaseAdmin()` (service-role key). Browser never touches DB directly.

---

## Where things live

| Concern | Path | Notes |
|---|---|---|
| **9-section LLM output schema** | `src/lib/schema.ts` | Zod. Single source of truth — change here first, TS will guide you through the rest |
| **Prompt registry** | `src/lib/prompts.ts` | `SYSTEM_PROMPT_V1`, `_V2`; `getSystemPrompt(version)`; `buildUserPrompt({ language })` |
| **LLM output language** | `src/lib/prompts.ts → languageInstruction()` | Narrative translates; commands/enums/JSON keys stay English |
| **DeepSeek client** | `src/lib/ai.ts` | `ANALYSIS_MODEL`, `JUDGE_MODEL` — change to swap models |
| **Scenarios (regression suite)** | `src/lib/scenarios.ts` | 5 curated SRE scenarios with `expected_root_cause` |
| **Rubric (eval)** | `src/lib/eval/rubric.ts` | 5 dims × 1–5, with 1/3/5 anchors |
| **Judge** | `src/lib/eval/judge.ts` | LLM-as-judge, temp=0, optional scenario ground truth |
| **i18n catalog** | `src/lib/i18n/messages.ts` | All UI strings, keyed by locale |
| **i18n server/client** | `src/lib/i18n/{server,client,actions}.ts` | `getLocale()`, `useT()`, `setLocaleAction` |
| **DB read helpers** | `src/lib/db.ts` | Typed `AnalysisRow`, `IncidentRow` |
| **Supabase schema** | `supabase/schema.sql` | Run in Supabase SQL editor on fresh project |
| **Eval batch runner** | `scripts/run-evals.ts` | `npm run evals:run` → 5 scenarios × 2 prompts × 2 languages = 20 evals |
| **Scenario seed** | `scripts/seed-scenarios.ts` | `npm run seed:scenarios` (idempotent upsert by slug) |
| **Methodology** | `EVALUATION.md` | Public-facing eval methodology + limitations |

---

## Common tasks — what to touch

### Add a new UI string
1. Add the key + zh/en to `src/lib/i18n/messages.ts`
2. In a server component: `import { t } from "@/lib/i18n/messages"; t(locale, "your.key")`
3. In a client component: `const t = useT(); t("your.key")`

### Add a new prompt version (e.g. v3)
1. Add `SYSTEM_PROMPT_V3` constant in `src/lib/prompts.ts`
2. Update `PromptVersion` union and `PROMPTS` registry
3. Update Zod `enum(["v1","v2"])` to include `"v3"` in all 4 endpoints + InputSchema in `/api/analyze`
4. Update `<v1|v2 toggle>` UI in `src/app/page.tsx` and `src/components/ReRunButton.tsx`
5. Update `scripts/run-evals.ts` `VERSIONS` array

### Add a new scenario
1. Append to `SCENARIOS` array in `src/lib/scenarios.ts`
2. Run `npm run seed:scenarios` to upsert it to Supabase

### Ingest internal docs into the KB (RAG)
1. Drop markdown files into `sample-kb/` (or any directory)
2. `npm run kb:ingest -- ./your-docs-dir` (defaults to `./sample-kb`)
3. Filename heuristic sets `kind`: postmortem/runbook/service/architecture/other.
   Force a kind for the whole batch: `--kind=runbook`
4. With `OPENAI_API_KEY` set → semantic retrieval (text-embedding-3-small); without → pg_trgm fallback
5. View ingested docs at `/kb`; chunks used per analysis shown on incident detail page

### Add a new rubric dimension
1. Extend `RubricDim` enum + `DimensionScore` + `RubricScores` + `RUBRIC_DEFINITIONS` in `src/lib/eval/rubric.ts`
2. Update `overallScore()` if weighting changes
3. Update `/evals` dashboard `dims` array + `dimLabelKey`
4. Add i18n keys for the new dim label

### Add a new DB column
1. `supabase/schema.sql` — add column (keep idempotent with `add column if not exists`)
2. Apply to live DB: prefer `mcp__83e1c2f7-…__apply_migration` (project-scoped MCP works). Fallback: paste into Supabase SQL editor.
3. Update `src/lib/db.ts` row type
4. Update INSERT statements in **all 4** write endpoints + `scripts/run-evals.ts`
5. (If reading) update detail page render + i18n strings if user-visible

### Run end-to-end locally
```bash
# Verify env
node -e "require('dotenv').config({path:'.env.local'}); console.log(Object.keys(process.env).filter(k=>k.includes('DEEPSEEK')||k.includes('SUPABASE')))"

# Verify DB
node -e "require('dotenv').config({path:'.env.local'}); const {createClient}=require('@supabase/supabase-js'); createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).from('incidents').select('count',{count:'exact',head:true}).then(r=>console.log(r))"

npm run seed:scenarios  # 5 scenarios
npm run dev             # http://localhost:3000
npm run evals:run       # 20 evals, ~$0.03 DeepSeek
```

---

## Conventions

- **Zod for everything that crosses a boundary** — LLM output (`AnalysisSchema`), API inputs (`InputSchema` in each route), eval scores (`RubricScores`). Never trust raw JSON.
- **`structuredOutput` over free text.** Use `generateObject`/`streamObject` with a Zod schema. If you find yourself parsing LLM prose, stop and define a schema.
- **Service-role key is server-only.** Never import `supabaseAdmin()` in a client component. The browser only sees published data through server-rendered pages.
- **Two-endpoint pattern.** Streaming inference (`/api/analyze`) is separate from persistence (`/api/incidents/save`). Don't mix.
- **Commits are per-day.** `day-N: <what>` for atomic, reviewable history. Each push triggers Vercel preview + prod deploy.
- **LLM output language ≠ UI locale.** Two independent cookies (`copilot_locale`, `copilot_output_lang`). A user can have English UI + Chinese output.
- **Commands stay English in any language.** `kubectl logs` is universal; translating breaks copy-paste. The prompt's `languageInstruction()` enforces this.

---

## Gotchas / known footguns

- **`supabase/schema.sql` is the source of truth, but you must apply migrations manually.** MCP `apply_migration` has been flaky for this project. Use the Supabase dashboard SQL editor for one-off `alter table` statements; keep the `schema.sql` file updated for fresh setups.
- **`PROMPT_VERSION` constant is back-compat shim** (aliased to `DEFAULT_PROMPT_VERSION`). Prefer `getSystemPrompt(version)` and `DEFAULT_PROMPT_VERSION` directly.
- **Old analyses with no `output_language` value default to `'en'`** via the column default. Eval batch will count them as English unless you explicitly filter.
- **DeepSeek key leak risk:** `.env.local` is gitignored — be careful with `git log -p` reviews and never paste keys into chats.
- **`AGENTS.md` says "This is NOT the Next.js you know"** — Next 16 has breaking changes from older versions. If unsure of an App Router API, check `node_modules/next/dist/docs/` first.

---

## Recent changes (last 5 commits)

> Update this section after each push. Keep to one line per commit. Older history lives in `git log`.

- `refactor(http)` — **one error envelope for all 9 API routes** ([`src/lib/http.ts`](./src/lib/http.ts): `apiError(status,code,message)`, `validationError(zodError)`, `invalidJson()`). Removed two duplicate `jsonError` helpers (analyze/investigate) and ~25 inline `NextResponse.json({error,message,statusCode},{status})` call sites. Fixed a real inconsistency: `/api/webhook/alert` was omitting `statusCode` from its error bodies. Envelope matches the `ErrorResponse` contract in this file (`{error,message,statusCode,nextAction?}`). 5 unit tests; verified live (webhook empty-body now `statusCode:400`, validation joins Zod issues, invalid-JSON uniform).
- `fix(cost)` — **capture token usage on the streaming `/api/analyze` path** (was the long-standing KNOWN LIMITATION — only rerun/scenario/batch had cost). `streamObject.onFinish` knows usage but it's too late for a response header, and `useObject` hides it. Fix: server appends a one-line USAGE TRAILER after the object JSON, delimited by ASCII Record Separator `0x1e` (never legal in JSON); a client fetch middleware ([`src/lib/streamUsage.ts`](./src/lib/streamUsage.ts)) strips it back off before `useObject` parses, and forwards `{tokens_in,tokens_out,cost_usd}` to `/api/incidents/save` (new optional `usage` field → 3 existing columns, no migration). Two-endpoint split preserved (analyze still writes no DB). 7 unit tests incl. sentinel-split across chunk boundaries; verified live (sentinel byte 9215/9274, body parses, cost matches DeepSeek pricing, persisted exactly).
- `test` — **first unit-test suite** (`vitest`, 37 tests, offline/deterministic/zero-cost). Covers the highest-blast-radius pure logic: the agent **control gate** ([`tools.test.ts`](./src/lib/agent/tools.test.ts) — refuses write/unknown tools, per-tool call cap, log budget), alert parsers (Datadog/PagerDuty/Sentry + malformed fallback), `cost`/`normalizeUsage` (v3↔v4 SDK shapes), `secretScan` (false-negative coverage), `rubric.overallScore`. `npm test` / `npm run test:watch`; wired into CI after lint. Complements the LLM-in-the-loop `npm run agent --selftest` and eval batch.
- `feat(agent)` — **agentic investigator**: turned the single-shot analyzer into a HAND-WRITTEN tool-use loop ([`src/lib/agent/`](./src/lib/agent)). The agent gets only the *alert* and must DISCOVER evidence via 4 read-only tools (`get_metrics`/`get_logs`/`get_deploy_history`/`search_runbooks`) before concluding. Loop control is ours, not the SDK's: `generateText` with tools that have **no `execute`** returns tool calls and stops; we dispatch, budget-trim, append, and decide whether to continue in our own `while` (no `maxSteps`/`stopWhen`). Scenarios restructured into typed `signals` (metrics/logs/deploys/notes) so tools return slices; `context` prose kept for the single-shot baseline. **Boring-but-critical parts:** context budget (`get_logs` returns last N + true total, observations char-clamped), scratchpad state (re-injected each round, dedup guard), control gate at the dispatch layer (read-only whitelist refuses `execute_rollback`/`restart_service`/unknown tools + per-tool call cap), recovery (empty/error/duplicate/model-error all continue, step-cap → best-effort + "incomplete" flag). **Phase 2** emits the same 9-section `AnalysisSchema` via one `generateObject`. All 5 scenarios: correct root cause + severity, self-terminate in 3–5 loop steps, ~$0.006/run. New: `/api/investigate` (returns analysis+trace+usage inline, no DB), `/investigate` trace-timeline UI, `npm run agent` (+`--selftest` = free offline gate/budget checks, 9/9 pass), `npm run evals:agentic` (single-vs-agentic before/after, adds optional 6th dim **evidence_grounding** judged against the trace, kept OUT of `overall` for comparability with historical evals). See [`notes/agentic-harness.md`](./notes/agentic-harness.md).
- `feat(cli)` — `sre-copilot-cli` standalone npm package in [`cli/`](./cli): `pbpaste | sre analyze` pipes stdin to `/api/webhook/alert`, polls new `GET /api/incidents/[id]` JSON endpoint, prints formatted summary + top root causes / checklist / mitigations in the terminal. Zero deps, ESM, Node 20+. Flags: `--open --json --no-wait`. Env: `SRE_COPILOT_URL`, `SRE_COPILOT_SECRET`. Day-1 deployable at any new job (no infra approval).
- `eval-run-3` — **n=3 repeats** (`EVAL_REPEATS`, mean±std + pairwise "stands out/inside noise"). Headline: **the version gaps were noise** — within-cell std 0.2–0.46 > every between-version delta (v1 4.62±0.33, v2 4.48±0.24, v3 4.60±0.26; all pairwise inside noise). What survives: v2 weakest in all 3 runs (consistent ordering), zh<en in nearly every cell. **Flipped DEFAULT_PROMPT_VERSION v2→v3** (tied with v1 on quality, better-maintained bilingual; not because it scored higher). See `notes/eval-run-3.md`.
- `eval-run-2` — Prompt **v3** (v2 minus over-constraints + substance directive + zh brevity guard); n=30 batch (v1/v2/v3 × en/zh × 5), retry-on-parse-error (30/30 ok). v3=4.52 vs v2=4.36, v1=4.50 (later shown to be within noise by run-3). New `npm run evals:calibrate` (human-vs-judge Spearman/bias tool).
- `feat(integrations)` — POST /api/webhook/alert (Datadog/PagerDuty/Sentry direct webhook, 202 + bg analysis via `after()`); /mcp-usage dashboard reading mcp_tool_calls; sample-alert buttons on home; secret-pattern scan blocks KB ingest of files containing API keys (with `allowSecrets` override)
- `feat(mcp-ops)` — bearer-token auth (env-gated via `MCP_AUTH_TOKEN`, public when unset), 50 req/min rate limit per IP, audit logging of every tool call to `mcp_tool_calls` (tool/ok/latency/ip/summary/size — no full input or output stored)
- `feat(mcp)` — expose the app as an **MCP server** at `/api/mcp` (Streamable HTTP). 7 tools (search_kb, find_similar_incidents, list_scenarios, get_scenario, parse_alert_json, get_output_schema, save_incident_analysis). Lets users drive analysis from their own Claude Code with zero LLM cost to the platform.
- `feat(vision)` — screenshot upload → OpenAI gpt-4o-mini → description appended to raw_context
- `feat(alerts)` — parse Datadog / PagerDuty / Sentry webhook JSON via "Parse alert JSON" button; auto-fills service/title/symptoms + structures the raw_context
- `feat(kb)` — RAG knowledge base (runbooks/postmortems/service catalog); ingest CLI; retrieved chunks injected into every analysis prompt; audit trail in `analysis_kb_chunks`; `/kb` management page
- `fix(supabase)` — defer admin client init (same module-load env bug pattern as ai.ts)
- `feat(similar)` — pgvector HNSW + pg_trgm fallback; "Similar past incidents" section on detail page; backfill script
- `feat(ops)` — GitHub Actions CI (tsc + lint + build on push/PR) + `/api/healthz` (readiness probe)
- `feat(cost)` — tokens_in/tokens_out/cost_usd on every non-streaming analysis; rollup in `/evals` dashboard
- `eval-run` — First successful 20-eval batch: v1=4.64, v2=4.44, en=4.60, zh=4.47. v2 *regressed*; investigate over-constraint in v3.
- `fix(ai)` — defer DeepSeek provider init; tsx scripts can now load env before module-time client capture
- `day-31` — i18n (zh/en UI) + LLM output language toggle + cross-lingual eval matrix (20 evals)
- `fix` — persist `severity_reasoning` end-to-end (was silently dropped on save, biasing judge low)
- `day-22-30` — README/blog drafts/portfolio.md; production build green; 11 routes
- `day-15-21` — Eval pipeline: rubric v1, LLM-as-judge, `/evals` dashboard, `EVALUATION.md`
- `day-11-14` — Prompt v2 + versioned routing; UI version switcher; per-row `prompt_version`

---

## How to continue work in a new Claude session

```
1. cd into the repo root
2. Read CLAUDE.md (this file) — autoloaded
3. `git log --oneline -10` to see recent commits
4. `git status` to see uncommitted work
5. Ask the user what they want next; reference specific files by path (e.g. "I'll edit src/lib/prompts.ts to add v3")
```

When you finish a session that ships a commit, update the "Recent changes" section above with one line.
