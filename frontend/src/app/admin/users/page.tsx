"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface UserDto {
  id: string;
  fullName: string;
  email: string;
  plan: "FREE" | "PRO" | "ULTRA" | "VIP";
  planExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { brokerAccounts: number; trades: number };
}

const PLANS = ["FREE", "PRO", "ULTRA", "VIP"] as const;

export default function AdminUsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!token) return;
    setLoading(true);
    const qs = search ? `?search=${encodeURIComponent(search)}` : "";
    apiRequest<{ users: UserDto[] }>(`/admin/users${qs}`, { token })
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleActive(user: UserDto) {
    if (!token) return;
    setBusyId(user.id);
    setError(null);
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: "PATCH", token, body: { isActive: !user.isActive } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setBusyId(null);
    }
  }

  async function changePlan(user: UserDto, plan: string) {
    if (!token || plan === user.plan) return;
    setBusyId(user.id);
    setError(null);
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: "PATCH", token, body: { plan } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Foydalanuvchilar</h1>
          <p className="mt-1 text-sm text-slate-400">Tariflarni o'zgartiring, hisoblarni bloklang yoki faollashtiring.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="flex gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism yoki email bo'yicha qidirish..."
            className="rounded-lg border border-white/10 bg-slate-900 px-4 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <button type="submit" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
            Qidirish
          </button>
        </form>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Foydalanuvchi</th>
              <th className="px-4 py-3">Tarif</th>
              <th className="px-4 py-3">Hisoblar</th>
              <th className="px-4 py-3">Savdolar</th>
              <th className="px-4 py-3">Holat</th>
              <th className="px-4 py-3">Ro'yxatdan o'tgan</th>
              <th className="px-4 py-3">Amallar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <p className="font-medium">{u.fullName}</p>
                  <p className="text-xs text-slate-400">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.plan}
                    disabled={busyId === u.id}
                    onChange={(e) => changePlan(u, e.target.value)}
                    className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-400"
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-400">{u._count.brokerAccounts}</td>
                <td className="px-4 py-3 text-slate-400">{u._count.trades}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      u.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {u.isActive ? "Faol" : "Bloklangan"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString("uz-UZ")}</td>
                <td className="px-4 py-3">
                  <button
                    disabled={busyId === u.id}
                    onClick={() => toggleActive(u)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      u.isActive ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    }`}
                  >
                    {u.isActive ? "Bloklash" : "Faollashtirish"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && users.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">Foydalanuvchilar topilmadi.</p>}
      </div>
    </div>
  );
}
