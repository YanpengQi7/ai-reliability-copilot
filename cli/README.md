# sre — terminal client for AI Reliability Copilot

Pipe any incident text — Datadog/PagerDuty/Sentry alert JSON, or free-form on-call notes — and read the structured 9-section analysis in your terminal.

```bash
npm i -g sre-copilot-cli

# macOS — paste an alert from clipboard, get analysis in your terminal
pbpaste | sre analyze

# pipe a file
sre analyze < alert.json

# free-form
echo "checkout-svc p99 latency 8s, started 14:02 UTC, no recent deploy" | sre analyze
```

Output looks like:

```
✓ submitted [pagerduty] → https://ai-reliability-copilot.vercel.app/incidents/<uuid>
  analyzing........

[SEV2] checkout-svc p99 latency spiked from 200ms → 8s at 14:02 UTC, ~30% of …
quantitative: error rate >5% sustained 10min on a customer-facing path → SEV2

Root causes (ranked)
  1. Redis connection pool exhausted on checkout-cache  (likelihood: high)
     evidence: p99 jump correlates with redis_active_conns flatlined at pool max …
  2. Upstream payment-svc 5xx propagating  (likelihood: medium)
     evidence: …

Investigation checklist
  1. Confirm pool saturation
     $ kubectl exec checkout-cache-0 -- redis-cli info clients
  …

Mitigation plan
  1. Scale checkout-cache replicas 3 → 6  [risk: low]
     rollback: kubectl scale deploy checkout-cache --replicas=3
  …

full analysis → https://ai-reliability-copilot.vercel.app/incidents/<uuid>
```

## Why a CLI?

Because on-call shouldn't need to switch tabs. You're already in the terminal looking at logs — `pbpaste | sre analyze` is faster than opening a website and pasting into a textarea.

It also means **zero infrastructure approval at $WORK** — no Slack App install, no PagerDuty integration, no SecOps ticket. It's just an HTTPS call from your laptop.

## Flags

| flag | what it does |
|---|---|
| `--open` | also open the web view in your browser |
| `--json` | print raw analysis JSON (pipe into `jq`) |
| `--no-wait` | submit and exit — print URL only, don't poll |

## Env

| var | default | when to set |
|---|---|---|
| `SRE_COPILOT_URL` | `https://ai-reliability-copilot.vercel.app` | self-hosting your own copilot |
| `SRE_COPILOT_SECRET` | none | server has `WEBHOOK_SECRET` set |

## Exit codes

`0` ok · `1` bad input/usage · `2` network/server error · `3` polling timeout (URL printed; analysis may still finish — refresh later)

## What it does under the hood

1. POST your stdin to `${SRE_COPILOT_URL}/api/webhook/alert` — the server auto-detects Datadog/PagerDuty/Sentry JSON (falls back to raw text)
2. Server returns `202` with an incident URL immediately, kicks off LLM analysis in the background
3. CLI polls `GET /api/incidents/<id>` every 2s until the analysis row appears (~10–20s typical)
4. Formats and prints the analysis

No data leaves your laptop except what you piped in, going to the URL in `SRE_COPILOT_URL`. Self-host the server side if that matters for your workplace.
