// Curated SRE scenario library. Each scenario has enough context to be a realistic
// regression test for prompt iterations and the eval pipeline.

export type Scenario = {
  slug: string;
  title: string;
  category: "Database" | "Deploy" | "Dependency" | "Network" | "Capacity";
  service: string;
  symptoms: string;
  context: string;
  expected_severity: "SEV1" | "SEV2" | "SEV3";
  expected_root_cause: string;
};

export const SCENARIOS: Scenario[] = [
  {
    slug: "db-connection-pool-exhausted",
    title: "Payment service connection pool exhaustion after batch job deploy",
    category: "Database",
    service: "payment-svc",
    symptoms: "p99 latency 4.8s (up from 120ms), 12% 500 error rate, customers report failed checkouts",
    context: `Time: 14:02 UTC. payment-svc p99 latency jumped from 120ms to 4.8s within ~3 minutes.
Error rate climbed from 0.1% to 12% (mostly HTTP 500).
Application logs (last 5min): repeated "FATAL: sorry, too many clients already" and "connection refused"
from payment-svc → postgres-primary.

Postgres metrics:
- CPU: 35% (normal)
- active_connections: 500 / 500 (max_connections)
- waiting_queries: 87
- slow_query_log shows a new query running every 30s: SELECT * FROM ledger_entries WHERE status='pending'
  (no index on status; full table scan over ~12M rows, ~2.4s per execution)

Deploy history:
- 13:50 UTC — payment-svc v2.41 shipped. Changelog mentions "added nightly settlement batch (cron: */30 * * * *)"
- No infra/DB changes in past 7 days.

On-call notes (Slack):
- 14:03 — CS reports failed checkout volume rising
- 14:04 — Pager: PaymentSvcErrorRateHigh
- 14:06 — "DB looks healthy, CPU is fine" (initial mis-diagnosis)`,
    expected_severity: "SEV1",
    expected_root_cause:
      "Batch job introduced in v2.41 runs every 30s, holds long connections during full-table scan on ledger_entries (no index on status), exhausting the 500-connection pool and starving foreground checkout traffic.",
  },
  {
    slug: "bad-deploy-memory-leak",
    title: "Order service OOM crashloop following v3.7 deploy",
    category: "Deploy",
    service: "order-svc",
    symptoms: "Pods OOM-killed every ~20min, restart loop, p99 latency degraded, ~3% requests timing out",
    context: `Time: 09:15 UTC. order-svc pods entering CrashLoopBackOff with OOMKilled exit reason.

Kubernetes:
- Pods: 12 total, 3 currently OOMKilled, 9 running
- Memory limit: 512Mi, requests: 256Mi
- Recent restarts/hour: 18 (up from baseline of 0–1)
- HPA scaling has hit max replicas (12)

Memory trend (last 24h):
- Steady linear growth from 180Mi at 04:00 UTC to 500Mi at 09:00 UTC, then crash
- Pre-deploy baseline: stable at 200Mi indefinitely

Deploy history:
- 04:00 UTC — order-svc v3.7 deployed (rolling, 100% complete by 04:08)
- Changelog: "switched JSON parser to fast-json-stringify; added in-process request cache (Map-based, no eviction)"

Logs:
- No FATAL/ERROR pattern; pods exit silently
- Heap profile from one captured pod shows: ~340Mi held by Map keyed on request ID, never cleared

On-call:
- 09:12 — first OOMKilled pod
- 09:14 — pager
- 09:16 — service still serving most traffic via remaining pods; checkout success rate dipped from 99.7% → 96.8%`,
    expected_severity: "SEV2",
    expected_root_cause:
      "v3.7 added an unbounded in-process Map cache (no TTL, no max size) keyed by request ID, causing linear memory growth until OOM. Rollback to v3.6 or hotfix to add LRU eviction.",
  },
  {
    slug: "upstream-dependency-timeout",
    title: "Third-party payment gateway timeouts cascade into checkout outage",
    category: "Dependency",
    service: "checkout-svc",
    symptoms: "Checkout success rate dropped from 99.5% to 22%, p99 latency 28s (hitting 30s timeout), thread pool exhausted",
    context: `Time: 18:40 UTC. checkout-svc starts returning HTTP 504 to ~78% of checkout attempts.

Symptoms:
- p99 latency: 28s (hitting our 30s gateway timeout)
- Success rate: 22% (down from 99.5%)
- Thread pool utilization: 100% (all 200 worker threads blocked)
- Inbound queue depth: 4200 requests (queue limit 5000)

Downstream calls (from APM):
- Stripe Connect API (/v1/payment_intents): p99 jumped from 800ms to 27s
- Stripe status page: "Investigating elevated latency for Connect endpoints in us-east-1" (posted 18:35 UTC)
- All other downstream deps (auth-svc, fraud-svc) normal

Our config:
- Stripe call timeout: 30s (matches inbound)
- No circuit breaker on Stripe client
- No bulkhead — Stripe calls share the main worker thread pool

Customer impact:
- Failed checkouts: ~3000 in 5min
- Estimated lost GMV: $180k (so far)

On-call:
- 18:38 — pager
- 18:41 — confirmed Stripe is the culprit (status page + APM)
- 18:43 — debating: wait it out vs disable Stripe path entirely`,
    expected_severity: "SEV1",
    expected_root_cause:
      "Stripe Connect us-east-1 elevated latency caused our 30s timeouts to fire serially; with no circuit breaker and no bulkhead, all 200 worker threads got blocked on Stripe, queueing all other traffic. Need circuit breaker + dedicated Stripe thread pool + shorter timeout (e.g. 8s with retry).",
  },
  {
    slug: "dns-misconfiguration",
    title: "Regional 5xx spike after DNS TTL change",
    category: "Network",
    service: "api-gateway",
    symptoms: "us-west-2 region: 35% 502 errors, p99 4s. us-east-1: normal. New DNS record deployed 30min before incident.",
    context: `Time: 22:10 UTC. api-gateway in us-west-2 returning HTTP 502 for ~35% of requests. us-east-1 unaffected.

Symptoms (us-west-2 only):
- 502 rate: 35% (baseline 0.05%)
- p99 latency: 4s (mostly DNS resolution timeouts in error trace)
- nginx upstream errors: "upstream timed out (110: Connection timed out) while connecting to upstream"

Recent changes:
- 21:40 UTC — DNS team changed TTL for internal-services.example.com from 300s → 30s as part of a planned migration
- Also changed CNAME target: internal-services.example.com now points to a NEW NLB (was pointing to a legacy ALB)
- Old ALB still up and answering, but its DNS records were not removed
- New NLB was created in us-east-1 only — no us-west-2 record exists

Logs:
- nginx in us-west-2 trying to resolve internal-services.example.com → getting NXDOMAIN or stale IPs
- ~30% of pods have cached the old ALB IP and are working; rest are failing
- us-east-1 pods all resolve correctly to the new NLB

On-call:
- 22:08 — pager
- 22:11 — DNS team confirms the planned change
- 22:12 — debate: revert DNS or hot-patch us-west-2 to point at us-east-1 NLB`,
    expected_severity: "SEV1",
    expected_root_cause:
      "DNS migration created the new NLB in us-east-1 only; us-west-2 pods that refresh their DNS cache get NXDOMAIN/stale results. Rollback the DNS change (restore previous CNAME) and re-do migration with NLBs in both regions before flipping DNS.",
  },
  {
    slug: "cache-stampede",
    title: "Cache stampede after Redis key expiry on Black Friday morning",
    category: "Capacity",
    service: "catalog-svc",
    symptoms: "DB CPU 100%, p99 latency 15s, intermittent 503s, Redis CPU normal but cache miss rate at 95%",
    context: `Time: 09:00 UTC, Black Friday. catalog-svc latency exploded at exactly 09:00:00 UTC.

Symptoms:
- catalog-svc p99: 15s (baseline 80ms)
- 503 rate: 8% (intermittent during DB overload)
- Postgres CPU: 100% sustained, lock waits climbing
- Redis CPU: 25% (looks healthy)
- Redis cache miss rate for keys matching "catalog:item:*": 95% (baseline 2%)
- All product detail page requests are flooding through to DB

Background:
- We pre-warm the homepage catalog cache every night at 02:00 UTC with TTL=7h
- 02:00 UTC + 7h = 09:00 UTC ← all keys expired simultaneously
- Black Friday traffic ramp: 12x normal at 09:00 UTC (marketing email blast)
- No per-key locking; every cache miss triggers a fresh DB query

Logs:
- 08:59:58 UTC — last cache hit logged
- 09:00:00 UTC — first wave of "cache miss + DB query" log lines
- 09:00:02 UTC — DB connection pool hits ceiling, queries start queueing

On-call:
- 09:02 — pager (multiple alerts: DBHighCPU, CatalogSvcLatencyHigh, CheckoutErrorRate)
- 09:03 — diagnosis: cache stampede confirmed by Redis miss-rate metric
- 09:05 — debating: extend TTL (won't help in flight), warm cache manually (DB is the bottleneck), or shed load`,
    expected_severity: "SEV1",
    expected_root_cause:
      "All catalog cache keys had identical TTL set during nightly warmup; expired simultaneously at peak traffic. No per-key locking → every concurrent miss triggers its own DB query (cache stampede). Mitigation: enable singleflight/per-key lock, add jitter to TTLs, pre-warm before peak.",
  },
];
