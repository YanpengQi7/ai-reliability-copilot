# Day 4 — Save endpoint + post-analyze redirect + markdown postmortem

## Done
- New `POST /api/incidents/save` endpoint takes the completed analysis + raw input, persists both rows, returns `{incident_id, analysis_id}`
- Removed inline persistence from `/api/analyze` → it's now a pure inference endpoint, cleaner separation
- Home page: after stream finishes (`useObject.onFinish`), client posts to `/api/incidents/save` and redirects to `/incidents/[id]`
- `react-markdown` + `@tailwindcss/typography` plugin for nicely-rendered postmortem drafts in both home preview and detail page

## Decisions
- **Two endpoints, not one**: streamObject can't easily return metadata (like the saved ID) alongside the stream. Splitting them keeps the streaming clean and lets the client decide whether to save (good for future "anonymous demo mode")
- Latency is measured client-side (request start → stream end) so it includes network time the user actually feels

## Verified
- tsc clean

## Next (Day 5)
- Polish: copy-paste buttons for code commands; "Re-run" button on detail page
