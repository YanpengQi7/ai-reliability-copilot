"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALES, type Locale } from "./messages";
import { LOCALE_COOKIE, OUTPUT_LANG_COOKIE } from "./server";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocaleAction(locale: Locale) {
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  const c = await cookies();
  c.set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function setOutputLanguageAction(locale: Locale) {
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  const c = await cookies();
  c.set(OUTPUT_LANG_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}
