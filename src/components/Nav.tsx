"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function Nav() {
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-2">
      <LanguageSwitcher />
      <nav className="flex gap-3 text-sm text-neutral-400">
        <Link className="hover:text-white" href="/">{t("nav.new")}</Link>
        <Link className="hover:text-white" href="/incidents">{t("nav.incidents")}</Link>
        <Link className="hover:text-white" href="/scenarios">{t("nav.scenarios")}</Link>
        <Link className="hover:text-white" href="/evals">{t("nav.evals")}</Link>
      </nav>
    </div>
  );
}
