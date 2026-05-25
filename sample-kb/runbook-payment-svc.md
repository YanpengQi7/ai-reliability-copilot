# Runbook: payment-svc

## Owner
Team: payments-platform
Slack: #payments-oncall
PagerDuty: payments-svc-primary

## What it does
`payment-svc` processes checkout transactions. Sits between `checkout-svc` (upstream) and Stripe Connect (downstream). All requests are idempotent — safe to retry.

## Architecture quick facts
- Runs as Kubernetes deployment `payment-svc` in `prod` namespace
- 12 replicas, HPA min=8 max=30, target CPU 70%
- Memory limit 512Mi, request 256Mi
- Connects to `postgres-primary.payments` (max_connections=500 shared with 4 other services)
- Connection pool: pgbouncer in transaction mode, pool_size=80 per app instance

## Common failure modes

### "FATAL: sorry, too many clients already" + p99 spike
- **Almost always** a runaway batch job holding connections during a long query
- Check recent deploys (last 2h) for new cron jobs or batch operations
- Query: `SELECT pid, query_start, query FROM pg_stat_activity WHERE state != 'idle' AND query_start < now() - interval '1 minute' ORDER BY query_start;`
- **Mitigation**: kill the long-running query (`pg_terminate_backend(pid)`), THEN roll back the deploy
- **Do NOT** restart payment-svc pods — they'll thrash trying to reconnect to a saturated pool

### OOMKilled pods after deploy
- Memory profile must be flat under steady traffic
- If memory grows monotonically, check for: in-process caches without eviction, request-id keyed maps, retained event listeners
- **Rollback first**, debug after

## SLO
- Availability: 99.95% (allows ~22min/month downtime)
- p99 latency: < 300ms (excluding Stripe call time)
- Error rate: < 0.1%

## Severity policy (overrides generic SEV rubric)
- Payment failure rate > 0.5% sustained 3min → **SEV1** (revenue impact)
- p99 > 1s for 10min → **SEV2**
- Single pod restart → not paged

## Useful commands
```bash
# Recent error breakdown
kubectl logs -n prod -l app=payment-svc --since=15m | grep -iE "ERROR|FATAL" | awk '{print $NF}' | sort | uniq -c | sort -rn | head

# Active DB connections by app
kubectl exec -n prod postgres-primary-0 -- psql -c "SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC;"

# Force a rollback
kubectl rollout undo deployment/payment-svc -n prod
kubectl rollout status deployment/payment-svc -n prod
```

## Past incidents (most recent)
- 2026-03-12: SEV1, batch job v2.41 exhausted connection pool, 18min impact
- 2025-11-04: SEV2, slow Stripe response cascaded into thread exhaustion (fixed by adding circuit breaker)
- 2025-08-19: SEV1, OOM crashloop after upgrading json parser (in-process cache leak)
