import { prisma } from "../utils/prisma";

/**
 * Platforma darajasidagi sozlamalar (DB'da saqlanadi, server qayta ishga
 * tushganda ham saqlanib qoladi).
 *
 * Eng muhimi — AI dvigatel kill-switch: favqulodda holatda admin bitta tugma
 * bilan barcha YANGI avtomatik savdolarni to'xtata oladi. Ochiq pozitsiyalarni
 * kuzatish va yopish esa davom etadi (himoya to'xtamasligi kerak).
 */

export const SETTING_AI_ENGINE_PAUSED = "aiEnginePaused";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function isAiEnginePaused(): Promise<boolean> {
  try {
    return (await getSetting(SETTING_AI_ENGINE_PAUSED)) === "true";
  } catch {
    // Sozlamani o'qib bo'lmasa — xavfsiz tomonga: yangi savdo ochmaymiz
    return true;
  }
}

export async function setAiEnginePaused(paused: boolean): Promise<void> {
  await setSetting(SETTING_AI_ENGINE_PAUSED, paused ? "true" : "false");
}
