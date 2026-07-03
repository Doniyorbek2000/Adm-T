"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface StatsDto {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  planCounts: Record<string, number>;
  totalSignals: number;
  activeSignals: number;
  totalTrades: number;
  openTrades: number;
  totalRevenueUsd: number;
  recentUsers: { id: string; fullName: string; email: string; plan: string; createdAt: string }[];
}

interface EngineDto {
  paused: boolean;
  exchangeMode: string;
}

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [engine, setEngine] = useState<EngineDto | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiRequest<StatsDto>("/admin/stats", { token }).then(setStats);
    apiRequest<EngineDto>("/admin/engine", { token }).then(setEngine).catch(() => {});
  }, [token]);

  const toggleEngine = async () => {
    if (!token || !engine || engineBusy) return;
    setEngineBusy(true);
    try {
      const updated = await apiRequest<{ paused: boolean }>("/admin/engine", {
        token,
        method: "PATCH",
        body: { paused: !engine.paused },
      });
      setEngine({ ...engine, paused: updated.paused });
    } finally {
      setEngineBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("admin.overview.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("admin.overview.subtitle")}</p>
      </div>

      {engine && (
        <div
          className={`flex flex-col gap-4 rounded-2xl border p-6 sm:flex-row sm:items-center sm:justify-between ${
            engine.paused ? "border-rose-500/40 bg-rose-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.04]"
          }`}
        >
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{t("admin.engine.title")}</h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  engine.paused ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
                }`}
              >
                {engine.paused ? t("admin.engine.statusPaused") : t("admin.engine.statusRunning")}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300">
                {t("admin.engine.mode")}: {engine.exchangeMode.toUpperCase()}
              </span>
            </div>
            <p className="mt-2 max-w-xl text-sm text-slate-400">{t("admin.engine.desc")}</p>
          </div>
          <button
            onClick={toggleEngine}
            disabled={engineBusy}
            className={`shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
              engine.paused
                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                : "bg-rose-500 text-white hover:bg-rose-400"
            }`}
          >
            {engine.paused ? t("admin.engine.resumeBtn") : t("admin.engine.pauseBtn")}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("admin.overview.totalUsers")} value={stats?.totalUsers} accent="emerald" />
        <Stat label={t("admin.overview.activeUsers")} value={stats?.activeUsers} accent="sky" />
        <Stat label={t("admin.overview.blockedUsers")} value={stats?.blockedUsers} accent="rose" />
        <Stat label={t("admin.overview.totalRevenue")} value={stats ? `$${stats.totalRevenueUsd.toLocaleString()}` : undefined} accent="amber" />
        <Stat label={t("admin.overview.totalSignals")} value={stats?.totalSignals} accent="violet" />
        <Stat label={t("admin.overview.activeSignals")} value={stats?.activeSignals} accent="sky" />
        <Stat label={t("admin.overview.totalTrades")} value={stats?.totalTrades} accent="emerald" />
        <Stat label={t("admin.overview.openTrades")} value={stats?.openTrades} accent="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">{t("admin.overview.byPlanTitle")}</h2>
          <div className="mt-4 space-y-3">
            {stats &&
              Object.entries(stats.planCounts).map(([plan, count]) => (
                <div key={plan} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5 text-sm">
                  <span className="font-medium">{t(`plan.${plan}` as TranslationKey)}</span>
                  <span className="text-slate-300">{count} {t("admin.overview.usersSuffix")}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">{t("admin.overview.recentTitle")}</h2>
          <div className="mt-4 space-y-3">
            {stats?.recentUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{u.fullName}</p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </div>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{t(`plan.${u.plan}` as TranslationKey)}</span>
              </div>
            ))}
            {stats && stats.recentUsers.length === 0 && <p className="text-sm text-slate-500">{t("admin.overview.noUsers")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value?: number | string; accent: "emerald" | "sky" | "rose" | "amber" | "violet" }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    sky: "text-sky-400",
    rose: "text-rose-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${colors[accent]}`}>{value ?? "…"}</p>
    </div>
  );
}
