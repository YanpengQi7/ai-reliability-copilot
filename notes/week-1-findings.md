# Week 1 — Retrospective & Prompt v1 Findings

## What shipped
- End-to-end MVP: input incident → streaming 9-section structured analysis → persist → list/detail views → re-run
- Deployed on Vercel with auto-deploy from main; GitHub public repo
- Demo rate limiting; friendly errors when env vars missing

## Architecture choices that paid off
1. **Zod-first schema** — every change to the output shape starts in `src/lib/schema.ts`. Server, client, and DB all consume the same source of truth. This caught 2 bugs already where I forgot to update a renderer.
2. **Streaming via `streamObject`** — the perceived latency is dramatically better than blocking; users see severity + summary within ~2s even though full output takes 15–20s.
3. **Two-endpoint split** (`/api/analyze` vs `/api/incidents/save`) — keeps streaming clean, makes "anonymous demo without persistence" trivial.

## Prompt v1 — known weaknesses (to fix in Week 2 with v2)
After running 3+ sample incidents through, the recurring failure modes:

| # | Failure mode | Example | Fix idea for v2 |
|---|---|---|---|
| 1 | **Generic commands** | "check the logs" instead of `grep -i 'connection refused' /var/log/payment-svc.log` | Few-shot examples showing specific kubectl/grep/SQL commands |
| 2 | **Postmortem too short** | Half-page draft missing Timeline and "What went well" sections | Provide an explicit postmortem template in the system prompt |
| 3 | **Severity under-rating** | Calls a customer-facing 12% error rate SEV2 instead of SEV1 | Tighten severity rubric with concrete thresholds (e.g. ">1% user-facing → SEV1") |
| 4 | **Mitigation skips rollback** | "Restart payment-svc" with empty rollback field | Add a rule: every mitigation MUST have a non-empty rollback |
| 5 | **Root causes not ranked well** | All 3 hypotheses marked "medium" | Few-shot showing distinct likelihood reasoning |

## Numbers
- p50 stream completion: ~12s (deepseek-chat, ~2k input + ~2k output tokens)
- Cost per analysis: ~$0.002 (deepseek-chat pricing)

## Next (Week 2)
- 5 scenarios with curated `expected_root_cause` for later eval
- Prompt v2 targeting the 5 weaknesses above
- Side-by-side v1 vs v2 comparison page
