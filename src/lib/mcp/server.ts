// MCP server: exposes our SRE knowledge primitives as tools so users can
// drive analysis from their own Claude Code (or any MCP client) instead
// of paying for our DeepSeek/OpenAI calls.
//
// The LLM intelligence lives on the CLIENT side. We provide:
//   - data tools: search the KB, find similar incidents, list scenarios
//   - persistence: save user-generated analyses
//   - utility:    parse Datadog/PagerDuty/Sentry JSON payloads
//   - resources:  our severity rubric + the structured-output schema
//
// Architectural note: we deliberately do NOT expose an "analyze_incident"
// tool that runs the LLM. That would defeat the purpose — users want to
// use their own Claude. Instead they call us for context, generate the
// analysis themselves, and optionally call save_incident to persist.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorDetail } from "@/lib/observability";
import { SCENARIOS } from "@/lib/scenarios";
import { retrieveContext } from "@/lib/kb";
import { findSimilarIncidents } from "@/lib/similar";
import { tryParseAlert } from "@/lib/alertParsers";
import { AnalysisSchema } from "@/lib/schema";
import { supabaseAdmin } from "@/lib/supabase";
import { hasSupabase } from "@/lib/db";
import { embed, buildSignature } from "@/lib/embeddings";
import { withTelemetry } from "./telemetry";

const SEVERITY_RUBRIC = `# Severity rubric (from src/lib/prompts.ts SYSTEM_PROMPT_V2)

- **SEV1**: ANY of: user-facing outage, error rate > 1% for >5 min,
  revenue path broken, data loss/corruption risk, regional unavailability
- **SEV2**: error rate 0.1–1%, degraded performance affecting < 50% of users,
  non-critical system fully down
- **SEV3**: internal-only impact, single-host issue, warning signs without user impact

Justify severity in \`severity_reasoning\` by citing which rule applies.`;

const STRUCTURED_OUTPUT_GUIDE = `# Structured 9-section incident response

Produce these fields (use the analysis JSON schema we provide):

1. \`summary\` (string) — 2-3 sentence incident summary for an incident commander
2. \`severity\` (SEV1|SEV2|SEV3) — apply the severity rubric strictly
3. \`severity_reasoning\` (string) — cite the rubric rule applied
4. \`root_causes\` (array of 3-5) — { hypothesis, evidence, likelihood: high|medium|low }
   - Distinct likelihood across hypotheses
   - "high" requires direct evidence in the context
5. \`investigation_checklist\` (array of 3-8) — { step, command, expected }
   - command must be copy-pasteable (full tool + flags + filters)
6. \`mitigation_plan\` (array of 2-6) — { action, risk, rollback }
   - rollback MUST be non-empty (if you can't describe one, the action is unsafe)
7. \`customer_impact\` (string) — externally-facing language
8. \`postmortem_draft\` (string, markdown) — H2 sections in order:
   Summary / Timeline (UTC) / Impact / Root Cause / Detection / Response /
   What Went Well / What Went Poorly / Action Items.
   Use [FILL IN] placeholders for data you don't have. Do not fabricate timestamps.
9. \`follow_ups\` (array of 3-8) — { item, owner_role (team/role, not person), priority: P0|P1|P2 }

Code/commands/JSON keys/enum values stay in English regardless of output language.`;

