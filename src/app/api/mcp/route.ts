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
import { machineEndpointNeedsSecret } from "@/lib/requestSafety";
import { createRequestContext } from "@/lib/observability";

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

function checkAuth(req: Request): boolean {
  const required = process.env.MCP_AUTH_TOKEN;
  if (!required) return true; // public mode
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && match[1] === required);
}

async function handle(req: Request): Promise<Response> {
  const ctx = createRequestContext(req, "mcp");
  if (machineEndpointNeedsSecret(process.env.MCP_AUTH_TOKEN)) {
    return ctx.response(authNotConfigured(), { method: req.method });
  }
  if (!checkAuth(req)) return ctx.response(unauthorized(), { method: req.method });
  const ip = clientKey(req);
  const rl = await rateLimit(ip, { max: RATE_LIMIT_PER_MIN, namespace: "mcp" });
  if (!rl.allowed) return ctx.response(withRateLimitHeaders(rateLimited(rl.retryAfterSec), rl), { method: req.method });

  return withClientIp(ip, async () => {
    const server = buildMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — Vercel-friendly
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(req);
      return ctx.response(response, { method: req.method });
    } catch (error) {
      ctx.log("error", "mcp_request_failed", {
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
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
