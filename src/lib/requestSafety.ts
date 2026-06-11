import { redactSecrets } from "./secretScan";

export const INPUT_LIMITS = {
  shortText: 500,
  rawContext: 50_000,
  imagePayload: 8_000_000,
  imageFileBytes: 5_000_000,
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

/** Public machine endpoints must be explicitly opted into on Vercel production. */
export function machineEndpointNeedsSecret(secret: string | undefined): boolean {
  return process.env.VERCEL_ENV === "production"
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
