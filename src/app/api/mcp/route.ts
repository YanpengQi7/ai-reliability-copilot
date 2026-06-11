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
// Rate limit: 50 req/min per IP, in-memory (cold-start reset acceptable here
// because abuse mitigation is the goal, not pixel-perfect billing).

import { buildMcpServer } from "@/lib/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { withClientIp } from "@/lib/mcp/telemetry";
import { machineEndpointNeedsSecret } from "@/lib/requestSafety";

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
  if (machineEndpointNeedsSecret(process.env.MCP_AUTH_TOKEN)) return authNotConfigured();
  if (!checkAuth(req)) return unauthorized();
  const ip = clientKey(req);
  const rl = rateLimit(ip, { max: RATE_LIMIT_PER_MIN, namespace: "mcp" });
  if (!rl.allowed) return rateLimited(rl.retryAfterSec);

  return withClientIp(ip, async () => {
    const server = buildMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — Vercel-friendly
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    transport.close();
    return res;
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
