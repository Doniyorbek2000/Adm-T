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

interface ConversationDto {
  userId: string;
  fullName: string;
  email: string;
  plan: string;
  lastMessage: SupportMessageDto | null;
  unreadCount: number;
}

const PLAN_LABELS: Record<string, string> = { FREE: "Bepul", PRO: "Pro", ULTRA: "Ultra", VIP: "VIP" };

export default function AdminSupportPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function loadConversations() {
    if (!token) return;
    apiRequest<{ conversations: ConversationDto[] }>("/admin/support", { token })
      .then((data) => {
        setConversations(data.conversations);
        if (!selected && data.conversations[0]) setSelected(data.conversations[0].userId);
      })
      .finally(() => setLoadingList(false));
  }

  useEffect(loadConversations, [token]);
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(loadConversations, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Qo'llab-quvvatlash va xabarlar</h1>
          <p className="mt-1 text-sm text-slate-400">Foydalanuvchilar bilan yozishing yoki ularga umumiy xabar yuboring.</p>
        </div>
        <button
          onClick={() => setBroadcastOpen(true)}
          className="self-start rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
        >
          📣 Xabar yuborish
        </button>
      </div>

      {notice && <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <div className="border-b border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Suhbatlar
          </div>
          <div className="max-h-[640px] divide-y divide-white/5 overflow-y-auto">
            {loadingList && <p className="px-4 py-6 text-sm text-slate-400">Yuklanmoqda...</p>}
            {!loadingList && conversations.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-500">Hozircha murojaatlar yo'q.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.userId}
                onClick={() => setSelected(c.userId)}
                className={`block w-full px-4 py-3 text-left transition hover:bg-white/5 ${
                  selected === c.userId ? "bg-emerald-400/10" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="truncate font-medium">{c.fullName}</p>
                  {c.unreadCount > 0 && (
                    <span className="ml-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-slate-400">{c.email}</p>
                {c.lastMessage && (
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {c.lastMessage.senderRole === "ADMIN" ? "Siz: " : ""}
                    {c.lastMessage.body}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <ConversationPanel
            key={selected}
            userId={selected}
            token={token}
            onReplied={loadConversations}
          />
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-sm text-slate-500">
            Suhbatni tanlang
          </div>
        )}
      </div>

      {broadcastOpen && (
        <BroadcastModal
          token={token}
          conversations={conversations}
          onClose={() => setBroadcastOpen(false)}
          onSent={(msg) => {
            setNotice(msg);
            setBroadcastOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ConversationPanel({ userId, token, onReplied }: { userId: string; token: string | null; onReplied: () => void }) {
  const [user, setUser] = useState<{ fullName: string; email: string; plan: string } | null>(null);
  const [messages, setMessages] = useState<SupportMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function load() {
    if (!token) return;
    apiRequest<{ user: { fullName: string; email: string; plan: string }; messages: SupportMessageDto[] }>(`/admin/support/${userId}`, { token })
      .then((data) => {
        setUser(data.user);
        setMessages(data.messages);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, userId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function reply() {
    const body = draft.trim();
    if (!body || !token) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest(`/admin/support/${userId}`, { method: "POST", token, body: { body } });
      setDraft("");
      load();
      onReplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Javobni yuborib bo'lmadi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[640px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="border-b border-white/10 bg-white/5 px-5 py-3">
        {user ? (
          <>
            <p className="font-semibold">{user.fullName}</p>
            <p className="text-xs text-slate-400">
              {user.email} • <span className="font-medium text-emerald-300">{PLAN_LABELS[user.plan] ?? user.plan}</span> tarif
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">Yuklanmoqda...</p>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}
        {messages.map((m) => {
          const fromAdmin = m.senderRole === "ADMIN";
          return (
            <div key={m.id} className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  fromAdmin ? "bg-emerald-500/20 text-emerald-100" : "bg-white/10 text-slate-100"
                }`}
              >
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {fromAdmin ? "Siz (admin)" : user?.fullName ?? "Foydalanuvchi"}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{new Date(m.createdAt).toLocaleString("uz-UZ")}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-5 pb-2 text-sm text-rose-300">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          reply();
        }}
        className="flex gap-3 border-t border-white/10 p-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Javobingizni yozing..."
          className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {sending ? "Yuborilmoqda..." : "Javob yuborish"}
        </button>
      </form>
    </div>
  );
}

function BroadcastModal({
  token,
  conversations,
  onClose,
  onSent,
}: {
  token: string | null;
  conversations: ConversationDto[];
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [target, setTarget] = useState<"ALL" | string>("ALL");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!token || !title.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const data = await apiRequest<{ message: string }>("/admin/notifications", {
        method: "POST",
        token,
        body: {
          title: title.trim(),
          message: body.trim(),
          ...(target !== "ALL" ? { userId: target } : {}),
        },
      });
      onSent(data.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xabarni yuborib bo'lmadi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Xabar yuborish</h2>
        <p className="mt-1 text-sm text-slate-400">Barcha foydalanuvchilarga yoki bitta foydalanuvchiga bildirishnoma yuboring.</p>

        <div className="mt-5 space-y-4">
          <label className="block text-xs">
            <span className="mb-1.5 block font-medium text-slate-400">Qabul qiluvchi</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              <option value="ALL">📢 Barcha foydalanuvchilar</option>
              {conversations.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.fullName} ({c.email})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="mb-1.5 block font-medium text-slate-400">Sarlavha</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: Tizim yangilanishi"
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1.5 block font-medium text-slate-400">Xabar matni</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Xabaringiz matnini shu yerga yozing..."
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          </label>
        </div>

        {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5">
            Bekor qilish
          </button>
          <button
            onClick={send}
            disabled={sending || !title.trim() || !body.trim()}
            className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? "Yuborilmoqda..." : "Yuborish"}
          </button>
        </div>
      </div>
    </div>
  );
}
