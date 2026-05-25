# Day 5 — Operator UX: copy buttons + re-run

## Done
- `<CopyButton />` client component — hover over an investigation command, click to copy
- `<ReRunButton />` on incident detail page → calls `POST /api/incidents/[id]/rerun`
- Re-run endpoint generates a fresh analysis against the same incident, appends to `analyses` table, returns latency
- After re-run, `router.refresh()` re-pulls the server-rendered page (new analysis bumps to "latest", old falls into the collapsed history)

## Decisions
- Used `generateObject` for re-run (not stream) — re-run is invoked from the detail page, no need for streaming UX, simpler
- Copy button reveals on hover only — keeps the UI quiet at rest

## Verified
- tsc clean

## Next (Day 6)
- Auth gating — for portfolio demo, defer real auth; add a "Demo mode" indicator and rate-limit by IP server-side
