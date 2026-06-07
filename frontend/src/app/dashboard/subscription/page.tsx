"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

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

type PaymentMethodCode = "HUMO" | "UZCARD" | "VISA" | "MASTERCARD" | "CLICK";

const CARD_METHODS: PaymentMethodCode[] = ["HUMO", "UZCARD", "VISA", "MASTERCARD"];
const METHOD_ICONS: Record<PaymentMethodCode, string> = {
  HUMO: "🟢",
  UZCARD: "🔵",
  VISA: "💳",
  MASTERCARD: "💳",
  CLICK: "⚡",
};

function PaymentModal({
  plan,
  onClose,
  onSubmit,
  submitting,
}: {
  plan: PlanDto;
  onClose: () => void;
  onSubmit: (method: PaymentMethodCode, details: { cardNumber?: string; phoneNumber?: string }) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethodCode | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  function handleConfirm() {
    if (!method) return;
    if (method === "CLICK") {
      onSubmit(method, { phoneNumber: phoneNumber.trim() || undefined });
    } else {
      onSubmit(method, { cardNumber: cardNumber.replace(/\s+/g, "") || undefined });
    }
  }

  const isCard = method && CARD_METHODS.includes(method);
  const canConfirm =
    !!method &&
    (method === "CLICK"
      ? phoneNumber.trim().length >= 9
      : cardNumber.replace(/\s+/g, "").length >= 12 && expiry.trim().length >= 4 && cvv.trim().length >= 3 && cardHolder.trim().length >= 2);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">{t("dash.subscription.payModalTitle")}</h3>
            <p className="mt-1 text-sm text-slate-400">{t("dash.subscription.payModalSubtitle")}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-white/5 hover:text-white">
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <span className="text-slate-400">
            {t("dash.subscription.payPlanLabel")}: <span className="font-semibold text-white">{plan.name}</span>
          </span>
          <span className="text-slate-400">
            {t("dash.subscription.payAmountLabel")}: <span className="font-semibold text-emerald-400">${plan.priceMonthlyUsd}</span>
          </span>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t("payment.selectMethod")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(["HUMO", "UZCARD", "VISA", "MASTERCARD", "CLICK"] as PaymentMethodCode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                  method === m
                    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5"
                }`}
              >
                <span>{METHOD_ICONS[m]}</span>
                <span>{t(`payment.method.${m}` as TranslationKey)}</span>
              </button>
            ))}
          </div>
        </div>

        {isCard && (
          <div className="mt-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">{t("payment.cardNumber")}</label>
              <input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="0000 0000 0000 0000"
                maxLength={23}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t("payment.expiry")}</label>
                <input
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="MM/YY"
                  maxLength={5}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t("payment.cvv")}</label>
                <input
                  value={cvv}
                  onChange={(e) => setCvv(e.target.value)}
                  placeholder="•••"
                  maxLength={4}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">{t("payment.cardHolder")}</label>
              <input
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                placeholder={t("payment.cardHolderPlaceholder")}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm uppercase outline-none focus:border-emerald-400/50"
              />
            </div>
          </div>
        )}

        {method === "CLICK" && (
          <div className="mt-5">
            <label className="mb-1 block text-xs text-slate-400">{t("payment.phoneNumber")}</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={t("payment.phoneNumberPlaceholder")}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/50"
            />
          </div>
        )}

        <button
          disabled={!canConfirm || submitting}
          onClick={handleConfirm}
          className="mt-6 w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
        >
          {submitting ? t("dash.subscription.payProcessing") : t("dash.subscription.payConfirm")}
        </button>
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const { token, user, refreshUser } = useAuth();
  const { t, locale } = useTranslation();
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalPlan, setModalPlan] = useState<PlanDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  async function handleSubscribe(method: PaymentMethodCode, details: { cardNumber?: string; phoneNumber?: string }) {
    if (!token || !modalPlan) return;
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>("/payments/subscribe", {
        method: "POST",
        token,
        body: { plan: modalPlan.type, method, ...details },
      });
      setMessage(t("dash.subscription.paySuccess", { plan: modalPlan.name, method: t(`payment.method.${method}` as TranslationKey) }));
      void res;
      setModalPlan(null);
      await refreshUser();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("dash.subscription.payError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("dash.subscription.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t("dash.subscription.currentPlan")} <span className="font-semibold text-emerald-400">{t(`plan.${user?.plan}` as TranslationKey)}</span>
          {user?.planExpiresAt && (
            <> — {t("dash.subscription.expiresOn", { date: new Date(user.planExpiresAt).toLocaleDateString(locale) })}</>
          )}
        </p>
      </div>

      {message && <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="grid gap-5 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = user?.plan === plan.type;
          return (
            <div key={plan.id} className={`flex flex-col rounded-2xl border p-6 ${PLAN_STYLES[plan.type]}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{plan.name}</h3>
                {isCurrent && <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{t("dash.subscription.currentBadge")}</span>}
              </div>
              <p className="mt-1 text-sm text-slate-400">{plan.description}</p>
              <p className="mt-4 text-2xl font-bold">
                ${plan.priceMonthlyUsd}
                <span className="text-sm font-normal text-slate-400"> {t("plan.perMonth")}</span>
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
                disabled={isCurrent || plan.type === "FREE"}
                onClick={() => setModalPlan(plan)}
                className="mt-6 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
              >
                {isCurrent ? t("dash.subscription.currentBadge") : plan.type === "FREE" ? t("dash.subscription.freePlanLabel") : t("dash.subscription.activate")}
              </button>
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t("dash.subscription.history")}</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("dash.subscription.colPlan")}</th>
                <th className="px-4 py-3">{t("dash.subscription.colAmount")}</th>
                <th className="px-4 py-3">{t("dash.subscription.colMethod")}</th>
                <th className="px-4 py-3">{t("dash.subscription.colStatus")}</th>
                <th className="px-4 py-3">{t("dash.subscription.colPeriod")}</th>
                <th className="px-4 py-3">{t("dash.subscription.colDate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{t(`plan.${p.plan}` as TranslationKey)}</td>
                  <td className="px-4 py-3">${p.amountUsd}</td>
                  <td className="px-4 py-3 text-slate-400">{t(`payment.method.${p.method}` as TranslationKey)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(p.periodStart).toLocaleDateString(locale)} — {new Date(p.periodEnd).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.createdAt).toLocaleString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && payments.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">{t("dash.subscription.empty")}</p>
          )}
        </div>
      </div>

      {modalPlan && (
        <PaymentModal plan={modalPlan} onClose={() => setModalPlan(null)} onSubmit={handleSubscribe} submitting={submitting} />
      )}
    </div>
  );
}
