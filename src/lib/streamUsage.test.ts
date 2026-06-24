import { describe, it, expect } from "vitest";
import {
  usageTrailer,
  splitUsageTrailer,
  makeUsageCapturingFetch,
  STREAM_USAGE_SENTINEL,
  type StreamUsage,
} from "./streamUsage";

const USAGE: StreamUsage = { tokens_in: 1234, tokens_out: 567, cost_usd: 0.00091 };

describe("usageTrailer / splitUsageTrailer round-trip", () => {
  it("appends a trailer that splits back to the original body + usage", () => {
    const body = '{"summary":"db pool exhausted","severity":"SEV2"}';
    const wire = body + usageTrailer(USAGE);
    const out = splitUsageTrailer(wire);
    expect(out.body).toBe(body);
    expect(out.usage).toEqual(USAGE);
  });

  it("returns usage:null when there is no trailer (older server / plain JSON)", () => {
    const out = splitUsageTrailer('{"summary":"x"}');
    expect(out.usage).toBeNull();
    expect(out.body).toBe('{"summary":"x"}');
  });

  it("tolerates a corrupt trailer without losing the body", () => {
    const out = splitUsageTrailer('{"a":1}' + STREAM_USAGE_SENTINEL + "{not json");
    expect(out.body).toBe('{"a":1}');
    expect(out.usage).toBeNull();
  });

  it("preserves a null cost_usd (unknown model)", () => {
    const u: StreamUsage = { tokens_in: 10, tokens_out: 20, cost_usd: null };
    expect(splitUsageTrailer("{}" + usageTrailer(u)).usage).toEqual(u);
  });
});

// Drive the client middleware over a real (in-memory) streamed Response to prove
// the byte-level transform forwards the JSON head and captures the usage tail —
// including when the sentinel lands mid-chunk and across chunk boundaries.
async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

function streamingResponse(chunks: (string | Uint8Array)[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

describe("makeUsageCapturingFetch", () => {
  it("strips the trailer from the body and reports usage", async () => {
    const body = '{"summary":"x","severity":"SEV3"}';
    const wire = body + usageTrailer(USAGE);
    let captured: StreamUsage | null = null;
    const wrapped = makeUsageCapturingFetch((u) => {
      captured = u;
    });
    // Inject our in-memory response by stubbing global fetch.
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => streamingResponse([wire])) as typeof fetch;
    try {
      const res = await wrapped("/api/analyze", { method: "POST" });
      expect(await readAll(res)).toBe(body);
      expect(captured).toEqual(USAGE);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("handles the sentinel split across chunk boundaries", async () => {
    const body = '{"summary":"chunked"}';
    const trailer = usageTrailer(USAGE);
    // Split the wire so the JSON, the sentinel, and the usage land in 3 chunks
    // that don't align with the sentinel byte.
    const chunks = [body.slice(0, 5), body.slice(5) + trailer.slice(0, 1), trailer.slice(1)];
    let captured: StreamUsage | null = null;
    const wrapped = makeUsageCapturingFetch((u) => {
      captured = u;
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => streamingResponse(chunks)) as typeof fetch;
    try {
      const res = await wrapped("/api/analyze", { method: "POST" });
      expect(await readAll(res)).toBe(body);
      expect(captured).toEqual(USAGE);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("reports null usage when the stream carries no trailer", async () => {
    let captured: StreamUsage | null = { tokens_in: 1, tokens_out: 1, cost_usd: 1 };
    const wrapped = makeUsageCapturingFetch((u) => {
      captured = u;
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => streamingResponse(['{"summary":"no trailer"}'])) as typeof fetch;
    try {
      const res = await wrapped("/api/analyze", { method: "POST" });
      expect(await readAll(res)).toBe('{"summary":"no trailer"}');
      expect(captured).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("bounds oversized usage trailers without dropping the JSON body", async () => {
    const body = '{"summary":"oversized trailer"}';
    let captured: StreamUsage | null = { tokens_in: 1, tokens_out: 1, cost_usd: 1 };
    const wrapped = makeUsageCapturingFetch((u) => {
      captured = u;
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => streamingResponse([
      body + STREAM_USAGE_SENTINEL,
      "x".repeat(5000),
    ])) as typeof fetch;
    try {
      const res = await wrapped("/api/analyze", { method: "POST" });
      expect(await readAll(res)).toBe(body);
      expect(captured).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
