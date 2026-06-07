"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

interface PlanDto {
  id: string;
  type: string;
  name: string;
  priceMonthlyUsd: number;
  description: string;
  features: string[];
  maxBrokerAccounts: number;
  autoTradeAllowed: boolean;
  signalDelayMin: number;
  isActive: boolean;
}

export default function AdminPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    if (!token) return;
    setLoading(true);
    apiRequest<{ plans: PlanDto[] }>("/admin/plans", { token })
      .then((data) => setPlans(data.plans))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tarif rejalarini boshqarish</h1>
        <p className="mt-1 text-sm text-slate-400">
          Narxlar, kechikish va imkoniyatlarni o'zgartiring — o'zgarishlar darhol foydalanuvchilar uchun qo'llaniladi.
        </p>
      </div>

      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {plans.map((plan) => (
          <PlanEditor
            key={plan.id}
            plan={plan}
            token={token}
            onSaved={() => {
              setMessage(`"${plan.name}" tarifi muvaffaqiyatli yangilandi.`);
              load();
            }}
            onError={(msg) => setError(msg)}
          />
        ))}
      </div>
    </div>
  );
}

function PlanEditor({
  plan,
  token,
  onSaved,
  onError,
}: {
  plan: PlanDto;
  token: string | null;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [price, setPrice] = useState(plan.priceMonthlyUsd);
  const [delay, setDelay] = useState(plan.signalDelayMin);
  const [maxAccounts, setMaxAccounts] = useState(plan.maxBrokerAccounts);
  const [autoTrade, setAutoTrade] = useState(plan.autoTradeAllowed);
  const [features, setFeatures] = useState(plan.features.join("\n"));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await apiRequest(`/admin/plans/${plan.id}`, {
        method: "PATCH",
        token,
        body: {
          priceMonthlyUsd: Number(price),
          signalDelayMin: Number(delay),
          maxBrokerAccounts: Number(maxAccounts),
          autoTradeAllowed: autoTrade,
          features: features.split("\n").map((f) => f.trim()).filter(Boolean),
        },
      });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Saqlashda xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{plan.name}</h2>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{plan.type}</span>
      </div>
      <p className="mt-1 text-sm text-slate-400">{plan.description}</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label="Oylik narx ($)">
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </Field>
        <Field label="Signal kechikishi (daqiqa)">
          <input
            type="number"
            min={0}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </Field>
        <Field label="Maks. broker hisoblari">
          <input
            type="number"
            min={1}
            value={maxAccounts}
            onChange={(e) => setMaxAccounts(Number(e.target.value))}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </Field>
        <Field label="To'liq avto-treding">
          <button
            type="button"
            onClick={() => setAutoTrade((v) => !v)}
            className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
              autoTrade ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40" : "bg-white/5 text-slate-300"
            }`}
          >
            {autoTrade ? "Yoqilgan" : "O'chirilgan"}
          </button>
        </Field>
      </div>

      <Field label="Imkoniyatlar (har bir qator alohida xususiyat)">
        <textarea
          value={features}
          onChange={(e) => setFeatures(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
      </Field>

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {saving ? "Saqlanmoqda..." : "Saqlash"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1.5 block font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}
