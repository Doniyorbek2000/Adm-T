import en, { TranslationKey } from "./en";
import ru from "./ru";
import uz from "./uz";
import tr from "./tr";
import ar from "./ar";
import de from "./de";
import kk from "./kk";
import zh from "./zh";
import es from "./es";
import fr from "./fr";
import fa from "./fa";
import ky from "./ky";

export type Dictionary = Record<TranslationKey, string>;

export const dictionaries: Record<string, Dictionary> = {
  en,
  ru,
  uz,
  tr,
  ar,
  de,
  kk,
  zh,
  es,
  fr,
  fa,
  ky,
};
