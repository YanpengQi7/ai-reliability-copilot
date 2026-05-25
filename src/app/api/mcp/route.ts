// MCP Streamable HTTP endpoint.
// Users add this to their Claude Code with:
//   claude mcp add ai-reliability-copilot --transport http https://<your-deployment>/api/mcp
// and the tools we expose become callable from their local Claude session,
// driven by whichever model they have configured. Zero LLM cost to us.

import { buildMcpServer } from "@/lib/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stateless mode: spin up a fresh server+transport per request.
// Trade-off: no SSE-resumable sessions, but works seamlessly behind
// Vercel's serverless model (no shared state needed). For our tools
// (KB lookup, similar incidents, save) every call is independent —
// no streaming-required workflows.
async function handle(req: Request): Promise<Response> {
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  // Clean up — server.connect retains a reference, drop it now that the
  // single request/response is done.
  transport.close();
  return res;
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
