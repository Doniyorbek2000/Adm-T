"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";

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

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<StatsDto | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest<StatsDto>("/admin/stats", { token }).then(setStats);
  }, [token]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin boshqaruv paneli</h1>
        <p className="mt-1 text-sm text-slate-400">ADM Trading platformasining umumiy holati va statistikasi.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jami foydalanuvchilar" value={stats?.totalUsers} accent="emerald" />
        <Stat label="Faol foydalanuvchilar" value={stats?.activeUsers} accent="sky" />
        <Stat label="Bloklangan foydalanuvchilar" value={stats?.blockedUsers} accent="rose" />
        <Stat label="Umumiy daromad" value={stats ? `$${stats.totalRevenueUsd.toLocaleString()}` : undefined} accent="amber" />
        <Stat label="Jami AI signallari" value={stats?.totalSignals} accent="violet" />
        <Stat label="Faol signallar" value={stats?.activeSignals} accent="sky" />
        <Stat label="Jami savdolar" value={stats?.totalTrades} accent="emerald" />
        <Stat label="Ochiq pozitsiyalar" value={stats?.openTrades} accent="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">Tariflar bo'yicha foydalanuvchilar</h2>
          <div className="mt-4 space-y-3">
            {stats &&
              Object.entries(stats.planCounts).map(([plan, count]) => (
                <div key={plan} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5 text-sm">
                  <span className="font-medium">{plan}</span>
                  <span className="text-slate-300">{count} foydalanuvchi</span>
                </div>
              ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold">So'nggi ro'yxatdan o'tganlar</h2>
          <div className="mt-4 space-y-3">
            {stats?.recentUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{u.fullName}</p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </div>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{u.plan}</span>
              </div>
            ))}
            {stats && stats.recentUsers.length === 0 && <p className="text-sm text-slate-500">Hozircha foydalanuvchilar yo'q.</p>}
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
