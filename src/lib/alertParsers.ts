// Convert third-party alert payloads (Datadog / PagerDuty / Sentry) into the
// canonical shape our analyzer accepts: { title, service, symptoms, raw_context }.
//
// Goal: on-call sees a Datadog event JSON in chat, copy-pastes it, hits analyze,
// gets a full structured response without retyping anything.
//
// Auto-detection: each parser has a `detect(json)` predicate. Caller iterates
// known parsers and uses the first match. Falls back to "treat whole text as
// raw_context" if nothing recognizes it.

export type ParsedAlert = {
  source: "datadog" | "pagerduty" | "sentry" | "raw";
  title?: string;
  service?: string;
  symptoms?: string;
  raw_context: string;
};

type Parser = {
  source: ParsedAlert["source"];
  detect: (j: unknown) => boolean;
  parse: (j: unknown) => ParsedAlert;
};

// ─────────────────────────── Datadog ───────────────────────────
// Datadog webhook event shape (real fields, simplified):
//   { event_type, alert_id, alert_metric, alert_query, alert_status, alert_title,
//     body, date, host, tags, snapshot, link }
// They also send `alert_transition` (Triggered/Recovered) and `alert_priority` (P1..P5).
const datadog: Parser = {
  source: "datadog",
  detect(j) {
    const o = j as Record<string, unknown>;
    return Boolean(o && (o.alert_id || o.alert_title || o.alert_metric));
  },
  parse(j) {
    const o = j as Record<string, unknown>;
    const tags = Array.isArray(o.tags) ? (o.tags as string[]) : typeof o.tags === "string" ? (o.tags as string).split(",") : [];
    const serviceTag = tags.find((t) => /^service:/i.test(t))?.split(":")[1];
    const envTag = tags.find((t) => /^env:/i.test(t))?.split(":")[1];

    const lines: string[] = [];
    if (o.alert_status) lines.push(`Status: ${o.alert_status}${o.alert_transition ? ` (${o.alert_transition})` : ""}`);
    if (o.alert_priority) lines.push(`Datadog priority: ${o.alert_priority}`);
    if (o.alert_query) lines.push(`Query: ${o.alert_query}`);
    if (o.alert_metric) lines.push(`Metric: ${o.alert_metric}`);
    if (o.host) lines.push(`Host: ${o.host}`);
    if (envTag) lines.push(`Env: ${envTag}`);
    if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
    if (o.date) lines.push(`When: ${new Date(Number(o.date) * 1000 || String(o.date)).toISOString?.() ?? String(o.date)}`);
    if (o.link) lines.push(`Link: ${o.link}`);
    if (o.body) lines.push(`\n${String(o.body).trim()}`);
    if (o.snapshot) lines.push(`Snapshot: ${o.snapshot}`);

    return {
      source: "datadog",
      title: typeof o.alert_title === "string" ? o.alert_title : undefined,
      service: serviceTag,
      symptoms: typeof o.alert_title === "string" ? o.alert_title : (typeof o.alert_metric === "string" ? `Metric ${o.alert_metric} alerting` : undefined),
      raw_context: lines.filter(Boolean).join("\n"),
    };
  },
};

