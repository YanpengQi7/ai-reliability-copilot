"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import {
  CONTEXT_FILE_ACCEPT,
  CONTEXT_FILE_LIMITS,
  ContextImportError,
  composeImportedContext,
  readContextFiles,
  type ContextAttachment,
} from "@/lib/contextFiles";
import { useLocale } from "@/lib/i18n/client";
import { INPUT_LIMITS } from "@/lib/requestSafety";

type ImportMode = "append" | "replace";
type ImportFailure = { code: ContextImportError["code"]; filename?: string };

const LABELS = {
  en: {
    title: "Import context files",
    choose: "Choose files",
    drop: "or drop files here",
    formats: "Up to 5 .txt, .log, .json, .md, or .csv files. Each file: 200 KB; total: 500 KB. UTF-8 text only.",
    privacy: "Files are read in your browser. Their contents are sent with the incident only when you analyze it.",
    reading: "Reading files locally…",
    cancel: "Cancel reading",
    cancelled: "Reading cancelled. Incident context was not changed.",
    review: "Review imported files",
    mode: "How to add these files",
    append: "Append to incident context",
    replace: "Replace incident context",
    replaceNotice: "Applying this preview will replace the existing incident context.",
    emptyNotice: "Incident context is empty. The selected file will become the incident context.",
    existing: "Existing context:",
    characters: "characters",
    preview: "Combined context preview",
    filePreview: "Selected files preview",
    combined: "Combined context:",
    tooLong: "The combined context exceeds the 50,000-character limit. Shorten the context or select smaller files before applying.",
    tooLongAppend: "The combined context exceeds the 50,000-character limit. Choose Replace, shorten the existing context, or select smaller files before applying.",
    apply: "Apply to incident context",
    discard: "Discard preview",
    applied: "Files added to incident context. Review it before analyzing.",
    errors: {
      too_many_files: "Choose no more than 5 files at a time.",
      unsupported_type: "Use .txt, .log, .json, .md, or .csv files.",
      file_too_large: "Each file must be 200 KB or smaller.",
      batch_too_large: "The selected files must total 500 KB or less.",
      binary_file: "This file contains binary data. Choose a UTF-8 text file.",
      invalid_encoding: "This file is not valid UTF-8 text. Save it as UTF-8 and try again.",
      empty_file: "This file contains no text to import.",
      read_failed: "The files could not be read. Try selecting them again.",
      cancelled: "Reading cancelled. Incident context was not changed.",
    },
  },
  zh: {
    title: "导入故障上下文文件",
    choose: "选择文件",
    drop: "或将文件拖放到这里",
    formats: "最多 5 个 .txt、.log、.json、.md 或 .csv 文件。每个文件最大 200 KB，总大小最大 500 KB。仅支持 UTF-8 文本。",
    privacy: "文件在浏览器中读取。仅在分析故障时，文件内容才会随故障上下文发送。",
    reading: "正在浏览器中读取文件…",
    cancel: "取消读取",
    cancelled: "已取消读取。故障上下文未更改。",
    review: "检查导入的文件",
    mode: "如何添加这些文件",
    append: "追加到故障上下文",
    replace: "替换故障上下文",
    replaceNotice: "应用此预览将替换现有的故障上下文。",
    emptyNotice: "故障上下文为空。所选文件将成为故障上下文。",
    existing: "现有上下文：",
    characters: "字符",
    preview: "合并后的上下文预览",
    filePreview: "所选文件预览",
    combined: "合并后的上下文：",
    tooLong: "合并后的上下文超过 50,000 字符上限。请缩短上下文或选择更小的文件后再应用。",
    tooLongAppend: "合并后的上下文超过 50,000 字符上限。请选择「替换」、缩短现有上下文或选择更小的文件后再应用。",
    apply: "应用到故障上下文",
    discard: "丢弃预览",
    applied: "文件已加入故障上下文。分析前请检查上下文。",
    errors: {
      too_many_files: "一次最多选择 5 个文件。",
      unsupported_type: "请选择 .txt、.log、.json、.md 或 .csv 文件。",
      file_too_large: "每个文件必须小于或等于 200 KB。",
      batch_too_large: "所选文件总大小必须小于或等于 500 KB。",
      binary_file: "此文件包含二进制数据。请选择 UTF-8 文本文件。",
      invalid_encoding: "此文件不是有效的 UTF-8 文本。请以 UTF-8 编码保存后重试。",
      empty_file: "此文件没有可导入的文本。",
      read_failed: "无法读取文件。请重新选择文件后再试。",
      cancelled: "已取消读取。故障上下文未更改。",
    },
  },
};

