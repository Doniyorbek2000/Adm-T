"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface SignalDto {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL" | null;
  entryPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  confidence: number;
  analysis: string | null;
  minPlan: "FREE" | "PRO" | "ULTRA" | "VIP";
  status: "ACTIVE" | "TP_HIT" | "SL_HIT" | "CLOSED";
  resultPnlPct?: number | null;
  createdAt: string;
  closedAt?: string | null;
  locked: boolean;
  unlocksAt?: string;
  lockedReason?: string;
}

const STATUS_CLASSNAMES: Record<string, string> = {
  ACTIVE: "bg-sky-500/15 text-sky-300",
  TP_HIT: "bg-emerald-500/15 text-emerald-300",
  SL_HIT: "bg-rose-500/15 text-rose-300",
  CLOSED: "bg-slate-500/15 text-slate-300",
};

export default function SignalsPage() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const [signals, setSignals] = useState<SignalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    setLoading(true);
    apiRequest<{ signals: SignalDto[] }>("/signals", { token })
      .then((data) => setSignals(data.signals))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.signals.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("dash.signals.subtitle")}</p>
        </div>
        <button
          onClick={load}
          className="self-start rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
        >
          {t("common.refresh")}
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => (
          <SignalCard key={s.id} signal={s} />
        ))}
        {!loading && signals.length === 0 && (
          <p className="text-sm text-slate-500">{t("dash.signals.empty")}</p>
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: SignalDto }) {
  const { t, locale } = useTranslation();
  const statusClassName = STATUS_CLASSNAMES[signal.status];

  if (signal.locked) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="absolute inset-0 backdrop-blur-sm" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{signal.symbol}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-300">🔒 {t(`plan.${signal.minPlan}` as TranslationKey)}+ </span>
          </div>
          <p className="mt-3 text-sm text-slate-400">{t("dash.signals.lockedConfidence", { confidence: signal.confidence })}</p>
          <p className="mt-4 text-sm text-amber-300">{signal.lockedReason}</p>
          <Link href="/dashboard/subscription" className="mt-4 inline-flex text-sm font-semibold text-emerald-400 hover:underline">
            {t("dash.signals.unlockNow")}
          </Link>
        </div>
      </div>
    );
  }

  const isBuy = signal.direction === "BUY";
  const confidence = signal.confidence;
  const confidenceTier =
    confidence >= 85
      ? { label: t("dash.signals.tier.high"), className: "text-emerald-400", bar: "bg-emerald-400" }
      : confidence >= 70
      ? { label: t("dash.signals.tier.good"), className: "text-sky-400", bar: "bg-sky-400" }
      : { label: t("dash.signals.tier.medium"), className: "text-amber-400", bar: "bg-amber-400" };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{signal.symbol}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClassName}`}>{t(`dash.signals.status.${signal.status}` as TranslationKey)}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold ${
            isBuy ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {isBuy ? t("dash.signals.buy") : t("dash.signals.sell")}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">{t("dash.signals.confidenceLabel")}</span>
          <span className={`font-bold ${confidenceTier.className}`}>{confidence}% — {confidenceTier.label}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div className={`h-full rounded-full ${confidenceTier.bar}`} style={{ width: `${confidence}%` }} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <PriceBox label={t("dash.signals.entryPrice")} value={signal.entryPrice} />
        <PriceBox label={t("dash.signals.takeProfit")} value={signal.takeProfit} positive />
        <PriceBox label={t("dash.signals.stopLoss")} value={signal.stopLoss} negative />
      </div>

      {signal.status === "ACTIVE" && signal.entryPrice != null && (
        <p className="mt-3 rounded-lg bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-slate-300">
          {t("dash.signals.adviceIntro")} {signal.entryPrice}{" "}
          <span className={isBuy ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>
            {isBuy ? t("dash.signals.adviceOpenBuy") : t("dash.signals.adviceOpenSell")}
          </span>
          , <span className="font-semibold text-emerald-300">{signal.takeProfit}</span> {t("dash.signals.adviceTp")}{" "}
          {t("dash.signals.adviceSl")} <span className="font-semibold text-rose-300">{signal.stopLoss}</span> {t("dash.signals.adviceSlSuffix")}{" "}
          {t("dash.signals.adviceConfidence", { confidence })}
        </p>
      )}

      {signal.analysis && <p className="mt-4 text-sm leading-relaxed text-slate-400">🤖 {signal.analysis}</p>}

      {signal.resultPnlPct != null && (
        <p className={`mt-3 text-sm font-semibold ${signal.resultPnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {t("dash.signals.resultLabel")} {signal.resultPnlPct >= 0 ? "+" : ""}
          {signal.resultPnlPct.toFixed(2)}% ({signal.resultPnlPct >= 0 ? t("dash.signals.resultTp") : t("dash.signals.resultSl")})
        </p>
      )}

      <p className="mt-4 text-xs text-slate-500">{new Date(signal.createdAt).toLocaleString(locale)}</p>
    </div>
  );
}

function PriceBox({ label, value, positive, negative }: { label: string; value: number | null; positive?: boolean; negative?: boolean }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-2.5">
      <p className="text-slate-400">{label}</p>
      <p className={`mt-1 font-semibold ${positive ? "text-emerald-300" : negative ? "text-rose-300" : "text-white"}`}>
        {value != null ? value : "—"}
      </p>
    </div>
  );
}
