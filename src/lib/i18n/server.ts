// Server-only: read the active locale from cookies (set by LanguageSwitcher).
// Default falls back to Accept-Language header on first visit.

import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./messages";

export const LOCALE_COOKIE = "copilot_locale";
export const OUTPUT_LANG_COOKIE = "copilot_output_lang";

function asLocale(v: string | undefined | null): Locale | null {
  if (!v) return null;
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : null;
}

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  const fromCookie = asLocale(c.get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  // First-visit fallback: sniff Accept-Language
  const h = await headers();
  const accept = h.get("accept-language") ?? "";
  if (/^zh\b|,\s*zh\b/i.test(accept)) return "zh";
  return DEFAULT_LOCALE;
}

export async function getOutputLanguage(): Promise<Locale> {
  const c = await cookies();
  // Default output language to the UI locale unless user has overridden it
  const explicit = asLocale(c.get(OUTPUT_LANG_COOKIE)?.value);
  if (explicit) return explicit;
  return getLocale();
}
