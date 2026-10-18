import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_FILE_ACCEPT, CONTEXT_FILE_LIMITS, ContextImportError,
  composeImportedContext, readContextFiles, safeContextFilename,
} from "./contextFiles";
import { INPUT_LIMITS } from "./requestSafety";

const encoder = new TextEncoder();

function file(name: string, text: string | Uint8Array, size?: number) {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  return {
    name,
    size: size ?? bytes.byteLength,
    arrayBuffer: vi.fn(async () => Uint8Array.from(bytes).buffer as ArrayBuffer),
  };
}

describe("readContextFiles", () => {
  it("reads supported file types in selection order, preserving text exactly", async () => {
    const files = [
      file("incident.TXT", "first line\r\nsecond line\n"),
      file("service.log", "2026-10-04 checkout error\n"),
      file("alert.json", '{"alert_title":"Checkout fails"}'),
      file("notes.md", "# Notes\nEvidence"),
      file("metrics.csv", "service,p99\ncheckout,8"),
    ];
    const attachments = await readContextFiles(files);
    expect(attachments.map(item => item.name)).toEqual(files.map(item => item.name));
    expect(attachments[0].text).toBe("first line\r\nsecond line\n");
    expect(attachments[2].text).toBe('{"alert_title":"Checkout fails"}');
    expect(CONTEXT_FILE_ACCEPT).toBe(".txt,.log,.json,.md,.csv");
  });

  it("validates every filename and size before reading any file", async () => {
    const valid = file("good.log", "context");
    const invalid = file("bad.pdf", "text named as PDF");
    await expect(readContextFiles([valid, invalid])).rejects.toMatchObject({ code: "unsupported_type", filename: "bad.pdf" });
    expect(valid.arrayBuffer).not.toHaveBeenCalled();
    expect(invalid.arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects too many files before reading, allowing exactly five", async () => {
    const files = Array.from({ length: CONTEXT_FILE_LIMITS.files + 1 }, (_, i) => file(`${i}.txt`, "context"));
    await expect(readContextFiles(files)).rejects.toMatchObject({ code: "too_many_files" });
    expect(files.every(item => item.arrayBuffer.mock.calls.length === 0)).toBe(true);
    expect(await readContextFiles(files.slice(0, 5))).toHaveLength(5);
  });

  it("rejects oversized file metadata before reading, accepting the exact byte boundary", async () => {
    const oversized = file("large.log", "small payload", CONTEXT_FILE_LIMITS.fileBytes + 1);
    await expect(readContextFiles([oversized])).rejects.toMatchObject({ code: "file_too_large" });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    const boundary = file("boundary.log", "x".repeat(CONTEXT_FILE_LIMITS.fileBytes));
    expect((await readContextFiles([boundary]))[0].text).toHaveLength(CONTEXT_FILE_LIMITS.fileBytes);
  });

  it("rejects aggregate metadata over the limit before any read", async () => {
    const files = [file("a.log", "x", 200_000), file("b.log", "x", 200_000), file("c.log", "x", 100_001)];
    await expect(readContextFiles(files)).rejects.toMatchObject({ code: "batch_too_large" });
    expect(files.every(item => item.arrayBuffer.mock.calls.length === 0)).toBe(true);
    const boundary = [file("a.log", "a".repeat(200_000)), file("b.log", "b".repeat(200_000)), file("c.log", "c".repeat(100_000))];
    expect(await readContextFiles(boundary)).toHaveLength(3);
  });

  it("enforces actual file bytes even if declared sizes are smaller", async () => {
    await expect(readContextFiles([file("misreported.log", "x".repeat(CONTEXT_FILE_LIMITS.fileBytes + 1), 1)])).rejects.toMatchObject({ code: "file_too_large" });
    const files = [file("a.log", "a".repeat(200_000), 1), file("b.log", "b".repeat(200_000), 1), file("c.log", "c".repeat(100_001), 1)];
    await expect(readContextFiles(files)).rejects.toMatchObject({ code: "batch_too_large" });
  });

  it("counts UTF-8 bytes independently of the later context character limit", async () => {
    const withinByteLimit = file("中文.log", "故".repeat(60_000));
    const attachments = await readContextFiles([withinByteLimit]);
    expect(attachments[0].text).toHaveLength(60_000);
    expect(composeImportedContext("", attachments, "replace")).toEqual({ ok: false, error: "context_too_long", characters: 60_000 });
    await expect(readContextFiles([file("中文.log", "故".repeat(66_667))])).rejects.toMatchObject({ code: "file_too_large" });
  });

  it("accepts a UTF-8 BOM and ANSI log escape sequences", async () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...encoder.encode("故障日志\n")]);
    expect((await readContextFiles([file("中文.txt", bom)]))[0].text).toBe("故障日志\n");
    expect((await readContextFiles([file("color.log", "\u001b[31mERROR\u001b[0m\tcheckout\r\n")]))[0].text).toBe("\u001b[31mERROR\u001b[0m\tcheckout\r\n");
  });

  it.each([
    Uint8Array.from([0xff, 0xfe, 0x61, 0]),
    Uint8Array.from([0xfe, 0xff, 0, 0x61]),
    Uint8Array.from([0xc3, 0x28]),
  ])("rejects UTF-16 and invalid UTF-8 instead of replacing characters", async bytes => {
    await expect(readContextFiles([file("encoding.txt", bytes)])).rejects.toMatchObject({ code: "invalid_encoding" });
  });

  it.each(["text\u0000binary", "text\u0001binary", "text\u007fbinary", "text\u0085binary"])("rejects binary control content: %s", async content => {
    await expect(readContextFiles([file("binary.txt", content)])).rejects.toMatchObject({ code: "binary_file" });
  });

  it.each(["", " \t\r\n", "\uFEFF \n"])("rejects empty or whitespace-only files: %s", async content => {
    await expect(readContextFiles([file("empty.txt", content)])).rejects.toMatchObject({ code: "empty_file" });
  });

  it("returns no partial attachments when a later file fails", async () => {
    const first = file("first.log", "usable context");
    const invalid = file("second.log", "\u0000");
    const unread = file("third.log", "more context");
    await expect(readContextFiles([first, invalid, unread])).rejects.toBeInstanceOf(ContextImportError);
    expect(first.arrayBuffer).toHaveBeenCalledOnce();
    expect(invalid.arrayBuffer).toHaveBeenCalledOnce();
    expect(unread.arrayBuffer).not.toHaveBeenCalled();
  });

  it("classifies read failures with safe display filenames", async () => {
    const failed = { ...file("../日志\n[ignore].txt", "context"), arrayBuffer: vi.fn(async () => { throw new Error("private path /Users/me/secrets"); }) };
    await expect(readContextFiles([failed])).rejects.toMatchObject({ code: "read_failed", filename: "日志__ignore_.txt", message: "read_failed" });
  });

  it("does not begin a read after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = file("incident.log", "context");
    await expect(readContextFiles([input], { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(input.arrayBuffer).not.toHaveBeenCalled();
  });

  it("checks cancellation after an awaited read and stops subsequent files", async () => {
    const controller = new AbortController();
    let resolveRead!: (buffer: ArrayBuffer) => void;
    const pending = { ...file("first.log", "context"), arrayBuffer: vi.fn(() => new Promise<ArrayBuffer>(resolve => { resolveRead = resolve; })) };
    const next = file("second.log", "context");
    const result = readContextFiles([pending, next], { signal: controller.signal });
    controller.abort();
    resolveRead(encoder.encode("context").buffer as ArrayBuffer);
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(next.arrayBuffer).not.toHaveBeenCalled();
  });

  it("reports cancellation rather than a read error when both occur", async () => {
    const controller = new AbortController();
    const input = { ...file("incident.log", "context"), arrayBuffer: vi.fn(async () => {
      controller.abort();
      throw new Error("read cancelled");
    }) };
    await expect(readContextFiles([input], { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("composeImportedContext", () => {
  it("appends ordered, labeled evidence while preserving existing context", () => {
    const attachments = [{ name: "checkout.log", text: "checkout timeout\n" }, { name: "metrics.csv", text: "p99,8" }];
    const result = composeImportedContext("Existing notes\n", attachments, "append");
    expect(result).toEqual({
      ok: true,
      text: "Existing notes\n\n\n## File: checkout.log\ncheckout timeout\n\n\n## File: metrics.csv\np99,8",
      characters: "Existing notes\n\n\n## File: checkout.log\ncheckout timeout\n\n\n## File: metrics.csv\np99,8".length,
    });
    expect(attachments[0].text).toBe("checkout timeout\n");
  });

  it("replaces with a single JSON file exactly, keeping alert parsing available", () => {
    const text = ' {"alert_title":"Checkout fails", "body":"p99 8s"}\n';
    expect(composeImportedContext("Old notes", [{ name: "alert.json", text }], "replace")).toEqual({ ok: true, text, characters: text.length });
  });

  it("labels multiple replacements and ignores prior context", () => {
    expect(composeImportedContext("Old notes", [{ name: "a.txt", text: "first" }, { name: "b.txt", text: "second" }], "replace")).toMatchObject({
      ok: true, text: "## File: a.txt\nfirst\n\n## File: b.txt\nsecond",
    });
  });

  it("accepts the exact character boundary and rejects overflow without truncating", () => {
    const text = "x".repeat(INPUT_LIMITS.rawContext);
    expect(composeImportedContext("", [{ name: "exact.txt", text }], "replace")).toEqual({ ok: true, text, characters: INPUT_LIMITS.rawContext });
    expect(composeImportedContext("", [{ name: "large.txt", text: `${text}y` }], "replace")).toEqual({ ok: false, error: "context_too_long", characters: INPUT_LIMITS.rawContext + 1 });
    const appended = composeImportedContext(text, [{ name: "small.log", text: "new" }], "append");
    expect(appended).toMatchObject({ ok: false, error: "context_too_long" });
    expect(appended).not.toHaveProperty("text");
  });

  it("does not clear existing context when no files are selected", async () => {
    expect(composeImportedContext("Existing", [], "replace")).toEqual({ ok: true, text: "Existing", characters: 8 });
    expect(composeImportedContext("Existing", [], "append")).toEqual({ ok: true, text: "Existing", characters: 8 });
    await expect(readContextFiles([])).resolves.toEqual([]);
  });

  it("uses safe filename labels even with externally constructed attachments", () => {
    const result = composeImportedContext("", [{ name: "../文件\n## [link](https://evil.test).log", text: "evidence" }], "append");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.split("\n")).toHaveLength(2);
      expect(result.text).not.toContain("../");
      expect(result.text).not.toContain("[link]");
      expect(result.text).not.toContain("https://");
    }
  });
});

describe("safeContextFilename", () => {
  it("preserves Chinese names while removing paths, newlines, markup and controls", () => {
    expect(safeContextFilename("/tmp/支付日志.log")).toBe("支付日志.log");
    expect(safeContextFilename("C:\\Users\\me\\pool.log")).toBe("pool.log");
    expect(safeContextFilename("../[notes]\n```.md")).toBe("notes_____.md");
    expect(safeContextFilename("../../")).toBe("attachment");
    expect(Array.from(safeContextFilename(`${"文".repeat(200)}.log`))).toHaveLength(100);
  });
});
