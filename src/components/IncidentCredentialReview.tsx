"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { IncidentInput } from "./IncidentInputForm";
import { buildIncidentPreflight } from "@/lib/incidentPreflight";
import { redactSensitiveValue } from "@/lib/requestSafety";
import { useT } from "@/lib/i18n/client";

const FIELD_LABELS = {
  title: "home.field.title",
  service: "home.field.service",
  symptoms: "home.field.symptoms",
  raw_context: "home.preflight.context",
} as const;

export function IncidentCredentialReview({ value, onChange, disabled }: {
  value: IncidentInput;
  onChange: Dispatch<SetStateAction<IncidentInput>>;
  disabled: boolean;
}) {
  const t = useT();
  const review = useMemo(() => buildIncidentPreflight(value), [value]);
  const hasFindings = review.findings.length > 0;

  return (
    <section aria-label={t("home.preflight.title")} className={`rounded-lg border p-4 ${hasFindings ? "border-amber-500/30 bg-amber-500/5" : "border-neutral-800 bg-neutral-950/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-neutral-200">{t("home.preflight.title")}</h2>
        {hasFindings && <button type="button" disabled={disabled} onClick={() => onChange((current) => redactSensitiveValue(current))} className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">{t("home.preflight.redact")}</button>}
      </div>
      <p className="mt-2 text-xs text-neutral-400">{t("home.preflight.body")}</p>
      {hasFindings ? (
        <details className="mt-3 text-xs text-amber-200">
          <summary className="cursor-pointer">{review.findings.length}{review.capped ? "+" : ""} {t("home.preflight.detected")}</summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
            {review.findings.map((finding, index) => <li key={index}>{t(FIELD_LABELS[finding.field])} · {finding.pattern} · {t("home.preflight.line")} {finding.line}</li>)}
          </ul>
        </details>
      ) : <p className="mt-2 text-xs text-neutral-500">{t("home.preflight.clean")}</p>}
    </section>
  );
}
