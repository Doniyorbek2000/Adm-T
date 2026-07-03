"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface AccountDto {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  server?: string | null;
  isConnected: boolean;
  mode: "SIGNAL_ONLY" | "AUTO_TRADE";
  marketType?: "SPOT" | "FUTURES";
  riskLevel: number;
  balanceUsd: number;
  createdAt: string;
}

// ── Exchange meta ────────────────────────────────────────────────────────────
const EXCHANGE_META: Record<string, { icon: string; color: string; bg: string }> = {
  Binance:  { icon: "₿",   color: "text-yellow-300", bg: "bg-yellow-500/15" },
  Bybit:    { icon: "BY",  color: "text-orange-300",  bg: "bg-orange-500/15" },
  OKX:      { icon: "OKX", color: "text-slate-200",   bg: "bg-slate-500/20"  },
  KuCoin:   { icon: "KC",  color: "text-emerald-300", bg: "bg-emerald-500/15"},
  BingX:    { icon: "BX",  color: "text-sky-300",     bg: "bg-sky-500/15"   },
  MT5:      { icon: "MT5", color: "text-violet-300",  bg: "bg-violet-500/15" },
  Demo:     { icon: "▷",   color: "text-slate-400",   bg: "bg-slate-500/10"  },
  Boshqa:   { icon: "?",   color: "text-slate-400",   bg: "bg-slate-500/10"  },
};

