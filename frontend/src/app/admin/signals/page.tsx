"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface SignalDto {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  analysis: string;
  minPlan: string;
  status: "ACTIVE" | "TP_HIT" | "SL_HIT" | "CLOSED";
  resultPnlPct: number | null;
  createdAt: string;
}

export default function AdminSignalsPage() {
  const { token } = useAuth();
  const { t, locale } = useTranslation();
  const [signals, setSignals] = useState<SignalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!token) return;
    setLoading(true);
    apiRequest<{ signals: SignalDto[] }>("/admin/signals", { token })
      .then((data) => setSignals(data.signals))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function generate() {
    if (!token) return;
    setGenerating(true);
    setError(null);
    try {
      await apiRequest("/admin/signals/generate", { method: "POST", token });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    } finally {
      setGenerating(false);
    }
  }

  async function close(signal: SignalDto, status: "TP_HIT" | "SL_HIT" | "CLOSED") {
    if (!token) return;
    setBusyId(signal.id);
    setError(null);
    try {
      await apiRequest(`/admin/signals/${signal.id}/close`, { method: "PATCH", token, body: { status } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error.generic"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.signals.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {t("admin.signals.subtitle")}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {generating ? t("admin.signals.generating") : t("admin.signals.generate")}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">{t("admin.signals.colSymbol")}</th>
              <th className="px-4 py-3">{t("admin.signals.colDirection")}</th>
              <th className="px-4 py-3">{t("admin.signals.colLevels")}</th>
              <th className="px-4 py-3">{t("admin.signals.colConfidence")}</th>
              <th className="px-4 py-3">{t("admin.signals.colMinPlan")}</th>
              <th className="px-4 py-3">{t("admin.signals.colStatus")}</th>
              <th className="px-4 py-3">{t("admin.signals.colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {signals.map((s) => (
              <tr key={s.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium">{s.symbol}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      s.direction === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {s.direction === "BUY" ? t("dash.signals.buy") : t("dash.signals.sell")}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {s.entryPrice} / {s.takeProfit} / {s.stopLoss}
                </td>
                <td className="px-4 py-3">{s.confidence}%</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{t(`plan.${s.minPlan}` as TranslationKey)}</span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      s.status === "ACTIVE"
                        ? "bg-sky-500/15 text-sky-300"
                        : s.status === "TP_HIT"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : s.status === "SL_HIT"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-slate-500/15 text-slate-300"
                    }`}
                  >
                    {t(`dash.signals.status.${s.status}` as TranslationKey)}
                    {s.resultPnlPct != null ? ` (${s.resultPnlPct >= 0 ? "+" : ""}${s.resultPnlPct.toFixed(2)}%)` : ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {s.status === "ACTIVE" ? (
                    <div className="flex gap-1.5">
                      <button
                        disabled={busyId === s.id}
                        onClick={() => close(s, "TP_HIT")}
                        className="rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        {t("admin.signals.closeTp")}
                      </button>
                      <button
                        disabled={busyId === s.id}
                        onClick={() => close(s, "SL_HIT")}
                        className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
                      >
                        {t("admin.signals.closeSl")}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">{new Date(s.createdAt).toLocaleString(locale)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && signals.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">{t("admin.signals.empty")}</p>}
      </div>
    </div>
  );
}