export function buildMcpServer() {
  const server = new McpServer({
    name: "ai-reliability-copilot",
    version: "1.0.0",
  });

  // ── Tools ──────────────────────────────────────────────────────────

  server.registerTool(
    "search_kb",
    {
      title: "Search internal knowledge base",
      description: "Retrieve relevant excerpts from internal runbooks, postmortems, service catalog, and architecture docs. Uses pgvector + OpenAI embeddings when available, falls back to pg_trgm. Returns top-k chunks ranked by similarity.",
      inputSchema: {
        query: z.string().describe("Free-text query — e.g. 'payment-svc DB connection pool exhausted', 'cache stampede mitigation', service name + symptom"),
        limit: z.number().int().min(1).max(20).optional().default(5),
      },
    },
    withTelemetry(
      "search_kb",
      (a) => `q=${a.query}`,
      async ({ query, limit }) => {
        const r = await retrieveContext(query, { limit });
        const body = r.chunks.length === 0
          ? `No KB chunks matched (mode=${r.mode}). The KB may be empty or your threshold is too tight.`
          : r.chunks.map((c, i) => `[${i + 1}] ${c.document_title ?? c.source_path} (${c.document_kind}) · similarity ${(c.similarity * 100).toFixed(0)}%\n${c.text}`).join("\n\n---\n\n");
        return { content: [{ type: "text", text: `# KB search (mode=${r.mode}) — ${r.chunks.length} hits\n\n${body}` }] };
      },
    ),
  );

  server.registerTool(
    "find_similar_incidents",
    {
      title: "Find similar past incidents",
      description: "Search the incident history for past events with similar service, symptoms, or root cause. Returns up to 5 ranked by similarity. Use the title+symptoms+summary of a new incident as the query.",
      inputSchema: {
        text: z.string().describe("Text describing the new incident — title + symptoms + key facts"),
        limit: z.number().int().min(1).max(20).optional().default(5),
      },
    },
    withTelemetry(
      "find_similar_incidents",
      (a) => `text=${String(a.text ?? "").slice(0, 200)}`,
      async ({ text, limit }) => {
        const r = await findSimilarIncidents(text, { limit });
        const body = r.hits.length === 0
          ? `No similar incidents found (mode=${r.mode}).`
          : r.hits.map((h, i) => `[${i + 1}] ${h.title ?? h.service ?? h.id} · similarity ${(h.similarity * 100).toFixed(0)}%\n  service: ${h.service ?? "n/a"} · symptoms: ${h.symptoms ?? "n/a"}\n  incident_id: ${h.id}`).join("\n\n");
        return { content: [{ type: "text", text: `# Similar incidents (mode=${r.mode})\n\n${body}` }] };
      },
    ),
  );

  server.registerTool(
    "list_scenarios",
    {
      title: "List curated SRE scenarios",
      description: "Returns the 5-scenario regression library (DB pool exhaustion, OOM deploy, dependency timeout, DNS, cache stampede). Use to test analysis output or as practice incidents.",
      inputSchema: {},
    },
    withTelemetry(
      "list_scenarios",
      () => "",
      async () => {
        const body = SCENARIOS.map((s) => `- **${s.slug}** (${s.category}, expected ${s.expected_severity}) — ${s.title}\n  service: ${s.service}\n  symptoms: ${s.symptoms}`).join("\n\n");
        return { content: [{ type: "text", text: `# Scenario library\n\n${body}\n\nUse get_scenario(slug) for full context.` }] };
      },
    ),
  );

  server.registerTool(
    "get_scenario",
    {
      title: "Get full scenario context",
      description: "Returns the complete raw_context for a scenario by slug, including realistic metrics, logs, deploy history, and on-call notes. Use as input to your analysis.",
      inputSchema: { slug: z.string() },
    },
    withTelemetry(
      "get_scenario",
      (a) => `slug=${a.slug}`,
      async ({ slug }) => {
        const s = SCENARIOS.find((x) => x.slug === slug);
        if (!s) return { content: [{ type: "text", text: `No scenario with slug "${slug}". Call list_scenarios first.` }], isError: true };
        return {
          content: [{ type: "text", text: `# ${s.title}\n\nservice: ${s.service}\nsymptoms: ${s.symptoms}\ncategory: ${s.category}\nexpected severity: ${s.expected_severity}\nexpected root cause: ${s.expected_root_cause}\n\n## Raw context\n\n${s.context}` }],
        };
      },
    ),
  );

  server.registerTool(
    "parse_alert_json",
    {
      title: "Parse Datadog/PagerDuty/Sentry alert JSON",
      description: "Detect alert provider and extract structured fields (service, title, symptoms, raw_context) from a webhook JSON payload. Returns null-ish text if not recognized.",
      inputSchema: { json: z.string().describe("Raw JSON string from a Datadog/PagerDuty/Sentry webhook") },
    },
    withTelemetry(
      "parse_alert_json",
      (a) => `len=${String(a.json ?? "").length}`,
      async ({ json }) => {
        const parsed = tryParseAlert(json);
        if (!parsed) return { content: [{ type: "text", text: "Not a recognized alert payload (Datadog/PagerDuty/Sentry). Treat as raw text." }] };
        return {
          content: [{ type: "text", text: `# Parsed from ${parsed.source}\n\ntitle: ${parsed.title ?? "(none)"}\nservice: ${parsed.service ?? "(none)"}\nsymptoms: ${parsed.symptoms ?? "(none)"}\n\n## raw_context\n${parsed.raw_context}` }],
        };
      },
    ),
  );

  server.registerTool(
    "save_incident_analysis",
    {
      title: "Save an incident + analysis you generated",
      description: "Persist a completed incident analysis to the database. The analysis must conform to the structured 9-section schema (call get_output_schema for the spec). Returns the incident_id you can later fetch by URL or via find_similar_incidents.",
      inputSchema: {
        title: z.string().optional(),
        service: z.string().optional(),
        symptoms: z.string().optional(),
        raw_context: z.string().min(20),
        analysis: AnalysisSchema,
        output_language: z.enum(["en", "zh"]).optional().default("en"),
        client_model: z.string().optional().describe("Name of the LLM that generated this analysis (e.g. claude-opus-4-5), recorded for audit"),
      },
    },
    withTelemetry(
      "save_incident_analysis",
      (a) => `service=${a.service ?? "?"} title=${a.title ?? "?"} model=${a.client_model ?? "?"}`,
      async (input) => {
      if (!hasSupabase()) return { content: [{ type: "text", text: "Database not configured (Supabase env missing)." }], isError: true };
      const sb = supabaseAdmin();
      const signature = buildSignature({
        title: input.title,
        service: input.service,
        symptoms: input.symptoms,
        summary: input.analysis.summary,
        severity: input.analysis.severity,
      });
      const embedding = await embed(signature);
      const { data: inc, error: e1 } = await sb.from("incidents").insert({
        title: input.title ?? null,
        service: input.service ?? null,
        symptoms: input.symptoms ?? null,
        raw_context: input.raw_context,
        signature,
        embedding: embedding ? (embedding as unknown as string) : null,
      }).select("id").single();
      if (e1) {
        console.error(JSON.stringify({ level: "error", event: "mcp_incident_insert_failed", error: safeErrorDetail(e1) }));
        return { content: [{ type: "text", text: "Database error while saving the incident." }], isError: true };
      }

      const a = input.analysis;
      const { data: ana, error: e2 } = await sb.from("analyses").insert({
        incident_id: inc.id,
        model: input.client_model ?? "external-mcp-client",
        prompt_version: "mcp",
        output_language: input.output_language ?? "en",
        summary: a.summary,
        severity: a.severity,
        severity_reasoning: a.severity_reasoning,
        root_causes: a.root_causes,
        investigation_checklist: a.investigation_checklist,
        mitigation_plan: a.mitigation_plan,
        customer_impact: a.customer_impact,
        postmortem_draft: a.postmortem_draft,
        follow_ups: a.follow_ups,
      }).select("id").single();
      if (e2) {
        const { error: cleanupError } = await sb.from("incidents").delete().eq("id", inc.id);
        console.error(JSON.stringify({
          level: "error",
          event: "mcp_analysis_insert_failed",
          error: safeErrorDetail(e2),
          cleanup_error: cleanupError ? safeErrorDetail(cleanupError) : undefined,
          incident_id: inc.id,
        }));
        return { content: [{ type: "text", text: "Database error while saving the analysis." }], isError: true };
      }

      const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://ai-reliability-copilot.vercel.app";
      return {
        content: [{ type: "text", text: `Saved.\n  incident_id: ${inc.id}\n  analysis_id: ${ana.id}\n  url: ${base}/incidents/${inc.id}` }],
      };
      },
    ),
  );

  server.registerTool(
    "get_output_schema",
    {
      title: "Get the 9-section structured output schema",
      description: "Returns a description of the expected analysis JSON schema with field semantics, validation rules, and the severity rubric. Use this before producing an analysis to ensure your output is shape-compatible with save_incident_analysis.",
      inputSchema: {},
    },
    withTelemetry(
      "get_output_schema",
      () => "",
      async () => {
        return { content: [{ type: "text", text: `${STRUCTURED_OUTPUT_GUIDE}\n\n${SEVERITY_RUBRIC}` }] };
      },
    ),
  );

  // ── Resources ──────────────────────────────────────────────────────

  server.registerResource(
    "severity-rubric",
    "copilot://docs/severity-rubric",
    { title: "Severity rubric", description: "The quantitative SEV1/2/3 rubric used by this project.", mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: "copilot://docs/severity-rubric", text: SEVERITY_RUBRIC, mimeType: "text/markdown" }] }),
  );

  server.registerResource(
    "output-schema",
    "copilot://docs/output-schema",
    { title: "9-section output schema guide", description: "What fields to produce when analyzing an incident.", mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: "copilot://docs/output-schema", text: STRUCTURED_OUTPUT_GUIDE, mimeType: "text/markdown" }] }),
  );

  return server;
}
