"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface SupportMessageDto {
  id: string;
  senderRole: "USER" | "ADMIN";
  body: string;
  createdAt: string;
}

export default function SupportPage() {
  const { token } = useAuth();
  const { t, locale } = useTranslation();
  const [messages, setMessages] = useState<SupportMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function load() {
    if (!token) return;
    apiRequest<{ messages: SupportMessageDto[] }>("/support", { token })
      .then((data) => setMessages(data.messages))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || !token) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest<{ message: SupportMessageDto }>("/support", { method: "POST", token, body: { body } });
      setDraft("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("dash.support.error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("dash.support.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("dash.support.subtitle")}</p>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}
          {!loading && messages.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">{t("dash.support.empty")}</p>
          )}
          {messages.map((m) => {
            const mine = m.senderRole === "USER";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    mine ? "bg-emerald-500/20 text-emerald-100" : "bg-white/10 text-slate-100"
                  }`}
                >
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {mine ? t("dash.support.you") : t("dash.support.admin")}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500">{new Date(m.createdAt).toLocaleString(locale)}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-3 border-t border-white/10 p-4"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("dash.support.placeholder")}
            className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? t("common.sending") : t("common.send")}
          </button>
        </form>
      </div>
    </div>
  );
}
