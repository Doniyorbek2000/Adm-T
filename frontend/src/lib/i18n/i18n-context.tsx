"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import en, { TranslationKey } from "./translations/en";
import { DEFAULT_LOCALE, getLocaleInfo, isValidLocale, LocaleCode } from "./locales";
import { dictionaries } from "./translations";

const STORAGE_KEY = "adm_trading_locale";

type Dictionary = Record<TranslationKey, string>;

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValidLocale(stored)) {
      setLocaleState(stored);
    } else {
      const browserLang = window.navigator.language?.slice(0, 2);
      if (isValidLocale(browserLang)) setLocaleState(browserLang);
    }
  }, []);

  useEffect(() => {
    const info = getLocaleInfo(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = info.dir;
  }, [locale]);

  function setLocale(next: LocaleCode) {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const dictionary: Dictionary = useMemo(() => {
    return (dictionaries[locale] ?? en) as Dictionary;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => interpolate(dictionary[key] ?? en[key] ?? key, vars),
    }),
    [locale, dictionary]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within I18nProvider");
  return ctx;
}
