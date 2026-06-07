"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface AccountDto {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  isConnected: boolean;
  mode: "SIGNAL_ONLY" | "AUTO_TRADE";
  riskLevel: number;
  balanceUsd: number;
  createdAt: string;
}

const RISK_LABELS: Record<number, string> = { 1: "Past", 2: "O'rta", 3: "Yuqori" };

export default function AccountsPage() {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    if (!token) return;
    setLoading(true);
    apiRequest<{ accounts: AccountDto[] }>("/broker-accounts", { token })
      .then((data) => setAccounts(data.accounts))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function handleDemo() {
    if (!token) return;
    setError(null);
    setInfo(null);
    try {
      await apiRequest("/broker-accounts/demo", { method: "POST", token });
      setInfo("Bepul Demo hisob ($10,000 virtual balans) muvaffaqiyatli ochildi.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    }
  }

  async function handleUpdateMode(account: AccountDto, mode: "SIGNAL_ONLY" | "AUTO_TRADE") {
    if (!token) return;
    setError(null);
    try {
      await apiRequest(`/broker-accounts/${account.id}`, { method: "PATCH", token, body: { mode } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    }
  }

  async function handleDelete(account: AccountDto) {
    if (!token) return;
    if (!confirm(`"${account.label}" hisobini uzishni tasdiqlaysizmi?`)) return;
    try {
      await apiRequest(`/broker-accounts/${account.id}`, { method: "DELETE", token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Broker hisoblarim</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real birja hisobingizni ulang yoki bepul Demo (virtual) hisob bilan AI'ni xavfsiz tarzda kuzating.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDemo}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold hover:bg-white/10"
          >
            🧪 Demo hisob ochish
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            + Hisob ulash
          </button>
        </div>
      </div>

      {info && <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{info}</p>}
      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

      {showForm && (
        <ConnectAccountForm
          token={token}
          userPlan={user?.plan ?? "FREE"}
          onSuccess={() => {
            setShowForm(false);
            setInfo("Hisob muvaffaqiyatli ulandi.");
            load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts.map((acc) => (
          <div key={acc.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{acc.label}</p>
                <p className="text-xs text-slate-400">{acc.exchange} • {acc.apiKeyMasked}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${acc.isConnected ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>
                {acc.isConnected ? "Ulangan" : "Uzilgan"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-xs text-slate-400">Balans</p>
                <p className="mt-0.5 font-semibold">${acc.balanceUsd.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-xs text-slate-400">Risk darajasi</p>
                <p className="mt-0.5 font-semibold">{RISK_LABELS[acc.riskLevel]}</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs text-slate-400">Savdo rejimi</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateMode(acc, "SIGNAL_ONLY")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    acc.mode === "SIGNAL_ONLY" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Faqat signal
                </button>
                <button
                  onClick={() => handleUpdateMode(acc, "AUTO_TRADE")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    acc.mode === "AUTO_TRADE" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  🤖 To'liq avto-treding
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {acc.mode === "AUTO_TRADE"
                  ? "AI ushbu hisob uchun savdoni to'liq mustaqil ochadi va yopadi."
                  : "Siz faqat AI signallarini olasiz, savdoni o'zingiz amalga oshirasiz."}
              </p>
            </div>

            <button onClick={() => handleDelete(acc)} className="mt-4 text-xs font-semibold text-rose-400 hover:underline">
              Hisobni uzish
            </button>
          </div>
        ))}

        {!loading && accounts.length === 0 && (
          <div className="md:col-span-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <p className="text-lg font-semibold">Hali hisob ulanmagan</p>
            <p className="mt-2 text-sm text-slate-400">
              Hech qanday hisob ulamasangiz ham muammo emas — "Demo hisob ochish" tugmasi orqali $10,000 virtual balans bilan
              AI ishlashini darhol kuzata olasiz.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectAccountForm({
  token,
  userPlan,
  onSuccess,
  onError,
}: {
  token: string | null;
  userPlan: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [exchange, setExchange] = useState("Binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [mode, setMode] = useState<"SIGNAL_ONLY" | "AUTO_TRADE">("SIGNAL_ONLY");
  const [riskLevel, setRiskLevel] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  const autoTradeAllowed = userPlan === "ULTRA" || userPlan === "VIP";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      await apiRequest("/broker-accounts", {
        method: "POST",
        token,
        body: { exchange, label: label || undefined, apiKey, apiSecret, mode, riskLevel },
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Hisobni ulashda xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-lg font-semibold">Yangi broker hisobini ulash</h2>
      <p className="text-xs text-slate-500">
        API kalitlaringiz shifrlangan holda saqlanadi. Faqat savdo huquqiga ega (pul yechib olish huquqisiz) API
        kalit yaratishni tavsiya qilamiz.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Birja</label>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          >
            {["Binance", "Bybit", "OKX", "KuCoin", "Boshqa"].map((ex) => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Hisob nomi (ixtiyoriy)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Masalan: Asosiy hisobim"
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">API Key</label>
          <input
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">API Secret</label>
          <input
            required
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Savdo rejimi</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode("SIGNAL_ONLY")}
            className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition ${
              mode === "SIGNAL_ONLY" ? "border-sky-400/50 bg-sky-400/10" : "border-white/10 bg-white/5"
            }`}
          >
            <p className="font-semibold">📡 Faqat signal</p>
            <p className="mt-1 text-xs text-slate-400">AI tahlil va signal beradi, savdoni o'zingiz qilasiz.</p>
          </button>
          <button
            type="button"
            onClick={() => autoTradeAllowed && setMode("AUTO_TRADE")}
            className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition ${
              mode === "AUTO_TRADE" ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10 bg-white/5"
            } ${!autoTradeAllowed ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <p className="font-semibold">🤖 To'liq avto-treding</p>
            <p className="mt-1 text-xs text-slate-400">
              {autoTradeAllowed ? "AI siz uchun savdoni to'liq mustaqil bajaradi." : "Faqat ULTRA va VIP tariflarida mavjud."}
            </p>
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Tavakkal (risk) darajasi</label>
        <div className="flex gap-2">
          {[1, 2, 3].map((lvl) => (
            <button
              type="button"
              key={lvl}
              onClick={() => setRiskLevel(lvl)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                riskLevel === lvl ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {RISK_LABELS[lvl]}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {submitting ? "Ulanmoqda..." : "Hisobni ulash"}
      </button>
    </form>
  );
}