function ExchangeAvatar({ exchange }: { exchange: string }) {
  const m = EXCHANGE_META[exchange] ?? EXCHANGE_META.Boshqa;
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${m.bg} ${m.color}`}>
      {m.icon}
    </div>
  );
}

const RISK_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Past",   color: "text-emerald-400" },
  2: { label: "O'rta",  color: "text-amber-400"   },
  3: { label: "Yuqori", color: "text-rose-400"     },
};

export default function AccountsPage() {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    apiRequest<{ accounts: AccountDto[] }>("/broker-accounts", { token })
      .then((d) => setAccounts(d.accounts))
      .catch((e) => setNotice({ type: "err", msg: e.message }))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function ok(msg: string) { setNotice({ type: "ok", msg }); }
  function err(msg: string) { setNotice({ type: "err", msg }); }

  async function handleDemo() {
    if (!token) return;
    setNotice(null);
    try {
      await apiRequest("/broker-accounts/demo", { method: "POST", token });
      ok("Demo hisob ochildi — $10,000 virtual balans bilan");
      load();
    } catch (e) { err(e instanceof ApiError ? e.message : "Xatolik"); }
  }

  async function handleMode(acc: AccountDto, mode: "SIGNAL_ONLY" | "AUTO_TRADE") {
    if (!token || updatingId) return;
    if (mode === "AUTO_TRADE") {
      const confirmed = window.confirm(
        `DIQQAT: Avto savdo rejimi\n\n` +
        `${acc.exchange} · ${acc.label} hisobingizda AI mustaqil ravishda\n` +
        `REAL pul bilan savdo qiladi!\n\n` +
        `• Balans: $${acc.balanceUsd.toLocaleString()}\n` +
        `• Risk: har savdoda balansning ${acc.riskLevel === 1 ? "0.5%" : acc.riskLevel === 2 ? "1%" : "2%"} tavakkal qilinadi (SL asosida)\n\n` +
        `Davom etishni xohlaysizmi?`
      );
      if (!confirmed) return;
    }
    setUpdatingId(acc.id);
    setNotice(null);
    try {
      await apiRequest(`/broker-accounts/${acc.id}`, { method: "PATCH", token, body: { mode } });
      load();
    } catch (e) { err(e instanceof ApiError ? e.message : "Xatolik"); }
    finally { setUpdatingId(null); }
  }

  async function handleRisk(acc: AccountDto, riskLevel: number) {
    if (!token || updatingId) return;
    setUpdatingId(acc.id);
    setNotice(null);
    try {
      await apiRequest(`/broker-accounts/${acc.id}`, { method: "PATCH", token, body: { riskLevel } });
      load();
    } catch (e) { err(e instanceof ApiError ? e.message : "Xatolik"); }
    finally { setUpdatingId(null); }
  }

  async function handleSync(acc: AccountDto) {
    if (!token || syncingId) return;
    setSyncingId(acc.id);
    setNotice(null);
    try {
      const r = await apiRequest<{ balanceUsd: number; synced: boolean; message?: string }>(
        `/broker-accounts/${acc.id}/sync`, { method: "POST", token }
      );
      if (r.synced) ok(`${acc.label}: balans yangilandi — $${r.balanceUsd.toLocaleString()}`);
      else ok(r.message ?? "Balans yangilanmadi");
      load();
    } catch (e) { err(e instanceof ApiError ? e.message : "Xatolik"); }
    finally { setSyncingId(null); }
  }

  async function handleDelete(acc: AccountDto) {
    if (!token) return;
    if (!confirm(`"${acc.label}" hisobini uzishni tasdiqlaysizmi?`)) return;
    setNotice(null);
    try {
      await apiRequest(`/broker-accounts/${acc.id}`, { method: "DELETE", token });
      ok(`${acc.label} uzildi`);
      load();
    } catch (e) { err(e instanceof ApiError ? e.message : "Xatolik"); }
  }

  const totalBalance = accounts.reduce((s, a) => s + a.balanceUsd, 0);
  const connected    = accounts.filter((a) => a.isConnected).length;
  const autoCount    = accounts.filter((a) => a.mode === "AUTO_TRADE").length;

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Broker Hisoblar</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            API kalitlar orqali birja hisoblarini ulang va AI savdo rejimini sozlang
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDemo}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold hover:bg-white/10"
          >
            + Demo hisob
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            {showForm ? "✕ Yopish" : "+ Hisob ulash"}
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-slate-500">Jami balans</p>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-300">
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-slate-500">Ulanganlar</p>
            <p className="mt-1 font-mono text-xl font-bold text-sky-300">
              {connected} / {accounts.length}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-slate-500">Auto-savdo</p>
            <p className="mt-1 font-mono text-xl font-bold text-violet-300">{autoCount}</p>
          </div>
        </div>
      )}

      {/* ── Notice ── */}
      {notice && (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            notice.type === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-rose-500/10 text-rose-300"
          }`}
        >
          {notice.msg}
        </p>
      )}

      {/* ── Connect Form ── */}
      {showForm && (
        <ConnectForm
          token={token}
          onSuccess={() => { setShowForm(false); ok("Hisob muvaffaqiyatli ulandi"); load(); }}
          onError={err}
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          Yuklanmoqda...
        </div>
      )}

      {/* ── Account Cards ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {accounts.map((acc) => (
          <AccountCard
            key={acc.id}
            acc={acc}
            syncingId={syncingId}
            updatingId={updatingId}
            onMode={handleMode}
            onRisk={handleRisk}
            onSync={handleSync}
            onDelete={handleDelete}
          />
        ))}

        {!loading && accounts.length === 0 && (
          <div className="lg:col-span-2 rounded-2xl border border-dashed border-white/10 p-14 text-center">
            <p className="text-4xl">🔗</p>
            <p className="mt-4 text-lg font-semibold">Hali hisob ulanmagan</p>
            <p className="mt-2 text-sm text-slate-400">
              Birja API kalitlaringizni kiriting yoki bepul Demo hisobni oching
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Account Card ─────────────────────────────────────────────────────────────
function AccountCard({
  acc, syncingId, updatingId, onMode, onRisk, onSync, onDelete,
}: {
  acc: AccountDto;
  syncingId: string | null;
  updatingId: string | null;
  onMode: (a: AccountDto, m: "SIGNAL_ONLY" | "AUTO_TRADE") => void;
  onRisk: (a: AccountDto, r: number) => void;
  onSync: (a: AccountDto) => void;
  onDelete: (a: AccountDto) => void;
}) {
  const isDemo = acc.exchange === "Demo";
  const risk   = RISK_LABELS[acc.riskLevel] ?? RISK_LABELS[2];

  return (
    <div
      className={`rounded-2xl border bg-white/[0.025] ${
        acc.isConnected ? "border-emerald-500/20" : "border-white/10"
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <ExchangeAvatar exchange={acc.exchange} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{acc.label}</p>
          <p className="text-xs text-slate-500">
            {acc.exchange}
            {acc.server ? ` · ${acc.server}` : ""}
            {isDemo ? "" : ` · ••••${acc.id.slice(-4)}`}
          </p>
        </div>
        {acc.marketType === "FUTURES" && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            FUTURES
          </span>
        )}
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            acc.isConnected
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-slate-500/15 text-slate-400"
          }`}
        >
          {acc.isConnected ? "● Ulangan" : "○ Uzilgan"}
        </span>
      </div>

      {/* Balance */}
      <div className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-slate-500">Balans</p>
            <p className="mt-0.5 font-mono text-2xl font-bold">
              ${acc.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          {!isDemo && (
            <button
              onClick={() => onSync(acc)}
              disabled={!!syncingId}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-white/10 disabled:opacity-40"
            >
              {syncingId === acc.id ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
              ) : (
                "↻"
              )}
              {syncingId === acc.id ? "Yangilanmoqda" : "Balans yangilash"}
            </button>
          )}
        </div>
      </div>

      {/* Mode + Risk */}
      <div className="space-y-4 px-5 py-4">
        {/* Trade Mode */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Savdo rejimi</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onMode(acc, "SIGNAL_ONLY")}
              disabled={updatingId === acc.id}
              className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                acc.mode === "SIGNAL_ONLY"
                  ? "border-sky-400/40 bg-sky-400/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <p className={`font-semibold ${acc.mode === "SIGNAL_ONLY" ? "text-sky-300" : "text-slate-300"}`}>
                📡 Signal rejimi
              </p>
              <p className="mt-0.5 text-slate-500">AI signal beradi, siz savdo qilasiz</p>
            </button>
            <button
              onClick={() => onMode(acc, "AUTO_TRADE")}
              disabled={updatingId === acc.id}
              className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                acc.mode === "AUTO_TRADE"
                  ? "border-emerald-400/40 bg-emerald-400/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <p className={`font-semibold ${acc.mode === "AUTO_TRADE" ? "text-emerald-300" : "text-slate-300"}`}>
                🤖 Avto savdo
              </p>
              <p className="mt-0.5 text-slate-500">AI mustaqil ravishda savdo qiladi</p>
            </button>
          </div>
        </div>

        {/* Risk Level */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">
            Risk darajasi — <span className={`font-semibold ${risk.color}`}>{risk.label}</span>
          </p>
          <div className="flex gap-2">
            {[1, 2, 3].map((lvl) => (
              <button
                key={lvl}
                onClick={() => onRisk(acc, lvl)}
                disabled={updatingId === acc.id}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                  acc.riskLevel === lvl
                    ? lvl === 1
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30"
                      : lvl === 2
                      ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30"
                      : "bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/30"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {RISK_LABELS[lvl].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3">
        <p className="text-xs text-slate-600">
          {new Date(acc.createdAt).toLocaleDateString("uz-UZ")} dan beri
        </p>
        <button
          onClick={() => onDelete(acc)}
          className="text-xs font-semibold text-rose-400 hover:text-rose-300 hover:underline"
        >
          Uzish
        </button>
      </div>
    </div>
  );
}

// ── Connect Form ─────────────────────────────────────────────────────────────
const EXCHANGES = ["Binance", "Bybit", "OKX", "KuCoin", "BingX", "MT5"];

function ConnectForm({
  token,
  onSuccess,
  onError,
}: {
  token: string | null;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [exchange, setExchange]     = useState("Binance");
  const [label, setLabel]           = useState("");
  const [apiKey, setApiKey]         = useState("");
  const [apiSecret, setApiSecret]   = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [server, setServer]         = useState("");
  const [mode, setMode]             = useState<"SIGNAL_ONLY" | "AUTO_TRADE">("AUTO_TRADE");
  const [marketType, setMarketType] = useState<"SPOT" | "FUTURES">("SPOT");
  const [riskLevel, setRiskLevel]   = useState(2);
  const [submitting, setSubmitting] = useState(false);

  const isMt5              = exchange === "MT5";
  const requiresPassphrase = exchange === "OKX" || exchange === "KuCoin";
  const supportsFutures    = exchange === "Binance";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      await apiRequest("/broker-accounts", {
        method: "POST",
        token,
        body: {
          exchange,
          label: label.trim() || undefined,
          apiKey:     apiKey.trim(),
          apiSecret:  apiSecret.trim(),
          passphrase: requiresPassphrase ? passphrase.trim() : undefined,
          server:     isMt5 ? server.trim() : undefined,
          mode,
          riskLevel,
          marketType: supportsFutures ? marketType : "SPOT",
        },
      });
      onSuccess();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Ulanish xatosi");
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2.5 text-sm outline-none focus:border-emerald-400/60 placeholder:text-slate-600";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.025] p-6"
    >
      <div>
        <h2 className="text-lg font-semibold">Yangi hisob ulash</h2>
        <p className="mt-1 text-xs text-slate-500">
          API kalitlar faqat shifrlangan holda saqlanadi. Faqat o'qish va savdo ruxsati bilan kalit yarating.
        </p>
      </div>

      {/* Exchange Selector */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Birja tanlang</p>
        <div className="flex flex-wrap gap-2">
          {EXCHANGES.map((ex) => {
            const m = EXCHANGE_META[ex] ?? EXCHANGE_META.Boshqa;
            return (
              <button
                key={ex}
                type="button"
                onClick={() => setExchange(ex)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                  exchange === ex
                    ? `border-emerald-400/40 bg-emerald-400/10 text-white`
                    : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
                }`}
              >
                <span className={`text-xs ${m.color}`}>{m.icon}</span>
                {ex}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Nom (ixtiyoriy)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={`${exchange} asosiy hisob`} className={field} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            {isMt5 ? "MT5 Login (hisob raqami)" : "API Key"}
          </label>
          <input required value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={isMt5 ? "12345678" : "vAbc1234..."} className={field} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            {isMt5 ? "MT5 Parol" : "API Secret"}
          </label>
          <input required type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)}
            className={field} placeholder="••••••••••••" />
        </div>
        {requiresPassphrase && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">API Passphrase</label>
            <input required type="password" value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="API yaratishda kiritilgan ibora" className={field} />
          </div>
        )}
        {isMt5 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Broker server nomi</label>
            <input required value={server} onChange={(e) => setServer(e.target.value)}
              placeholder="MetaQuotes-Demo" className={field} />
          </div>
        )}
      </div>

      {/* Market type — faqat Binance uchun */}
      {supportsFutures && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Bozor turi</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setMarketType("SPOT")}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                marketType === "SPOT"
                  ? "border-emerald-400/40 bg-emerald-400/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}>
              <p className={`font-semibold ${marketType === "SPOT" ? "text-emerald-300" : "text-slate-300"}`}>Spot</p>
              <p className="mt-1 text-xs text-slate-500">Faqat BUY signallari bajariladi. Leverage yo'q — eng xavfsiz.</p>
            </button>
            <button type="button" onClick={() => setMarketType("FUTURES")}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                marketType === "FUTURES"
                  ? "border-amber-400/40 bg-amber-400/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}>
              <p className={`font-semibold ${marketType === "FUTURES" ? "text-amber-300" : "text-slate-300"}`}>Futures (USDT-M)</p>
              <p className="mt-1 text-xs text-slate-500">BUY (long) va SELL (short) ikkalasi ham bajariladi. Past leverage, TP/SL birja tomonida.</p>
            </button>
          </div>
          {marketType === "FUTURES" && (
            <p className="mt-2 text-xs text-amber-400/80">
              ⚠ API kalitda "Futures" ruxsati yoqilgan bo'lishi shart. Pozitsiya o'lchamini risk-menejer boshqaradi, leverage past (3x) tutiladi.
            </p>
          )}
        </div>
      )}

      {/* Mode */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Savdo rejimi</p>
        <div className="grid grid-cols-2 gap-3">
          {(["SIGNAL_ONLY", "AUTO_TRADE"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                mode === m
                  ? m === "AUTO_TRADE"
                    ? "border-emerald-400/40 bg-emerald-400/10"
                    : "border-sky-400/40 bg-sky-400/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <p className={`font-semibold ${
                mode === m
                  ? m === "AUTO_TRADE" ? "text-emerald-300" : "text-sky-300"
                  : "text-slate-300"
              }`}>
                {m === "AUTO_TRADE" ? "🤖 Avto savdo" : "📡 Signal rejimi"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {m === "AUTO_TRADE"
                  ? "AI signal kelganda avtomatik ravishda savdo ochadi va yopadi"
                  : "Signallarni ko'rasiz, savdoni o'zingiz amalga oshirasiz"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Risk */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Risk darajasi</p>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as const).map((lvl) => {
            const r = RISK_LABELS[lvl];
            return (
              <button key={lvl} type="button" onClick={() => setRiskLevel(lvl)}
                className={`rounded-xl border px-3 py-2.5 text-center text-sm transition ${
                  riskLevel === lvl
                    ? lvl === 1 ? "border-emerald-400/40 bg-emerald-400/10"
                      : lvl === 2 ? "border-amber-400/40 bg-amber-400/10"
                      : "border-rose-400/40 bg-rose-400/10"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                <p className={`font-semibold ${riskLevel === lvl ? r.color : "text-slate-300"}`}>
                  {r.label}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {lvl === 1 ? "Kichik lot, xavfsiz" : lvl === 2 ? "Muvozanatli" : "Katta lot, aggressiv"}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {submitting
          ? "Ulanmoqda... (birjaga so'rov yuborilmoqda)"
          : `${exchange} hisobni ulash`}
      </button>
    </form>
  );
}
