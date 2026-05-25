# Day 1 — Scaffold

## Done
- `create-next-app` (Next 16, App Router, TS, Tailwind, Turbopack, src dir)
- Installed: `ai`, `@ai-sdk/deepseek`, `@supabase/supabase-js`, `zod`
- Supabase schema for 4 tables: `incidents`, `analyses`, `scenarios`, `evaluations`
- Zod `AnalysisSchema` — 9 structured sections, min/max constraints on arrays
- `src/lib/prompts.ts` — Prompt v1, system prompt with explicit "be specific / be safe / be honest" rules
- `src/lib/ai.ts` — DeepSeek provider via AI SDK
- `POST /api/analyze` — validates input, calls `generateObject`, best-effort persistence
- `/` page — sample incident, 9-section card UI, severity badges

## Decisions
- **DeepSeek over OpenAI** for cost; AI SDK adapter is provider-agnostic, easy to swap
- **`generateObject` (non-streaming) first** — Day 5 will switch to `streamObject`
- **Persistence is best-effort** — request succeeds even if Supabase env vars are missing, so the MVP is usable before DB is wired up
- **Skipped shadcn/ui** — new shadcn CLI requires interactive prompt; using raw Tailwind is fine for MVP, will revisit if needed

## Verified
- `tsc --noEmit` clean
- `npm run dev` → `http://localhost:3000` returns 200
- `POST /api/analyze` with short body returns proper `VALIDATION_ERROR`
- End-to-end LLM call: confirmed by user ("成功了")

## Next (Day 2)
- Switch `/api/analyze` to `streamObject` for streaming UX
- Friendly UI error when DeepSeek/Supabase keys are missing
- Add `title` field, prep `/incidents/[id]` route
