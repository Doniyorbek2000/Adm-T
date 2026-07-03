"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { getLocaleInfo, LOCALES } from "@/lib/i18n/locales";

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = getLocaleInfo(locale);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("common.language")}
        className={`flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 text-sm hover:bg-white/10 ${
          compact ? "px-2.5 py-1.5" : "px-3 py-1.5"
        }`}
      >
        <span>{current.flag}</span>
        {!compact && <span className="hidden sm:inline">{current.nativeName}</span>}
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 max-h-80 w-56 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLocale(l.code);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-white/5 ${
                l.code === locale ? "bg-emerald-400/10 text-emerald-300" : "text-slate-200"
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.nativeName}</span>
              <span className="ml-auto text-xs text-slate-500">{l.englishName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
