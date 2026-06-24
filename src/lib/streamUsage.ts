// Transport token usage out of the STREAMING /api/analyze path.
//
// The problem: `streamObject(...).toTextStreamResponse()` only emits the object
// JSON deltas, and `experimental_useObject` on the client only surfaces the
// parsed object — never `usage`. But usage is only known at `onFinish` (stream
// end), so it can't ride in a response header (those are flushed first).
//
// The fix: the server appends a one-line USAGE TRAILER after the object JSON,
// delimited by an ASCII Record Separator (0x1e) — a control byte that never
// appears in JSON. A client fetch middleware strips the trailer back off before
// `useObject` ever sees it, so the JSON stream it parses is unchanged, and the
// usage is captured into a ref the save call forwards to the DB.
//
// This keeps the two-endpoint split intact (analyze still writes no DB) and
// needs no schema migration (analyses.tokens_in/out/cost_usd already exist).

export type StreamUsage = {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
};

// ASCII Record Separator. Never legal inside JSON text, so it unambiguously
// marks where the object JSON ends and the usage trailer begins.
export const STREAM_USAGE_SENTINEL = "\x1e";
const SENTINEL_BYTE = 0x1e;
const MAX_USAGE_TRAILER_BYTES = 4096;

/** Server: the trailing bytes to append after the streamed object JSON. */
export function usageTrailer(usage: StreamUsage): string {
  return STREAM_USAGE_SENTINEL + JSON.stringify(usage);
}

/**
 * Pure split of a fully-buffered analyze response into the JSON body and the
 * usage trailer. Exported for unit testing; the streaming client path below
 * does the same split incrementally over a byte stream.
 */
export function splitUsageTrailer(text: string): { body: string; usage: StreamUsage | null } {
  const i = text.indexOf(STREAM_USAGE_SENTINEL);
  if (i === -1) return { body: text, usage: null };
  const body = text.slice(0, i);
  const tail = text.slice(i + 1);
  try {
    return { body, usage: JSON.parse(tail) as StreamUsage };
  } catch {
    return { body, usage: null };
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Client: wraps `fetch` so the analyze response stream has its usage trailer
 * peeled off (and reported via `onUsage`) before the body is handed to
 * `useObject`. Everything up to the sentinel byte is forwarded verbatim; the
 * sentinel and everything after it is buffered and parsed as usage JSON.
 */
export function makeUsageCapturingFetch(onUsage: (u: StreamUsage | null) => void): FetchLike {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (!res.body) {
      onUsage(null);
      return res;
    }
    let sentinelSeen = false;
    let tailBytes = 0;
    let tailTooLarge = false;
    const tailChunks: Uint8Array[] = [];

    function appendTail(chunk: Uint8Array) {
      if (tailTooLarge) return;
      tailBytes += chunk.byteLength;
      if (tailBytes > MAX_USAGE_TRAILER_BYTES) {
        tailTooLarge = true;
        tailChunks.length = 0;
        return;
      }
      tailChunks.push(chunk);
    }

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (sentinelSeen) {
          appendTail(chunk);
          return;
        }
        const idx = chunk.indexOf(SENTINEL_BYTE);
        if (idx === -1) {
          controller.enqueue(chunk);
          return;
        }
        // Split this chunk at the sentinel: forward the JSON head, buffer the tail.
        if (idx > 0) controller.enqueue(chunk.subarray(0, idx));
        sentinelSeen = true;
        const after = chunk.subarray(idx + 1);
        if (after.length) appendTail(after);
      },
      flush() {
        if (!sentinelSeen || tailTooLarge) {
          onUsage(null);
          return;
        }
        try {
          const json = new TextDecoder().decode(concatChunks(tailChunks));
          onUsage(JSON.parse(json) as StreamUsage);
        } catch {
          onUsage(null);
        }
      },
    });

    const piped = res.body.pipeThrough(transform);
    return new Response(piped, {
      headers: res.headers,
      status: res.status,
      statusText: res.statusText,
    });
  };
}
