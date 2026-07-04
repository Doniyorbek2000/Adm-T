import { prisma } from "../utils/prisma";
import { env } from "../utils/env";

/**
 * Markazlashgan xabarnoma servisi: DB xabarnomasi + Telegram.
 *
 * Telegram sozlash (bir marta):
 * 1) @BotFather orqali bot yarating → tokenni TELEGRAM_BOT_TOKEN env'ga qo'ying
 * 2) Botga /start yozing, keyin https://api.telegram.org/bot<TOKEN>/getUpdates
 *    dan chat.id ni oling → TELEGRAM_CHAT_ID env'ga qo'ying
 *
 * Telegram sozlanmagan bo'lsa faqat DB xabarnoma yoziladi — hech narsa buzilmaydi.
 */

export async function sendTelegram(text: string): Promise<void> {
  if (!env.telegramBotToken || !env.telegramChatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.telegramChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[Telegram] Xabar yuborilmadi (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[Telegram] Xabar yuborishda xato:", err instanceof Error ? err.message : err);
  }
}

/**
 * Foydalanuvchiga xabarnoma: DB'ga yoziladi va (sozlangan bo'lsa) Telegramga
 * yuboriladi. Telegram xatosi asosiy oqimni hech qachon to'xtatmaydi.
 */
export async function notifyUser(userId: string, title: string, message: string): Promise<void> {
  await prisma.notification.create({ data: { userId, title, message } });
  // Kutmasdan (fire-and-forget) — savdo oqimini sekinlashtirmaslik uchun
  void sendTelegram(`<b>${escapeHtml(title)}</b>\n${escapeHtml(message)}`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
