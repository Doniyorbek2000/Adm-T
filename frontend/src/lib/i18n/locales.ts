export interface LocaleInfo {
  code: string;
  nativeName: string;
  englishName: string;
  flag: string;
  dir: "ltr" | "rtl";
}

export const LOCALES: LocaleInfo[] = [
  { code: "en", nativeName: "English", englishName: "English", flag: "🇬🇧", dir: "ltr" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", flag: "🇷🇺", dir: "ltr" },
  { code: "uz", nativeName: "O'zbekcha", englishName: "Uzbek", flag: "🇺🇿", dir: "ltr" },
];

export const DEFAULT_LOCALE = "en";

export const LOCALE_CODES = LOCALES.map((l) => l.code);

export type LocaleCode = (typeof LOCALE_CODES)[number];

export function isValidLocale(code: string | null | undefined): code is LocaleCode {
  return !!code && LOCALE_CODES.includes(code);
}

export function getLocaleInfo(code: string): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}
