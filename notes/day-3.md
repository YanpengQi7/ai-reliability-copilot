# Day 3 — Incident persistence + list + detail page

## Done
- `src/lib/db.ts` — typed Supabase read helpers (`listIncidents`, `getIncidentWithAnalyses`, `hasSupabase`)
- `/incidents` server-rendered list, sorted desc by created_at, empty-state when DB unconfigured
- `/incidents/[id]` server-rendered detail: raw context + latest analysis fully rendered + collapsed older versions
- Reused the same 9-section render structure as the home page

## Decisions
- Both list pages are `force-dynamic` — incidents come and go, don't cache stale data on Vercel
- Older analyses collapsed behind `<details>` to keep page scannable; we'll need this for Week 2 prompt-version comparison
- Detail page is server-rendered (no client JS) — fast load, good for sharing links

## Verified
- tsc clean
- Without Supabase env: pages render empty-state instead of crashing

## Next (Day 4)
- Polish summary card (severity reasoning surfaced); add markdown rendering for postmortem_draft
