# Postmortem: payment-svc DB connection pool exhaustion — 2026-03-12

**Severity:** SEV1
**Duration:** 18 minutes (14:02 – 14:20 UTC)
**Author:** Yan (on-call) · Reviewed by: payments-platform team

## Summary
A nightly settlement batch job introduced in payment-svc v2.41 began running every 30 seconds (intended: nightly), each invocation holding 8 database connections for ~2.4s while performing a full-table scan on `ledger_entries`. Within 3 minutes, the 500-connection Postgres pool was fully consumed, starving all foreground checkout traffic. 12% of checkouts failed during the window. Estimated revenue impact: $87k.

## Timeline (UTC)
- **13:50** — payment-svc v2.41 deployed (rolling, 100% by 13:54). Changelog mentioned "added nightly settlement batch".
- **14:02:08** — first alert: `PaymentSvcErrorRateHigh` (3% errors).
- **14:03:15** — CS reports failed checkout volume rising.
- **14:04** — On-call paged.
- **14:06** — Initial mis-diagnosis: "DB looks healthy, CPU is fine" — looked at CPU only, missed `active_connections` saturation.
- **14:11** — Correct diagnosis: connection pool exhausted (active_connections = 500/500).
- **14:14** — Identified batch job via `pg_stat_activity` showing recurring `SELECT * FROM ledger_entries WHERE status='pending'`.
- **14:16** — Rolled back to v2.40.
- **14:20** — Error rate returned to baseline.

## Impact
- 12% of checkout requests failed for 18 minutes
- Estimated $87k in lost transactions (deferred not lost; users mostly retried)
- ~340 customer support tickets generated (handled within 24h)

## Root cause
Cron schedule in v2.41's batch job was `*/30 * * * *` (every 30 min — but mis-read in code review as "every 30 seconds"; actual node-cron parsing interpreted it as every 30 seconds due to a separate version mismatch in the cron library). Each invocation:
1. Acquired 8 connections from the pool
2. Held them during a full-table scan (no index on `ledger_entries.status` — also a v2.41 omission)
3. Released them after 2.4s on average

At 30-second cadence with 2.4s execution and 8 connections per run, steady-state consumption was ~64 connections per app instance. With 12 instances and pre-existing pool pressure from normal traffic, the 500-connection cap was reached in ~3 minutes.

## What went well
- Rollback was clean and fast once root cause was identified
- pgbouncer prevented total cascade — only payment-svc traffic was affected
- On-call had pg_stat_activity query muscle-memory

## What went poorly
- **Initial diagnosis fixated on CPU.** Should have checked `active_connections` immediately on any DB-related alert.
- **Code review missed the cron schedule misreading.** The PR description said "nightly" but the schedule wasn't called out.
- **No index on `ledger_entries.status`** even though the query patterns were known. The reviewer should have caught this in the v2.41 PR.
- **No staging canary** for the batch job — it ran straight in prod.

## Action items
- [x] Add `active_connections` to the default oncall dashboard (done same day)
- [x] Add index `CREATE INDEX CONCURRENTLY ON ledger_entries (status)` (deployed 03-13)
- [ ] PR template now requires explicit "Cron schedule:" line for any background work (in progress)
- [ ] Pre-deploy lint that flags `*/N` cron schedules where N < 60 (proposal stage)
- [ ] Per-service connection pool limits in pgbouncer (so one service can't exhaust the global pool)

## Lessons
- Pool exhaustion looks like network errors to the app, not DB errors. The "connection refused" log line was misleading.
- CPU is the wrong first thing to check on a DB incident; connections are first.
- Any new background job is a SEV-1 candidate until it's run in prod for a week.
