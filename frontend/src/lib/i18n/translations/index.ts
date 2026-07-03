import en, { TranslationKey } from "./en";
import ru from "./ru";
import uz from "./uz";

export type Dictionary = Record<TranslationKey, string>;

export const dictionaries: Record<string, Dictionary> = {
  en,
  ru,
  uz,
};
