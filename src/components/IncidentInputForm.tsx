"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/messages";
import { tryParseAlert } from "@/lib/alertParsers";
import { SAMPLE_ALERTS } from "@/lib/sampleAlerts";
import {
  ALLOWED_IMAGE_TYPES,
  INPUT_LIMITS,
  safeDisplayFilename,
  validateImageFile,
} from "@/lib/requestSafety";
import { readApiError } from "@/lib/http";

export type PromptVersion = "v1" | "v2" | "v3";

export type IncidentInput = {
  title: string;
  service: string;
  symptoms: string;
  raw_context: string;
  prompt_version: PromptVersion;
  output_language: Locale;
};

type VisionStatus = { kind: "idle" | "uploading" | "ok" | "err"; msg?: string };

export function IncidentInputForm({
  value,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  isSaving,
  generationStopped,
  analysisError,
  saveError,
}: {
  value: IncidentInput;
  onChange: Dispatch<SetStateAction<IncidentInput>>;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
  isSaving: boolean;
  generationStopped: boolean;
  analysisError?: Error;
  saveError: string | null;
}) {
  const t = useT();
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>({ kind: "idle" });
  const rawRef = useRef(value.raw_context);
  const disabled = isLoading || isSaving || visionStatus.kind === "uploading";

  useEffect(() => {
    rawRef.current = value.raw_context;
  }, [value.raw_context]);

  function update(patch: Partial<IncidentInput>) {
    onChange((current) => ({ ...current, ...patch }));
  }

  async function handleScreenshotUpload(file: File) {
    const validationError = validateImageFile(file);
    if (validationError) {
      setVisionStatus({
        kind: "err",
        msg: t(validationError === "file_too_large" ? "home.imageTooLarge" : "home.imageUnsupported"),
      });
      return;
    }

    setVisionStatus({ kind: "uploading" });
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: String(reader.result) }),
        });
        if (!res.ok) {
          const message = await readApiError(res, "Image analysis failed");
          setVisionStatus({
            kind: "err",
            msg: message.includes("OPENAI_API_KEY") ? t("home.visionMissingKey") : message,
          });
          return;
        }

        const response = await res.json() as { description: string };
        const block = `\n\n## Screenshot description (${safeDisplayFilename(file.name)})\n${response.description}\n`;
        if (rawRef.current.length + block.length > INPUT_LIMITS.rawContext) {
          setVisionStatus({ kind: "err", msg: t("home.contextTooLong") });
          return;
        }
        onChange((current) => ({ ...current, raw_context: current.raw_context + block }));
        setVisionStatus({ kind: "ok", msg: t("home.imageDescribed") });
      } catch (error) {
        setVisionStatus({ kind: "err", msg: error instanceof Error ? error.message : String(error) });
      }
    };
    reader.onerror = () => setVisionStatus({ kind: "err", msg: t("common.error") });
    reader.readAsDataURL(file);
  }

  function parseAlert() {
    const parsed = tryParseAlert(value.raw_context);
    if (!parsed) {
      setParseNotice(t("home.notRecognized"));
      return;
    }
    update({
      title: parsed.title ?? value.title,
      service: parsed.service ?? value.service,
      symptoms: parsed.symptoms ?? value.symptoms,
      raw_context: parsed.raw_context || value.raw_context,
    });
    setParseNotice(`${t("home.parsed")} ${parsed.source}`);
  }

  return (
    <section className="grid gap-4 bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <fieldset disabled={disabled} className="contents disabled:opacity-70">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">{t("home.field.title")}</span>
          <input
            value={value.title}
            onChange={(event) => update({ title: event.target.value })}
            maxLength={INPUT_LIMITS.shortText}
            className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">{t("home.field.service")}</span>
            <input
              value={value.service}
              onChange={(event) => update({ service: event.target.value })}
              maxLength={INPUT_LIMITS.shortText}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">{t("home.field.symptoms")}</span>
            <input
              value={value.symptoms}
              onChange={(event) => update({ symptoms: event.target.value })}
              maxLength={INPUT_LIMITS.shortText}
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-neutral-500">{t("home.trySample")}</span>
          {SAMPLE_ALERTS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => {
                update({ raw_context: JSON.stringify(sample.payload, null, 2) });
                setParseNotice(null);
              }}
              className="px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:border-neutral-500"
            >
              {sample.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-400">{t("home.field.rawContext")}</span>
            <button
              type="button"
              onClick={parseAlert}
              className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:border-emerald-500/70"
            >
              {t("home.parseAlert")}
            </button>
          </div>
          <textarea
            value={value.raw_context}
            onChange={(event) => {
              update({ raw_context: event.target.value });
              setParseNotice(null);
            }}
            rows={10}
            maxLength={INPUT_LIMITS.rawContext}
            aria-describedby="raw-context-count"
            className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 font-mono text-sm"
          />
          <span
            id="raw-context-count"
            className={`text-right text-xs ${value.raw_context.length >= INPUT_LIMITS.rawContext ? "text-amber-400" : "text-neutral-500"}`}
          >
            {value.raw_context.length.toLocaleString()} / {INPUT_LIMITS.rawContext.toLocaleString()} {t("home.characters")}
          </span>
          {parseNotice && (
            <span className={`text-xs ${parseNotice.includes(t("home.notRecognized")) ? "text-amber-400" : "text-emerald-400"}`}>
              {parseNotice}
            </span>
          )}
          <div className="flex items-center gap-3 mt-1">
            <label className={`text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 ${visionStatus.kind === "uploading" ? "cursor-not-allowed opacity-50" : "hover:border-emerald-500/70 cursor-pointer"}`}>
              {t("home.uploadScreenshot")}
              <input
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                disabled={visionStatus.kind === "uploading"}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleScreenshotUpload(file);
                  event.target.value = "";
                }}
              />
            </label>
            <span role="status" aria-live="polite">
              {visionStatus.kind === "uploading" && <span className="text-xs text-neutral-500 animate-pulse">{t("home.describingImage")}</span>}
              {visionStatus.kind === "ok" && <span className="text-xs text-emerald-400">{visionStatus.msg}</span>}
              {visionStatus.kind === "err" && <span className="text-xs text-amber-400">{visionStatus.msg}</span>}
            </span>
          </div>
        </label>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-neutral-400 mr-1">{t("home.promptLabel")}</span>
            {(["v1", "v2", "v3"] as const).map((promptVersion) => (
              <button
                key={promptVersion}
                type="button"
                onClick={() => update({ prompt_version: promptVersion })}
                className={`px-2 py-1 rounded border ${value.prompt_version === promptVersion ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
              >
                {promptVersion}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-neutral-400 mr-1">{t("home.outputLanguage")}</span>
            {LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => update({ output_language: locale })}
                className={`px-2 py-1 rounded border ${value.output_language === locale ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}
              >
                {LOCALE_LABELS[locale]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={visionStatus.kind === "uploading" || value.raw_context.length < 20}
            className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-md"
          >
            {isLoading ? t("home.streaming") : isSaving ? t("home.saving") : t("home.analyze")}
          </button>
          <span role="status" aria-live="polite">
            {isLoading && <span className="text-xs text-neutral-500 animate-pulse">{t("home.generatingHint")}</span>}
            {isSaving && <span className="text-xs text-neutral-500">{t("home.savingHint")}</span>}
          </span>
        </div>
      </fieldset>

      {isLoading && (
        <button
          type="button"
          onClick={onStop}
          className="justify-self-start rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:border-red-400 hover:bg-red-500/10"
        >
          {t("home.stopGenerating")}
        </button>
      )}
      {generationStopped && (
        <p role="status" className="text-sm text-amber-300">
          {t("home.generationStopped")}
        </p>
      )}
      {analysisError && (
        <p className="text-red-400 text-sm">
          {analysisError.message?.includes("MISSING_API_KEY") ? t("home.errorMissingKey") : `${t("common.error")}: ${analysisError.message}`}
        </p>
      )}
      {saveError && (
        <div role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-medium">{t("home.analysisNotSaved")}</p>
          <p className="mt-1 text-xs text-amber-200/80">{saveError}</p>
        </div>
      )}
    </section>
  );
}
