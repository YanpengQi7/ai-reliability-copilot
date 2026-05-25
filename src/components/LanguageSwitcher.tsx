"use client";

import { useTransition } from "react";
import { setLocaleAction } from "@/lib/i18n/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/messages";
import { useLocale } from "@/lib/i18n/client";

export function LanguageSwitcher() {
  const current = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-1 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => setLocaleAction(l as Locale))}
          className={`px-2 py-1 rounded border ${current === l ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"} disabled:opacity-50`}
          aria-pressed={current === l}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
