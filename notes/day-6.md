# Day 6 — Demo rate limiting

## Done
- `src/lib/rateLimit.ts` — in-memory token bucket, 5 req/min/IP, resets on cold start
- `/api/analyze` returns 429 `RATE_LIMITED` with `retryAfterSec` if exceeded
- "Demo · 5 req/min" badge in the page header

## Decisions
- **Skipped magic-link auth** for now. For a portfolio demo, friction-free is the goal. If we want per-user spaces later, add Supabase Auth in Week 4
- **In-memory limiter, not Redis**: cold starts reset the counter, which is fine for a portfolio demo. Note this in the README as a "known limitation / future work" — gives me something to say in an interview ("If I were taking this to prod, I'd swap in Upstash Redis for a distributed limiter")

## Verified
- tsc clean

## Next (Day 7)
- Week 1 retrospective notes
