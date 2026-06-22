// MCP Streamable HTTP endpoint.
// Users add this to their Claude Code with:
//   claude mcp add ai-reliability-copilot --transport http https://<your-deployment>/api/mcp
// and the tools we expose become callable from their local Claude session,
// driven by whichever model they have configured. Zero LLM cost to us.
//
// Auth model (optional):
//   - If MCP_AUTH_TOKEN is set in env → require Authorization: Bearer <token> on every request
//   - If unset → public (development / open-source self-hosting default)
//
// Rate limit: 50 req/min per IP. Counters are shared through Upstash when its
// REST credentials are configured, with an in-memory availability fallback.

import { buildMcpServer } from "@/lib/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { rateLimit, clientKey, withRateLimitHeaders } from "@/lib/rateLimit";
import { withClientIp } from "@/lib/mcp/telemetry";
import { INPUT_LIMITS, machineEndpointNeedsSecret, readTextBody } from "@/lib/requestSafety";
import { createRequestContext, safeErrorDetail } from "@/lib/observability";
import { hasBearerToken } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT_PER_MIN = 50;

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized — set Authorization: Bearer <token>" } }),
    { status: 401, headers: { "content-type": "application/json", "WWW-Authenticate": 'Bearer realm="mcp"' } },
  );
}

function rateLimited(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: `Rate limited. Retry in ${retryAfterSec}s.` } }),
    { status: 429, headers: { "content-type": "application/json", "Retry-After": String(retryAfterSec) } },
  );
}

function authNotConfigured(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32002, message: "MCP_AUTH_TOKEN is required in production" } }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

function payloadTooLarge(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32003, message: "MCP request body is too large" } }),
    { status: 413, headers: { "content-type": "application/json" } },
  );
}

function checkAuth(req: Request): boolean {
  const required = process.env.MCP_AUTH_TOKEN;
  if (!required) return true; // public mode
  return hasBearerToken(req, required);
}

async function handle(req: Request): Promise<Response> {
  const ctx = createRequestContext(req, "mcp");
  if (machineEndpointNeedsSecret(process.env.MCP_AUTH_TOKEN)) {
    return ctx.response(authNotConfigured(), { method: req.method });
  }
  if (!checkAuth(req)) return ctx.response(unauthorized(), { method: req.method });
  const ip = clientKey(req);
  const rl = await rateLimit(ip, { max: RATE_LIMIT_PER_MIN, namespace: "mcp", abortSignal: req.signal });
  if (!rl.allowed) return ctx.response(withRateLimitHeaders(rateLimited(rl.retryAfterSec), rl), { method: req.method });

  let transportRequest = req;
  if (req.method !== "GET") {
    const body = await readTextBody(req, INPUT_LIMITS.mcpJson);
    if (!body.ok) return ctx.response(payloadTooLarge(), { method: req.method });
    transportRequest = new Request(req, { body: body.value });
  }

  return withClientIp(ip, async () => {
    const server = buildMcpServer({ requestUrl: req.url });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — Vercel-friendly
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(transportRequest);
      return ctx.response(response, { method: req.method });
    } catch (error) {
      ctx.log("error", "mcp_request_failed", {
        method: req.method,
        error: safeErrorDetail(error),
      });
      throw error;
    } finally {
      await transport.close();
    }
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
