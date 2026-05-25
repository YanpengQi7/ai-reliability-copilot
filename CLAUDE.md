@AGENTS.md

# AI Reliability Copilot — agent context

This file is read first by Claude Code / agents joining the project. Skim top-to-bottom, then dive into the file you need.

---

## 30-second orientation

**What this is:** Next.js app that turns a production incident (logs + metrics + on-call notes) into a structured 9-section LLM response (severity, root causes, investigation checklist, mitigation, postmortem draft, follow-ups). Ships with a 5-scenario regression suite + LLM-as-judge eval pipeline.

**Why it exists:** Portfolio project for AI Reliability Engineer / Staff Engineer roles. The *product* is the LLM tool; the *engineering* is the eval pipeline.

**Live:** https://ai-reliability-copilot.vercel.app · **Repo:** https://github.com/YanpengQi7/ai-reliability-copilot

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
| **Daily build log** | `notes/day-*.md`, `notes/week-*-findings.md` | Read latest one to see current state |
| **Methodology** | `EVALUATION.md` | Public-facing eval methodology + limitations |
| **Portfolio assets** | `docs/portfolio.md`, `docs/blog-*.md` | Resume bullets, CARL stories, blog drafts |

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

### Add a new rubric dimension
1. Extend `RubricDim` enum + `DimensionScore` + `RubricScores` + `RUBRIC_DEFINITIONS` in `src/lib/eval/rubric.ts`
2. Update `overallScore()` if weighting changes
3. Update `/evals` dashboard `dims` array + `dimLabelKey`
4. Add i18n keys for the new dim label

### Add a new DB column
1. `supabase/schema.sql` — add column (keep idempotent with `add column if not exists`)
2. Apply to live DB (Supabase SQL editor or `mcp__supabase__apply_migration` if MCP works)
3. Update `src/lib/db.ts` row type
4. Update INSERT statements in **all 4** write endpoints + `scripts/run-evals.ts`
5. (If reading) update detail page render

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
- **DeepSeek key leak risk:** `.env.local` is gitignored, but be careful with `git log -p` reviews. We had one leak via chat early on.
- **`AGENTS.md` says "This is NOT the Next.js you know"** — Next 16 has breaking changes from older versions. If unsure of an App Router API, check `node_modules/next/dist/docs/` first.

---

## Recent changes (last 5 commits)

> Update this section after each push. Keep to one line per commit. Older history lives in git log + `notes/day-*.md`.

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
1. cd "/Users/yanpengqi/sre project/copilot"
2. Read CLAUDE.md (this file) — autoloaded
3. Read the latest notes/day-*.md for the previous session's state
4. `git log --oneline -10` to see recent commits
5. `git status` to see uncommitted work
6. Ask the user what they want next; reference specific files by path (e.g. "I'll edit src/lib/prompts.ts to add v3")
```

When you finish a session that ships a commit, update the "Recent changes" section above with one line.