// ─────────────────────────── PagerDuty ───────────────────────────
// PagerDuty Events API v2 / webhook payload shape:
//   { event: { event_type, occurred_at, agent, data: { incident: { id, title,
//     summary, urgency, service: { summary }, status, html_url, ...} } } }
// Or webhook v3: { messages: [{ event, ... }] } — we handle both.
const pagerduty: Parser = {
  source: "pagerduty",
  detect(j) {
    const o = j as Record<string, unknown>;
    if (!o) return false;
    if (Array.isArray((o as { messages?: unknown[] }).messages)) return true;
    const ev = (o as { event?: Record<string, unknown> }).event;
    if (ev && typeof ev.event_type === "string") return true;
    // Bare incident payload (some integrations)
    const inc = (o as { incident?: Record<string, unknown> }).incident;
    if (inc && (inc.title || inc.summary)) return true;
    return false;
  },
  parse(j) {
    const o = j as Record<string, unknown>;
    // Unwrap webhook v3 → first event
    const msg = Array.isArray((o as { messages?: unknown[] }).messages)
      ? (o as { messages: Array<Record<string, unknown>> }).messages[0]
      : undefined;
    const event = (msg ?? (o.event as Record<string, unknown> | undefined) ?? o) as Record<string, unknown>;
    const data = (event.data as Record<string, unknown> | undefined) ?? event;
    const incident = (data.incident as Record<string, unknown> | undefined) ?? (o.incident as Record<string, unknown> | undefined) ?? data;

    const title = (incident.title || incident.summary) as string | undefined;
    const serviceObj = incident.service as Record<string, unknown> | undefined;
    const service = (serviceObj?.summary || serviceObj?.name) as string | undefined;
    const urgency = incident.urgency as string | undefined;
    const status = incident.status as string | undefined;
    const url = (incident.html_url || incident.self) as string | undefined;
    const created = (incident.created_at || event.occurred_at) as string | undefined;

    const lines: string[] = [];
    if (status) lines.push(`Status: ${status}`);
    if (urgency) lines.push(`Urgency: ${urgency}`);
    if (created) lines.push(`Created: ${created}`);
    if (service) lines.push(`Service: ${service}`);
    if (url) lines.push(`Link: ${url}`);
    const desc = (incident.description || incident.first_trigger_log_entry) as string | undefined;
    if (desc) lines.push(`\n${typeof desc === "string" ? desc : JSON.stringify(desc).slice(0, 1000)}`);

    return {
      source: "pagerduty",
      title,
      service,
      symptoms: title,
      raw_context: lines.filter(Boolean).join("\n"),
    };
  },
};

// ─────────────────────────── Sentry ───────────────────────────
// Sentry webhook payload shape (Issue alert):
//   { action, data: { issue: { id, title, culprit, level, project: { slug, name },
//     metadata: { type, value, filename }, count, userCount, firstSeen,
//     lastSeen, permalink, environment, ...} }, installation, actor }
const sentry: Parser = {
  source: "sentry",
  detect(j) {
    const o = j as Record<string, unknown>;
    if (!o) return false;
    const data = o.data as Record<string, unknown> | undefined;
    if (data && (data.issue || data.event)) return true;
    if (o.issue && typeof (o.issue as Record<string, unknown>).title === "string") return true;
    return false;
  },
  parse(j) {
    const o = j as Record<string, unknown>;
    const data = (o.data as Record<string, unknown> | undefined) ?? o;
    const issue = (data.issue as Record<string, unknown> | undefined) ?? (o.issue as Record<string, unknown> | undefined) ?? {};
    const event = (data.event as Record<string, unknown> | undefined) ?? undefined;

    const title = (issue.title as string | undefined) ?? (event?.title as string | undefined);
    const project = issue.project as Record<string, unknown> | undefined;
    const projectName = (project?.slug || project?.name) as string | undefined;
    const meta = (issue.metadata as Record<string, unknown> | undefined) ?? {};
    const lvl = issue.level as string | undefined;
    const env = (issue.environment || event?.environment) as string | undefined;

    const lines: string[] = [];
    if (lvl) lines.push(`Level: ${lvl}`);
    if (env) lines.push(`Env: ${env}`);
    if (projectName) lines.push(`Sentry project: ${projectName}`);
    if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
    if (issue.count) lines.push(`Occurrences: ${issue.count}${issue.userCount ? ` (${issue.userCount} users)` : ""}`);
    if (issue.firstSeen) lines.push(`First seen: ${issue.firstSeen}`);
    if (issue.lastSeen) lines.push(`Last seen: ${issue.lastSeen}`);
    if (meta.type || meta.value) lines.push(`Error: ${meta.type ?? ""}${meta.type && meta.value ? " — " : ""}${meta.value ?? ""}`);
    if (meta.filename) lines.push(`Filename: ${meta.filename}`);
    if (issue.permalink) lines.push(`Link: ${issue.permalink}`);

    return {
      source: "sentry",
      title,
      service: projectName,
      symptoms: title,
      raw_context: lines.filter(Boolean).join("\n"),
    };
  },
};

const PARSERS: Parser[] = [datadog, pagerduty, sentry];

/**
 * Try to parse `text` as an alert payload from a known provider.
 * If `text` is not JSON, or no parser claims it, returns null (caller falls back
 * to treating the text as raw_context directly).
 */
export function tryParseAlert(text: string): ParsedAlert | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  for (const p of PARSERS) {
    try {
      if (p.detect(json)) return p.parse(json);
    } catch {
      // parser bug shouldn't break the world — try the next one
    }
  }
  return null;
}
