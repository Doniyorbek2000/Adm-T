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
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", flag: "🇹🇷", dir: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", flag: "🇸🇦", dir: "rtl" },
  { code: "de", nativeName: "Deutsch", englishName: "German", flag: "🇩🇪", dir: "ltr" },
  { code: "kk", nativeName: "Қазақша", englishName: "Kazakh", flag: "🇰🇿", dir: "ltr" },
  { code: "zh", nativeName: "中文", englishName: "Chinese", flag: "🇨🇳", dir: "ltr" },
  { code: "es", nativeName: "Español", englishName: "Spanish", flag: "🇪🇸", dir: "ltr" },
  { code: "fr", nativeName: "Français", englishName: "French", flag: "🇫🇷", dir: "ltr" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian", flag: "🇮🇷", dir: "rtl" },
  { code: "ky", nativeName: "Кыргызча", englishName: "Kyrgyz", flag: "🇰🇬", dir: "ltr" },
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