export function ContextFileImport({ rawContext, disabled = false, onApply, onBusyChange }: {
  rawContext: string;
  disabled?: boolean;
  onApply: (attachments: ContextAttachment[], mode: ImportMode) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const locale = useLocale();
  const labels = LABELS[locale];
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const busyCallbackRef = useRef(onBusyChange);
  const dragDepthRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [chosenMode, setChosenMode] = useState<ImportMode | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState<"cancelled" | "applied" | null>(null);
  const mode = chosenMode ?? (rawContext.length ? "append" : "replace");
  const unavailable = disabled || busy;
  const composition = attachments.length ? composeImportedContext(rawContext, attachments, mode) : null;
  const preview = composition?.ok
    ? composition.text
    : attachments.map((attachment) => `${attachment.name}\n${attachment.text}`).join("\n\n");
  const buttonClass = "rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50";

  useEffect(() => {
    busyCallbackRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    if (busyRef.current) busyCallbackRef.current?.(false);
  }, []);

  function changeBusy(next: boolean) {
    busyRef.current = next;
    setBusy(next);
    busyCallbackRef.current?.(next);
  }

  async function selectFiles(files: File[]) {
    if (disabled || busyRef.current || !files.length) return;
    const generation = ++generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAttachments([]);
    setChosenMode(null);
    setFailure(null);
    setNotice(null);
    setDragging(false);
    dragDepthRef.current = 0;
    changeBusy(true);

    try {
      const imported = await readContextFiles(files, { signal: controller.signal });
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setAttachments(imported);
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      if (error instanceof ContextImportError) {
        if (error.code === "cancelled") setNotice("cancelled");
        else setFailure({ code: error.code, filename: error.filename });
      } else {
        setFailure({ code: "read_failed" });
      }
    } finally {
      if (generation === generationRef.current) {
        controllerRef.current = null;
        changeBusy(false);
      }
    }
  }

  function cancelReading() {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setAttachments([]);
    setFailure(null);
    setNotice("cancelled");
    changeBusy(false);
  }

  function discardPreview() {
    setAttachments([]);
    setChosenMode(null);
    setFailure(null);
    setNotice(null);
  }

  function applyPreview() {
    if (unavailable || !attachments.length || !composeImportedContext(rawContext, attachments, mode).ok) return;
    onApply(attachments, mode);
    setAttachments([]);
    setChosenMode(null);
    setFailure(null);
    setNotice("applied");
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = unavailable ? "none" : "copy";
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <h3 id={`${id}-title`} className="text-sm font-medium text-neutral-200">{labels.title}</h3>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (unavailable || !event.dataTransfer.types.includes("Files")) return;
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragging(false);
          if (!unavailable) void selectFiles(Array.from(event.dataTransfer.files));
        }}
        className={`mt-2 rounded-lg border border-dashed p-3 ${dragging && !unavailable ? "border-indigo-400 bg-indigo-500/10" : "border-neutral-700"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={unavailable} onClick={() => inputRef.current?.click()} aria-describedby={`${id}-formats`} className={buttonClass}>{labels.choose}</button>
          <span className="text-xs text-neutral-500">{labels.drop}</span>
          <input
            ref={inputRef}
            type="file"
            accept={CONTEXT_FILE_ACCEPT}
            multiple
            disabled={unavailable}
            aria-label={labels.choose}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void selectFiles(files);
            }}
          />
        </div>
        <p id={`${id}-formats`} className="mt-2 text-xs text-neutral-500">{labels.formats}</p>
        <p className="mt-1 text-xs text-neutral-500">{labels.privacy}</p>
      </div>

      {busy && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p role="status" className="text-xs text-neutral-400">{labels.reading}</p>
          <button type="button" onClick={cancelReading} className={buttonClass}>{labels.cancel}</button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-3 space-y-3">
          <h4 className="text-xs font-medium text-neutral-300">{labels.review} ({attachments.length}/{CONTEXT_FILE_LIMITS.files})</h4>
          <ul className="space-y-1 text-xs text-neutral-400">
            {attachments.map((attachment, index) => (
              <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words font-mono text-neutral-300">{attachment.name}</span>
                <span>{attachment.text.length.toLocaleString(locale)} {labels.characters}</span>
              </li>
            ))}
          </ul>

          <fieldset disabled={unavailable} className="space-y-2 text-xs text-neutral-300 disabled:opacity-50">
            <legend className="mb-2 text-neutral-400">{labels.mode}</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name={`${id}-mode`} value="append" checked={mode === "append"} onChange={() => setChosenMode("append")} className="accent-indigo-500" />
              {labels.append}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name={`${id}-mode`} value="replace" checked={mode === "replace"} onChange={() => setChosenMode("replace")} className="accent-indigo-500" />
              {labels.replace}
            </label>
          </fieldset>
          <p className="text-xs text-neutral-500">{labels.existing} {rawContext.length.toLocaleString(locale)} {labels.characters}</p>
          {rawContext.length > 0 && mode === "replace" && <p className="text-xs text-amber-300">{labels.replaceNotice}</p>}
          {!rawContext.length && mode === "replace" && attachments.length === 1 && <p className="text-xs text-neutral-400">{labels.emptyNotice}</p>}

          <div>
            <h4 className="mb-2 text-xs font-medium text-neutral-300">{composition?.ok ? labels.preview : labels.filePreview}</h4>
            <pre tabIndex={0} aria-label={composition?.ok ? labels.preview : labels.filePreview} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-400 focus-visible:outline-2 focus-visible:outline-indigo-400">{preview}</pre>
            {composition && <p className={`mt-2 text-xs ${composition.ok ? "text-neutral-500" : "text-amber-300"}`}>{labels.combined} {composition.characters.toLocaleString(locale)} / {INPUT_LIMITS.rawContext.toLocaleString(locale)} {labels.characters}</p>}
            {composition && !composition.ok && <p role="alert" className="mt-2 text-xs text-amber-300">{mode === "append" && rawContext.length ? labels.tooLongAppend : labels.tooLong}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={unavailable || !composition?.ok} onClick={applyPreview} className={`${buttonClass} border-indigo-500/40 text-indigo-300`}>{labels.apply}</button>
            <button type="button" disabled={unavailable} onClick={discardPreview} className={buttonClass}>{labels.discard}</button>
          </div>
        </div>
      )}

      {failure && <p role="alert" className="mt-3 text-xs text-amber-300">{labels.errors[failure.code]}{failure.filename && <span className="ml-1 break-words font-mono">({failure.filename})</span>}</p>}
      {notice && <p role="status" aria-live="polite" className={`mt-3 text-xs ${notice === "applied" ? "text-emerald-300" : "text-neutral-400"}`}>{labels[notice]}</p>}
    </section>
  );
}
