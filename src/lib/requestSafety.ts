import { redactSecrets } from "./secretScan";

const SHORT_TEXT_LIMIT = 500;
const RAW_CONTEXT_LIMIT = 50_000;
const ANALYSIS_REQUEST_BYTES = (RAW_CONTEXT_LIMIT + 3 * SHORT_TEXT_LIMIT) * 6 + 16_384;

export const INPUT_LIMITS = {
  shortText: SHORT_TEXT_LIMIT,
  rawContext: RAW_CONTEXT_LIMIT,
  // Each accepted UTF-16 code unit can require six bytes when JSON-escaped.
  // Include all three short fields plus space for the keys and analysis options.
  analysisRequestBytes: ANALYSIS_REQUEST_BYTES,
  // Saving carries the same incident input plus the completed report and usage.
  analysisSaveBytes: ANALYSIS_REQUEST_BYTES + 512_000,
  imagePayload: 8_000_000,
  imageFileBytes: 5_000_000,
  smallJson: 16_384,
  mcpJson: 262_144,
} as const;

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ImageValidationError = "unsupported_type" | "file_too_large";

export function validateImageFile(file: Pick<File, "size" | "type">): ImageValidationError | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > INPUT_LIMITS.imageFileBytes) return "file_too_large";
  return null;
}

export function isAllowedImageSource(value: string): boolean {
  if (/^https:\/\//i.test(value)) return true;
  return ALLOWED_IMAGE_TYPES.some((type) => value.startsWith(`data:${type};base64,`));
}

export function safeDisplayFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100) || "screenshot";
}

export function contentLengthExceeds(req: Request, maxBytes: number): boolean {
  const header = req.headers.get("content-length");
  if (!header) return false;
  const length = Number(header);
  return Number.isFinite(length) && length > maxBytes;
}

export type BodyReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "payload_too_large" | "invalid_json" };

/** Read a request body with a real byte limit, even when Content-Length is absent or false. */
export async function readTextBody(req: Request, maxBytes: number): Promise<BodyReadResult<string>> {
  req.signal.throwIfAborted();
  if (contentLengthExceeds(req, maxBytes)) return { ok: false, error: "payload_too_large" };
  if (!req.body) return { ok: true, value: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      req.signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload too large").catch(() => undefined);
        return { ok: false, error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<BodyReadResult<unknown>> {
  const body = await readTextBody(req, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.value) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

/** Public machine endpoints must be explicitly opted into on Vercel production. */
export function machineEndpointNeedsSecret(secret: string | undefined): boolean {
  const hosted = process.env.NODE_ENV === "production"
    || process.env.VERCEL_ENV === "production"
    || process.env.VERCEL_ENV === "preview";
  return hosted
    && !secret
    && process.env.ALLOW_PUBLIC_MACHINE_API !== "true";
}

/** Recursively redact secret-like strings while retaining the input shape. */
export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactSensitiveValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactSensitiveValue(child)]),
    ) as T;
  }
  return value;
}
