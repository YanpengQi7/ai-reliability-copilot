# Service catalog (extract)

## payment-svc
- **Team:** payments-platform
- **Tier:** SEV1 (revenue-critical)
- **Upstream:** checkout-svc, retry-orchestrator
- **Downstream:** Stripe Connect (us-east-1), fraud-svc, audit-log
- **DB:** postgres-primary.payments (shared with subscription-svc, refund-svc)
- **Region:** us-east-1 primary, us-west-2 warm replica
- **Notes:** All endpoints idempotent. Safe to retry. Connection pool 80/instance.

## checkout-svc
- **Team:** storefront
- **Tier:** SEV1
- **Upstream:** web-frontend, mobile-api
- **Downstream:** payment-svc, inventory-svc, fraud-svc, Stripe Connect (direct, for some flows)
- **DB:** postgres-storefront (dedicated)
- **Region:** us-east-1, us-west-2 (active-active)
- **Notes:** Stripe timeout is 30s. No circuit breaker as of 2026-Q1 (planned for Q2). Thread pool size 200.

## order-svc
- **Team:** storefront
- **Tier:** SEV2 (order placement requires this but read-only views can degrade)
- **Upstream:** checkout-svc, mobile-api
- **Downstream:** inventory-svc, notification-svc
- **DB:** postgres-orders
- **Region:** us-east-1, us-west-2
- **Notes:** Memory limit 512Mi. Watch for unbounded in-process caches — has bitten us twice.

## catalog-svc
- **Team:** storefront
- **Tier:** SEV2 (catalog is read-heavy, cached aggressively)
- **Upstream:** web-frontend, mobile-api
- **Downstream:** postgres-catalog, Redis cache cluster `cache-catalog`
- **Region:** us-east-1, us-west-2
- **Notes:** Cache pre-warmed nightly at 02:00 UTC, TTL 7h. **Known issue:** cache stampede when TTL expires at peak; mitigation via singleflight is planned (ticket SRE-2014). Add jitter to TTL as workaround.

## api-gateway
- **Team:** platform
- **Tier:** SEV1
- **Upstream:** internet (via CloudFront)
- **Downstream:** all services
- **Region:** all regions
- **Notes:** nginx upstream timeout 60s. DNS TTL for internal CNAMEs is 30s (was 300s before 2025-Q4 — be aware of cached IPs across pods).

## SLOs
| Service | Availability | Latency p99 |
|---|---|---|
| payment-svc | 99.95% | 300ms |
| checkout-svc | 99.95% | 500ms |
| order-svc | 99.9% | 1s |
| catalog-svc | 99.95% | 200ms (cached) |
| api-gateway | 99.99% | 50ms (passthrough) |

## On-call escalation
1. Service team (PagerDuty)
2. SRE on-call (15 min if no ack)
3. Engineering manager (30 min if no resolution)
4. VP Eng (60 min, SEV1 only)
