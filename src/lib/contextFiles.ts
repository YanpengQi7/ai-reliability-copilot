import { INPUT_LIMITS } from "./requestSafety";

export const CONTEXT_FILE_LIMITS = {
  files: 5,
  fileBytes: 200_000,
  batchBytes: 500_000,
} as const;

export const CONTEXT_FILE_ACCEPT = ".txt,.log,.json,.md,.csv";

export type ContextAttachment = { name: string; text: string };
export type ContextImportMode = "append" | "replace";
export type ContextImportErrorCode =
  | "too_many_files" | "unsupported_type" | "file_too_large" | "batch_too_large"
  | "binary_file" | "invalid_encoding" | "empty_file" | "read_failed" | "cancelled";

export class ContextImportError extends Error {
  readonly code: ContextImportErrorCode;
  readonly filename?: string;

  constructor(code: ContextImportErrorCode, filename?: string) {
    super(code);
    this.name = "ContextImportError";
    this.code = code;
    this.filename = filename === undefined ? undefined : safeContextFilename(filename);
  }
}

type ContextFile = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** Plain, bounded display names; never retain paths, line breaks or markup. */
export function safeContextFilename(name: string): string {
  const basename = name.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const safe = basename.normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "_")
    .replace(/\s+/g, " ").replace(/^[ ._-]+|[ ._-]+$/g, "");
  return Array.from(safe).slice(0, 100).join("") || "attachment";
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ContextImportError("cancelled");
}

function supportedFilename(name: string): boolean {
  return /\.(?:txt|log|json|md|csv)$/i.test(name);
}

function decodeText(bytes: Uint8Array, filename: string): string {
  // Reject UTF-16 explicitly, before its NUL bytes look like a binary file.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new ContextImportError("invalid_encoding", filename);
  }
  // ANSI ESC is common in terminal logs. Other ASCII control bytes are not text.
  if (bytes.some(byte => (byte < 0x20 && ![0x09, 0x0a, 0x0d, 0x1b].includes(byte)) || byte === 0x7f)) {
    throw new ContextImportError("binary_file", filename);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContextImportError("invalid_encoding", filename);
  }
  if (/[\u0080-\u009f]/.test(text)) throw new ContextImportError("binary_file", filename);
  if (!text.trim()) throw new ContextImportError("empty_file", filename);
  return text;
}

/** Read only into browser memory. Nothing is returned until every file succeeds. */
export async function readContextFiles(
  files: readonly ContextFile[],
  options: { signal?: AbortSignal } = {},
): Promise<ContextAttachment[]> {
  const { signal } = options;
  checkCancelled(signal);
  if (files.length > CONTEXT_FILE_LIMITS.files) throw new ContextImportError("too_many_files");

  let declaredBytes = 0;
  for (const file of files) {
    if (!supportedFilename(file.name)) throw new ContextImportError("unsupported_type", file.name);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new ContextImportError("read_failed", file.name);
    if (file.size > CONTEXT_FILE_LIMITS.fileBytes) throw new ContextImportError("file_too_large", file.name);
    declaredBytes += file.size;
  }
  if (declaredBytes > CONTEXT_FILE_LIMITS.batchBytes) throw new ContextImportError("batch_too_large");

  const attachments: ContextAttachment[] = [];
  let actualBytes = 0;
  for (const file of files) {
    checkCancelled(signal);
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      checkCancelled(signal);
      throw new ContextImportError("read_failed", file.name);
    }
    checkCancelled(signal);
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > CONTEXT_FILE_LIMITS.fileBytes) throw new ContextImportError("file_too_large", file.name);
    actualBytes += bytes.byteLength;
    if (actualBytes > CONTEXT_FILE_LIMITS.batchBytes) throw new ContextImportError("batch_too_large");
    attachments.push({ name: safeContextFilename(file.name), text: decodeText(bytes, file.name) });
  }
  checkCancelled(signal);
  return attachments;
}

export type ComposedContextResult =
  | { ok: true; text: string; characters: number }
  | { ok: false; error: "context_too_long"; characters: number };

/** Never truncate evidence; one replacement remains parseable alert JSON. */
export function composeImportedContext(
  existing: string,
  attachments: readonly ContextAttachment[],
  mode: ContextImportMode,
): ComposedContextResult {
  let text = existing;
  if (attachments.length) {
    const imported = mode === "replace" && attachments.length === 1
      ? attachments[0].text
      : attachments.map(attachment => {
        const name = safeContextFilename(attachment.name).replace(/_/g, "\\_");
        return `## File: ${name}\n${attachment.text}`;
      }).join("\n\n");
    text = mode === "append" && existing ? `${existing}\n\n${imported}` : imported;
  }
  const characters = text.length;
  return characters > INPUT_LIMITS.rawContext
    ? { ok: false, error: "context_too_long", characters }
    : { ok: true, text, characters };
}
