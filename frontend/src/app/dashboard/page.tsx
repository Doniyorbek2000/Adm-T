"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface Summary {
  totalBalance: number;
  realizedPnl: number;
  openPositions: number;
  closedTrades: number;
  winRate: number;
  accountsCount: number;
}

interface SignalStats {
  total: number;
  active: number;
  closed: number;
  winRate: number;
}

export default function DashboardOverviewPage() {
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signalStats, setSignalStats] = useState<SignalStats | null>(null);
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiRequest<{ totalBalance: number; realizedPnl: number; openPositions: number; closedTrades: number; winRate: number; accountsCount: number }>(
        "/trades/summary",
        { token }
      ),
      apiRequest<{ total: number; active: number; closed: number; winRate: number }>("/signals/stats", { token }),
      apiRequest<{ accounts: unknown[] }>("/broker-accounts", { token }),
    ])
      .then(([summaryData, statsData, accountsData]) => {
        if (cancelled) return;
        setSummary(summaryData);
        setSignalStats(statsData);
        setHasAccount(accountsData.accounts.length > 0);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!user) return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("dash.overview.welcome", { name: user.fullName.split(" ")[0] })}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t("dash.overview.planLine", { plan: t(`plan.${user.plan}` as TranslationKey) })}
        </p>
      </div>

      {hasAccount === false && (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-amber-300">{t("dash.overview.noAccountTitle")}</p>
            <p className="mt-1 text-sm text-amber-200/80">{t("dash.overview.noAccountText")}</p>
          </div>
          <Link
            href="/dashboard/accounts"
            className="shrink-0 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300"
          >
            {t("dash.overview.connectAccount")}
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dash.overview.totalBalance")} value={summary ? `$${summary.totalBalance.toLocaleString()}` : "—"} loading={loading} accent="emerald" />
        <StatCard
          label={t("dash.overview.realizedPnl")}
          value={summary ? `${summary.realizedPnl >= 0 ? "+" : ""}$${summary.realizedPnl.toLocaleString()}` : "—"}
          loading={loading}
          accent={summary && summary.realizedPnl < 0 ? "rose" : "emerald"}
        />
        <StatCard label={t("dash.overview.openPositions")} value={summary ? String(summary.openPositions) : "—"} loading={loading} accent="sky" />
        <StatCard label={t("dash.overview.winRate")} value={summary ? `${summary.winRate}%` : "—"} loading={loading} accent="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">{t("dash.overview.aiStatsTitle")}</h2>
          <p className="mt-1 text-sm text-slate-400">{t("dash.overview.aiStatsSubtitle")}</p>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniStat label={t("dash.overview.totalSignals")} value={signalStats?.total ?? "—"} />
            <MiniStat label={t("dash.overview.activeSignalsLabel")} value={signalStats?.active ?? "—"} />
            <MiniStat label={t("dash.overview.closedLabel")} value={signalStats?.closed ?? "—"} />
            <MiniStat label={t("dash.overview.aiWinRate")} value={signalStats ? `${signalStats.winRate}%` : "—"} />
          </div>
          <Link href="/dashboard/signals" className="mt-6 inline-flex text-sm font-semibold text-emerald-400 hover:underline">
            {t("dash.overview.viewAllSignals")}
          </Link>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">{t("dash.overview.quickActions")}</h2>
          <div className="mt-4 space-y-3">
            <Link
              href="/dashboard/accounts"
              className="block rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10"
            >
              {t("dash.overview.actionConnect")}
            </Link>
            <Link
              href="/dashboard/signals"
              className="block rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10"
            >
              {t("dash.overview.viewAllSignals")}
            </Link>
            <Link
              href="/dashboard/trades"
              className="block rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10"
            >
              {t("dash.overview.actionHistory")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string;
  loading: boolean;
  accent: "emerald" | "rose" | "sky" | "violet";
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    rose: "text-rose-400",
    sky: "text-sky-400",
    violet: "text-violet-400",
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${colors[accent]}`}>{loading ? "…" : value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/5 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
