"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface SupportMessageDto {
  id: string;
  senderRole: "USER" | "ADMIN";
  body: string;
  createdAt: string;
}

export default function SupportPage() {
  const { token } = useAuth();
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
      setError(err instanceof ApiError ? err.message : "Xabarni yuborib bo'lmadi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Yordam markazi</h1>
        <p className="mt-1 text-sm text-slate-400">
          Savollaringiz bormi? Administratorga to'g'ridan-to'g'ri yozing — imkon qadar tez javob beramiz.
        </p>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}
          {!loading && messages.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">
              Hali yozishmalar yo'q. Quyidan birinchi xabaringizni yuboring — admin tez orada javob beradi.
            </p>
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
                    {mine ? "Siz" : "Administrator"}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500">{new Date(m.createdAt).toLocaleString("uz-UZ")}</p>
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
            placeholder="Xabaringizni shu yerga yozing..."
            className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? "Yuborilmoqda..." : "Yuborish"}
          </button>
        </form>
      </div>
    </div>
  );
}
