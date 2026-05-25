# Day 31 — i18n (UI) + LLM output language selection

## Done

### L1: UI i18n (zh/en)
- `src/lib/i18n/messages.ts` — single message catalog, ~70 keys × 2 locales
- `src/lib/i18n/server.ts` — `getLocale()` reads cookie, falls back to `Accept-Language`
- `src/lib/i18n/actions.ts` — server actions to set locale cookie (1-year TTL, lax)
- `src/lib/i18n/client.tsx` — React Context + `useT()` hook
- `<LanguageSwitcher />` + `<Nav />` — top-right toggle on every page
- All 4 pages (home, incidents list, incident detail, scenarios, evals) wired through `useT()` / `t(locale, key)`
- `<html lang>` reflects active locale

### L2: LLM output language
- `prompts.ts` — `OutputLanguage` type + `languageInstruction(lang)` appended to user prompt
  - Narrative fields → translate (summary, evidence, action, postmortem, customer_impact, follow-ups)
  - **Code fields → stay English** (commands, JSON keys, enum values, service/metric identifiers from raw context)
  - This is the key insight: a Chinese SRE still reads `kubectl logs` and `SELECT` — translating those breaks copy-paste
- Endpoints accept `output_language` (body field or `?language=` query):
  - `/api/analyze`, `/api/incidents/save`, `/api/incidents/[id]/rerun`, `/api/scenarios/[slug]/run`
- DB: new `output_language` column on `analyses` (default 'en'); persisted on every write path
- Home page: separate "Output:" toggle (independent of UI locale) — lets a user view English UI but request Chinese output (real workflow: Chinese on-call writes English UI, but produces Chinese postmortem for non-technical stakeholders)
- Detail page: shows `output: zh` badge in analysis metadata; history rows include language badge

### L3 (next): cross-lingual eval
- `scripts/run-evals.ts` now iterates 5 scenarios × 2 prompt versions × 2 languages = **20 evals**
- New summary tables: per-cell `(version, language)` overall + marginal averages by version / by language
- `/evals` dashboard: 2 aggregation tables now ("by version", "by language")

## Decisions
- **Hand-rolled i18n over next-intl.** 70 strings doesn't justify the boilerplate; the hand-rolled layer is ~80 lines and obvious. If we cross ~200 strings, swap in.
- **Cookie-based locale, not URL prefix.** Keeps URLs clean (`/incidents/abc`) and lets the same incident URL render correctly in either language.
- **UI locale and output language are independent cookies.** Reflects real usage: a bilingual engineer might prefer English UI but want Chinese postmortems.
- **Commands stay English.** Translating `kubectl logs -n prod` to 中文 makes it un-runnable. The prompt explicitly carves out command/JSON/enum content from translation.

## Verified
- `tsc --noEmit` clean
- `next build` succeeds; 11 routes all building

## Not yet done (waiting on user)
- DB migration `alter table analyses add column if not exists output_language text default 'en';` — pasted into Supabase SQL editor by user
- L3 cross-lingual eval batch run (needs DeepSeek key + column migration)

## Cost estimate for L3 batch
- 20 generations × ~2k input + ~2k output tokens (Chinese tokens are roughly 1:1 with English chars by volume) ≈ 80k tokens total
- 20 judge calls × ~3k input + ~500 output ≈ 70k tokens
- DeepSeek pricing: ~$0.0001/1k input, ~$0.0002/1k output
- Total: **~$0.03**
