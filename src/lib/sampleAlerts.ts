// Canned webhook payloads (real-shape, fabricated content) used to demo the
// "Parse alert JSON" flow without needing a real alerter wired up.

export type SampleAlert = { label: string; source: "datadog" | "pagerduty" | "sentry"; payload: object };

export const SAMPLE_ALERTS: SampleAlert[] = [
  {
    label: "Datadog: payment-svc DB pool exhausted",
    source: "datadog",
    payload: {
      alert_id: "12345678",
      alert_title: "[Triggered on {service:payment-svc}] PaymentSvcErrorRateHigh",
      alert_metric: "trace.express.request.errors",
      alert_query: "avg(last_5m):sum:trace.express.request.errors{service:payment-svc,env:prod}.as_rate() > 0.05",
      alert_status: "Triggered",
      alert_transition: "Triggered",
      alert_priority: "P2",
      host: "ip-10-0-12-44.ec2.internal",
      tags: "service:payment-svc,env:prod,team:payments-platform,region:us-east-1",
      date: Math.floor(Date.now() / 1000),
      body: "payment-svc error rate 8.4% over last 5min (threshold 5%). Recent deploy v2.41 at 13:50 UTC.",
      link: "https://app.datadoghq.com/event/event?id=12345678",
    },
  },
  {
    label: "PagerDuty: order-svc OOM crashloop",
    source: "pagerduty",
    payload: {
      event: {
        event_type: "incident.triggered",
        occurred_at: new Date().toISOString(),
        data: {
          incident: {
            id: "PXYZABC",
            title: "Order service pods OOMKilled in prod",
            description: "Multiple order-svc pods entering CrashLoopBackOff with OOMKilled exit reason. Memory steadily climbing post v3.7 deploy.",
            urgency: "high",
            status: "triggered",
            service: { summary: "order-svc", name: "order-svc" },
            html_url: "https://yourorg.pagerduty.com/incidents/PXYZABC",
            created_at: new Date().toISOString(),
          },
        },
      },
    },
  },
  {
    label: "Sentry: checkout-svc 500 spike",
    source: "sentry",
    payload: {
      action: "created",
      data: {
        issue: {
          id: "ISSUE-99021",
          title: "TimeoutError: Stripe API request exceeded 30000ms",
          culprit: "checkout-svc/src/routes/checkout.ts in createPaymentIntent",
          level: "error",
          environment: "production",
          project: { slug: "checkout-svc", name: "checkout-svc" },
          metadata: { type: "TimeoutError", value: "Stripe API request exceeded 30000ms", filename: "src/lib/stripe.ts" },
          count: 4218,
          userCount: 1842,
          firstSeen: new Date(Date.now() - 10 * 60_000).toISOString(),
          lastSeen: new Date().toISOString(),
          permalink: "https://yourorg.sentry.io/issues/ISSUE-99021/",
        },
      },
    },
  },
];
