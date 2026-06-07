import { describe, it, expect } from "vitest";
import { tryParseAlert } from "./alertParsers";

describe("tryParseAlert — non-JSON / malformed", () => {
  it("returns null for plain prose (caller falls back to raw_context)", () => {
    expect(tryParseAlert("payment service is throwing 500s since 14:00")).toBeNull();
  });

  it("returns null for invalid JSON that starts like JSON", () => {
    expect(tryParseAlert("{not valid json,,,")).toBeNull();
  });

  it("returns null for valid JSON that matches no known provider", () => {
    expect(tryParseAlert(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});

describe("tryParseAlert — Datadog", () => {
  it("extracts title, service from tags, and structured raw_context", () => {
    const payload = JSON.stringify({
      alert_id: "12345",
      alert_title: "[P1] High latency on payment-svc",
      alert_metric: "trace.http.request.duration",
      alert_status: "Triggered",
      alert_priority: "P1",
      tags: ["service:payment-svc", "env:prod", "team:payments"],
      body: "p99 latency exceeded 2s",
    });
    const parsed = tryParseAlert(payload);
    expect(parsed?.source).toBe("datadog");
    expect(parsed?.service).toBe("payment-svc");
    expect(parsed?.title).toBe("[P1] High latency on payment-svc");
    expect(parsed?.raw_context).toMatch(/Datadog priority: P1/);
    expect(parsed?.raw_context).toMatch(/Env: prod/);
  });

  it("handles tags as a comma-separated string", () => {
    const parsed = tryParseAlert(
      JSON.stringify({ alert_metric: "cpu", tags: "service:api-gw,env:prod" }),
    );
    expect(parsed?.source).toBe("datadog");
    expect(parsed?.service).toBe("api-gw");
  });
});

describe("tryParseAlert — PagerDuty", () => {
  it("unwraps webhook v3 messages[] and reads the incident", () => {
    const payload = JSON.stringify({
      messages: [
        {
          event: "incident.triggered",
          incident: {
            title: "Checkout errors spiking",
            urgency: "high",
            status: "triggered",
            service: { summary: "checkout-svc" },
            html_url: "https://acme.pagerduty.com/incidents/Q1",
          },
        },
      ],
    });
    const parsed = tryParseAlert(payload);
    expect(parsed?.source).toBe("pagerduty");
    expect(parsed?.service).toBe("checkout-svc");
    expect(parsed?.title).toBe("Checkout errors spiking");
    expect(parsed?.raw_context).toMatch(/Urgency: high/);
  });

  it("handles a bare incident payload", () => {
    const parsed = tryParseAlert(
      JSON.stringify({ incident: { summary: "DB down", service: { name: "db-primary" } } }),
    );
    expect(parsed?.source).toBe("pagerduty");
    expect(parsed?.service).toBe("db-primary");
  });
});

describe("tryParseAlert — Sentry", () => {
  it("reads issue title, project as service, and error metadata", () => {
    const payload = JSON.stringify({
      action: "triggered",
      data: {
        issue: {
          title: "TypeError: cannot read property 'id' of undefined",
          culprit: "checkout.processPayment",
          level: "error",
          environment: "production",
          project: { slug: "web-frontend", name: "Web Frontend" },
          metadata: { type: "TypeError", value: "cannot read property 'id'" },
          count: 412,
          permalink: "https://sentry.io/issues/1",
        },
      },
    });
    const parsed = tryParseAlert(payload);
    expect(parsed?.source).toBe("sentry");
    expect(parsed?.service).toBe("web-frontend");
    expect(parsed?.title).toMatch(/TypeError/);
    expect(parsed?.raw_context).toMatch(/Occurrences: 412/);
    expect(parsed?.raw_context).toMatch(/Level: error/);
  });
});
