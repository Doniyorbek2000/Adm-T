"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface PlanDto {
  id: string;
  type: "FREE" | "PRO" | "ULTRA" | "VIP";
  name: string;
  priceMonthlyUsd: number;
  description: string;
  features: string[];
}

interface PaymentDto {
  id: string;
  plan: string;
  amountUsd: number;
  status: string;
  method: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

const PLAN_STYLES: Record<string, string> = {
  FREE: "border-white/10 bg-white/[0.03]",
  PRO: "border-sky-400/30 bg-sky-400/[0.06]",
  ULTRA: "border-emerald-400/40 bg-emerald-400/[0.07]",
  VIP: "border-amber-400/40 bg-amber-400/[0.07]",
};

export default function SubscriptionPage() {
  const { token, user, refreshUser } = useAuth();
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    setLoading(true);
    Promise.all([
      apiRequest<{ plans: PlanDto[] }>("/plans", { token }),
      apiRequest<{ payments: PaymentDto[] }>("/payments", { token }),
    ])
      .then(([planData, paymentData]) => {
        setPlans(planData.plans);
        setPayments(paymentData.payments);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function handleSubscribe(plan: PlanDto) {
    if (!token || plan.type === "FREE") return;
    setError(null);
    setMessage(null);
    setPendingPlan(plan.type);
    try {
      const res = await apiRequest<{ message: string }>("/payments/subscribe", {
        method: "POST",
        token,
        body: { plan: plan.type, method: "card" },
      });
      setMessage(res.message);
      await refreshUser();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Obunani amalga oshirishda xatolik yuz berdi");
    } finally {
      setPendingPlan(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Tarif va obuna</h1>
        <p className="mt-1 text-sm text-slate-400">
          Joriy tarifingiz: <span className="font-semibold text-emerald-400">{user?.plan}</span>
          {user?.planExpiresAt && (
            <> — amal qilish muddati: {new Date(user.planExpiresAt).toLocaleDateString("uz-UZ")}</>
          )}
        </p>
      </div>

      {message && <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}

      <div className="grid gap-5 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = user?.plan === plan.type;
          return (
            <div key={plan.id} className={`flex flex-col rounded-2xl border p-6 ${PLAN_STYLES[plan.type]}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{plan.name}</h3>
                {isCurrent && <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">Joriy tarif</span>}
              </div>
              <p className="mt-1 text-sm text-slate-400">{plan.description}</p>
              <p className="mt-4 text-2xl font-bold">
                ${plan.priceMonthlyUsd}
                <span className="text-sm font-normal text-slate-400"> / oyiga</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-300">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                disabled={isCurrent || plan.type === "FREE" || pendingPlan === plan.type}
                onClick={() => handleSubscribe(plan)}
                className="mt-6 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
              >
                {isCurrent ? "Joriy tarif" : pendingPlan === plan.type ? "Faollashtirilmoqda..." : plan.type === "FREE" ? "Bepul tarif" : "Faollashtirish"}
              </button>
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold">To'lovlar tarixi</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Tarif</th>
                <th className="px-4 py-3">Summa</th>
                <th className="px-4 py-3">Usul</th>
                <th className="px-4 py-3">Holat</th>
                <th className="px-4 py-3">Davr</th>
                <th className="px-4 py-3">Sana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.plan}</td>
                  <td className="px-4 py-3">${p.amountUsd}</td>
                  <td className="px-4 py-3 text-slate-400">{p.method}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(p.periodStart).toLocaleDateString("uz-UZ")} — {new Date(p.periodEnd).toLocaleDateString("uz-UZ")}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.createdAt).toLocaleString("uz-UZ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && payments.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">Hozircha to'lovlar mavjud emas.</p>
          )}
        </div>
      </div>
    </div>
  );
}
