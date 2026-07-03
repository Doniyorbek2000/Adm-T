"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface AccountDto {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  server?: string | null;
  isConnected: boolean;
  mode: "SIGNAL_ONLY" | "AUTO_TRADE";
  riskLevel: number;
  balanceUsd: number;
  createdAt: string;
}

export default function AccountsPage() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

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
      setInfo(t("dash.accounts.demoSuccess"));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    }
  }

  async function handleUpdateMode(account: AccountDto, mode: "SIGNAL_ONLY" | "AUTO_TRADE") {
    if (!token) return;
    setError(null);
    try {
      await apiRequest(`/broker-accounts/${account.id}`, { method: "PATCH", token, body: { mode } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    }
  }

  async function handleDelete(account: AccountDto) {
    if (!token) return;
    if (!confirm(t("dash.accounts.confirmDisconnect", { label: account.label }))) return;
    try {
      await apiRequest(`/broker-accounts/${account.id}`, { method: "DELETE", token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    }
  }

  async function handleSync(account: AccountDto) {
    if (!token || syncingId) return;
    setSyncingId(account.id);
    setError(null);
    try {
      const res = await apiRequest<{ balanceUsd: number; synced: boolean; message?: string }>(
        `/broker-accounts/${account.id}/sync`,
        { method: "POST", token }
      );
      if (res.synced) {
        setInfo(`${account.label}: balans yangilandi — $${res.balanceUsd.toLocaleString()}`);
      } else {
        setInfo(res.message ?? "Balans yangilanmadi");
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.accounts.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("dash.accounts.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDemo}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold hover:bg-white/10"
          >
            {t("dash.accounts.openDemo")}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            {t("dash.accounts.connectAccount")}
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
            setInfo(t("dash.accounts.connectSuccess"));
            load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts.map((acc) => (
          <div key={acc.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{acc.label}</p>
                <p className="text-xs text-slate-400">
                  {acc.exchange} • {acc.apiKeyMasked}
                  {acc.exchange === "MT5" && acc.server ? ` • ${acc.server}` : ""}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${acc.isConnected ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>
                {acc.isConnected ? t("dash.accounts.connected") : t("dash.accounts.disconnected")}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-xs text-slate-400">{t("dash.accounts.balance")}</p>
                <p className="mt-0.5 font-semibold">${acc.balanceUsd.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <p className="text-xs text-slate-400">{t("dash.accounts.riskLevel")}</p>
                <p className="mt-0.5 font-semibold">{t(`risk.${acc.riskLevel}` as TranslationKey)}</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs text-slate-400">{t("dash.accounts.tradeMode")}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateMode(acc, "SIGNAL_ONLY")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    acc.mode === "SIGNAL_ONLY" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {t("dash.accounts.signalOnly")}
                </button>
                <button
                  onClick={() => handleUpdateMode(acc, "AUTO_TRADE")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    acc.mode === "AUTO_TRADE" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {t("dash.accounts.autoTrade")}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {acc.mode === "AUTO_TRADE" ? t("dash.accounts.autoTradeDescOn") : t("dash.accounts.autoTradeDescOff")}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              {acc.exchange !== "Demo" && (
                <button
                  onClick={() => handleSync(acc)}
                  disabled={syncingId === acc.id}
                  className="text-xs font-semibold text-sky-400 hover:underline disabled:opacity-50"
                >
                  {syncingId === acc.id ? "Yangilanmoqda..." : "↻ Balansni yangilash"}
                </button>
              )}
              <button onClick={() => handleDelete(acc)} className="ml-auto text-xs font-semibold text-rose-400 hover:underline">
                {t("dash.accounts.disconnectAction")}
              </button>
            </div>
          </div>
        ))}

        {!loading && accounts.length === 0 && (
          <div className="md:col-span-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <p className="text-lg font-semibold">{t("dash.accounts.emptyTitle")}</p>
            <p className="mt-2 text-sm text-slate-400">{t("dash.accounts.emptyText")}</p>
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
  const { t } = useTranslation();
  const [exchange, setExchange] = useState("Binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [server, setServer] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const isMt5 = exchange === "MT5";
  const requiresPassphrase = exchange === "OKX" || exchange === "KuCoin";
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
        body: {
          exchange,
          label: label || undefined,
          apiKey,
          apiSecret,
          passphrase: requiresPassphrase ? passphrase : undefined,
          server: isMt5 ? server : undefined,
          mode,
          riskLevel,
        },
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t("common.error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-lg font-semibold">{t("dash.accounts.formTitle")}</h2>
      <p className="text-xs text-slate-500">{t("dash.accounts.formNotice")}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.exchange")}</label>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          >
            {["Binance", "Bybit", "OKX", "KuCoin", "BingX", "MT5"].map((ex) => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
            <option value="Boshqa">{t("dash.accounts.exchangeOther")}</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.accountLabel")}</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("dash.accounts.accountLabelPlaceholder")}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t(isMt5 ? "dash.accounts.mt5Login" : "dash.accounts.apiKey")}
          </label>
          <input
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {t(isMt5 ? "dash.accounts.mt5Password" : "dash.accounts.apiSecret")}
          </label>
          <input
            required
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
          />
        </div>
        {isMt5 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.mt5Server")}</label>
            <input
              required
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder={t("dash.accounts.mt5ServerPlaceholder")}
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
            />
          </div>
        )}
        {requiresPassphrase && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.passphrase")}</label>
            <input
              required
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("dash.accounts.passphrasePlaceholder")}
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
            />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.modeLabel")}</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode("SIGNAL_ONLY")}
            className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition ${
              mode === "SIGNAL_ONLY" ? "border-sky-400/50 bg-sky-400/10" : "border-white/10 bg-white/5"
            }`}
          >
            <p className="font-semibold">{t("dash.accounts.modeSignalTitle")}</p>
            <p className="mt-1 text-xs text-slate-400">{t("dash.accounts.modeSignalText")}</p>
          </button>
          <button
            type="button"
            onClick={() => autoTradeAllowed && setMode("AUTO_TRADE")}
            className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition ${
              mode === "AUTO_TRADE" ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10 bg-white/5"
            } ${!autoTradeAllowed ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <p className="font-semibold">{t("dash.accounts.modeAutoTitle")}</p>
            <p className="mt-1 text-xs text-slate-400">
              {autoTradeAllowed ? t("dash.accounts.modeAutoTextOn") : t("dash.accounts.modeAutoTextOff")}
            </p>
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("dash.accounts.riskLabel")}</label>
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
              {t(`risk.${lvl}` as TranslationKey)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {submitting ? t("dash.accounts.connecting") : t("dash.accounts.submit")}
      </button>
    </form>
  );
}
