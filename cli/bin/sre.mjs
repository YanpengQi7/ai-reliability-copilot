#!/usr/bin/env node
// sre — pipe incident text to AI Reliability Copilot, read the analysis in your terminal.
//
// Usage:
//   pbpaste | sre analyze              # macOS — paste from clipboard
//   sre analyze < alert.json           # pipe a file
//   echo "redis OOM" | sre analyze     # quick free-form note
//   sre analyze --open                 # also open the web view in browser
//   sre analyze --json                 # print the raw analysis JSON instead of formatted text
//   sre analyze --no-wait              # POST and exit — print URL only, don't poll
//
// Env:
//   SRE_COPILOT_URL     base URL (default: https://ai-reliability-copilot.vercel.app)
//   SRE_COPILOT_SECRET  webhook secret if the server has WEBHOOK_SECRET set

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_URL = "https://ai-reliability-copilot.vercel.app";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  printHelp();
  process.exit(cmd ? 0 : 1);
}

if (cmd !== "analyze") {
  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

const flags = new Set(args.slice(1));
const openBrowser = flags.has("--open");
const jsonOut = flags.has("--json");
const noWait = flags.has("--no-wait");

const base = (process.env.SRE_COPILOT_URL ?? DEFAULT_URL).replace(/\/$/, "");
const secret = process.env.SRE_COPILOT_SECRET;

const body = readStdin();
if (!body || body.trim().length < 5) {
  console.error("error: no input on stdin. Pipe alert JSON or notes into `sre analyze`.");
  console.error("       example: pbpaste | sre analyze");
  process.exit(1);
}

const webhookUrl = new URL("/api/webhook/alert", base);

const submit = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "content-type": "text/plain",
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  },
  body,
}).catch((e) => {
  console.error(`error: cannot reach ${base}: ${e?.message ?? e}`);
  process.exit(2);
});

if (!submit.ok) {
  const text = await submit.text().catch(() => "");
  console.error(`error: webhook returned ${submit.status}: ${text.slice(0, 500)}`);
  process.exit(2);
}

const submitted = await submit.json();
const incidentId = submitted.incident_id;
const incidentUrl = submitted.url ?? `${base}/incidents/${incidentId}`;

console.error(`✓ submitted [${submitted.source}] → ${incidentUrl}`);

if (openBrowser) openUrl(incidentUrl);

if (noWait) {
  console.log(incidentUrl);
  process.exit(0);
}

// Poll for analysis
const startedAt = Date.now();
let analysis = null;
process.stderr.write("  analyzing");
while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
  await sleep(POLL_INTERVAL_MS);
  process.stderr.write(".");
  const r = await fetch(new URL(`/api/incidents/${incidentId}`, base), {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }).catch(() => null);
  if (!r || !r.ok) continue;
  const j = await r.json().catch(() => null);
  if (j?.analysis?.summary) {
    analysis = j.analysis;
    break;
  }
}
process.stderr.write("\n");

if (!analysis) {
  console.error(`! timed out waiting for analysis. Check ${incidentUrl} in a moment.`);
  process.exit(3);
}

if (jsonOut) {
  console.log(JSON.stringify(analysis, null, 2));
  process.exit(0);
}

printAnalysis(analysis, incidentUrl);

// ─────────────────────────── helpers ───────────────────────────

function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function openUrl(u) {
  const cmd =
    process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  spawn(cmd, [u], { detached: true, stdio: "ignore" }).unref();
}

function printAnalysis(a, url) {
  const sev = a.severity ?? "?";
  const sevColor = sev === "SEV1" ? "\x1b[31m" : sev === "SEV2" ? "\x1b[33m" : "\x1b[36m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(`${sevColor}${bold}[${sev}]${reset} ${a.summary ?? ""}`);
  if (a.severity_reasoning) console.log(`${dim}${a.severity_reasoning}${reset}`);
  console.log();

  const rcs = asArray(a.root_causes);
  if (rcs.length) {
    console.log(`${bold}Root causes (ranked)${reset}`);
    rcs.forEach((rc, i) => {
      console.log(`  ${i + 1}. ${rc.hypothesis ?? rc.title ?? "?"}  ${dim}(likelihood: ${rc.likelihood ?? "?"})${reset}`);
      if (rc.evidence) console.log(`     ${dim}evidence:${reset} ${truncate(rc.evidence, 200)}`);
    });
    console.log();
  }

  const checklist = asArray(a.investigation_checklist);
  if (checklist.length) {
    console.log(`${bold}Investigation checklist${reset}`);
    checklist.slice(0, 6).forEach((step, i) => {
      const cmd = step.command ?? step.cmd ?? "";
      const why = step.why ?? step.purpose ?? "";
      console.log(`  ${i + 1}. ${why || step.title || "step"}`);
      if (cmd) console.log(`     ${dim}$ ${cmd}${reset}`);
    });
    if (checklist.length > 6) console.log(`  ${dim}… +${checklist.length - 6} more${reset}`);
    console.log();
  }

  const plan = asArray(a.mitigation_plan);
  if (plan.length) {
    console.log(`${bold}Mitigation plan${reset}`);
    plan.slice(0, 5).forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.action ?? step.title ?? "?"}  ${dim}[risk: ${step.risk ?? "?"}]${reset}`);
      if (step.rollback) console.log(`     ${dim}rollback:${reset} ${truncate(step.rollback, 160)}`);
    });
    console.log();
  }

  console.log(`${dim}full analysis → ${url}${reset}`);
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }
  return [];
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printHelp() {
  console.log(`sre — pipe incident text to AI Reliability Copilot

Usage:
  pbpaste | sre analyze              paste from clipboard (macOS)
  sre analyze < alert.json           pipe a file
  echo "redis OOM" | sre analyze     free-form note

Flags:
  --open       open the web view in your browser after submit
  --json       print the raw analysis JSON instead of formatted text
  --no-wait    POST and exit — print URL only, skip polling

Env:
  SRE_COPILOT_URL      base URL  (default: ${DEFAULT_URL})
  SRE_COPILOT_SECRET   webhook secret if the server enforces one
`);
}
