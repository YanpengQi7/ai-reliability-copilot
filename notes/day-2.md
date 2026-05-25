# Day 2 — Streaming + friendly errors + title field

## Done
- `/api/analyze` switched from `generateObject` to `streamObject` → progressive partial-object stream
- Friendly UI error when `DEEPSEEK_API_KEY` is missing on server (tells user where to set it in Vercel)
- Added `title` field; nav bar (New / Incidents / Scenarios / Evals) to prep for upcoming pages
- Client uses `@ai-sdk/react`'s `experimental_useObject` hook + `AnalysisSchema`
- Persistence moved into `onFinish` callback (fires after stream completes)

## Decisions
- Combined Day 2 (title/persist) + Day 5 (streaming) — they touch the same files, doing both at once avoids churn
- Render is fully defensive: every section gates on its own field being defined, so partial streams render cleanly

## Verified
- `tsc --noEmit` clean
- Local dev still serves 200

## Next (Day 3)
- `/incidents` list + `/incidents/[id]` detail pages reading from Supabase
