"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface PlanDto {
  id: string;
  type: "FREE" | "PRO" | "ULTRA" | "VIP";
  name: string;
  priceMonthlyUsd: number;
  description: string;
  features: string[];
  autoTradeAllowed: boolean;
  signalDelayMin: number;
}

const STEP_KEYS: { titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { titleKey: "landing.step1Title", textKey: "landing.step1Text" },
  { titleKey: "landing.step2Title", textKey: "landing.step2Text" },
  { titleKey: "landing.step3Title", textKey: "landing.step3Text" },
  { titleKey: "landing.step4Title", textKey: "landing.step4Text" },
];

const FAQ_KEYS: { qKey: TranslationKey; aKey: TranslationKey }[] = [
  { qKey: "landing.faq1Q", aKey: "landing.faq1A" },
  { qKey: "landing.faq2Q", aKey: "landing.faq2A" },
  { qKey: "landing.faq3Q", aKey: "landing.faq3A" },
  { qKey: "landing.faq4Q", aKey: "landing.faq4A" },
];

const STAT_KEYS: { valueKey: TranslationKey; labelKey: TranslationKey }[] = [
  { valueKey: "landing.stat1Value", labelKey: "landing.stat1Label" },
  { valueKey: "landing.stat2Value", labelKey: "landing.stat2Label" },
  { valueKey: "landing.stat3Value", labelKey: "landing.stat3Label" },
  { valueKey: "landing.stat4Value", labelKey: "landing.stat4Label" },
];

export default function Home() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<PlanDto[]>([]);

  useEffect(() => {
    apiRequest<{ plans: PlanDto[] }>("/plans")
      .then((data) => setPlans(data.plans))
      .catch(() => setPlans([]));
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_55%)]" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6 lg:px-8">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm text-emerald-300">
            ⚡ {t("landing.badge")}
          </span>
          <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">
            {t("landing.heroTitleLine1")}<br className="hidden sm:block" /> {t("landing.heroTitleLine2")}{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">{t("landing.heroTitleLine3")}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-300">{t("landing.heroSubtitle")}</p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/register"
              className="rounded-xl bg-emerald-500 px-8 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              {t("landing.ctaStart")}
            </Link>
            <Link
              href="#tariflar"
              className="rounded-xl border border-white/15 bg-white/5 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
            >
              {t("landing.ctaViewPricing")}
            </Link>
          </div>
          <div className="mt-16 grid w-full max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {STAT_KEYS.map((stat) => (
              <div key={stat.labelKey} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5">
                <div className="text-2xl font-bold text-emerald-400">{t(stat.valueKey)}</div>
                <div className="mt-1 text-sm text-slate-400">{t(stat.labelKey)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QANDAY ISHLAYDI */}
      <section id="qanday-ishlaydi" className="border-b border-white/10 bg-slate-950 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">{t("landing.howTitle")}</h2>
            <p className="mt-4 text-slate-400">{t("landing.howSubtitle")}</p>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEP_KEYS.map((step) => (
              <div key={step.titleKey} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="text-lg font-semibold text-emerald-300">{t(step.titleKey)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{t(step.textKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARIFLAR */}
      <section id="tariflar" className="border-b border-white/10 bg-gradient-to-b from-slate-950 to-slate-900 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">{t("landing.pricingTitle")}</h2>
            <p className="mt-4 text-slate-400">{t("landing.pricingSubtitle")}</p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-4">
            {plans.length === 0 && (
              <p className="col-span-4 text-center text-slate-500">{t("landing.pricingLoading")}</p>
            )}
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      {/* SAVOL JAVOB */}
      <section id="savollar" className="bg-slate-950 py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">{t("landing.faqTitle")}</h2>
          <div className="mt-12 space-y-4">
            {FAQ_KEYS.map((item) => (
              <details key={item.qKey} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 open:bg-white/[0.06]">
                <summary className="cursor-pointer list-none text-base font-semibold text-white marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {t(item.qKey)}
                    <span className="text-emerald-400 transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-slate-400">{t(item.aKey)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-gradient-to-r from-emerald-500/10 via-sky-500/10 to-violet-500/10 py-20">
        <div className="mx-auto flex max-w-4xl flex-col items-center px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">{t("landing.ctaTitle")}</h2>
          <p className="mt-4 max-w-xl text-slate-300">{t("landing.ctaSubtitle")}</p>
          <Link
            href="/register"
            className="mt-8 rounded-xl bg-emerald-500 px-8 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
          >
            {t("landing.ctaButton")}
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-slate-950 py-10 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} ADM Trading. {t("landing.footerRights")}</p>
        <p className="mt-2 max-w-2xl mx-auto px-4 text-xs text-slate-600">{t("landing.footerDisclaimer")}</p>
      </footer>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanDto }) {
  const { t } = useTranslation();
  const highlight = plan.type === "ULTRA";
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        highlight
          ? "border-emerald-400/50 bg-emerald-400/[0.07] shadow-xl shadow-emerald-500/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 left-6 rounded-full bg-emerald-400 px-3 py-1 text-xs font-semibold text-slate-950">
          {t("landing.mostPopular")}
        </span>
      )}
      <h3 className="text-xl font-bold">{plan.name}</h3>
      <p className="mt-1 text-sm text-slate-400">{plan.description}</p>
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-3xl font-bold">${plan.priceMonthlyUsd}</span>
        <span className="text-sm text-slate-400">{t("plan.perMonth")}</span>
      </div>
      <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-300">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="mt-0.5 text-emerald-400">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/register"
        className={`mt-8 block rounded-xl px-4 py-3 text-center text-sm font-semibold transition ${
          highlight
            ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            : "border border-white/15 bg-white/5 text-white hover:bg-white/10"
        }`}
      >
        {plan.priceMonthlyUsd === 0 ? t("landing.planCtaFree") : t("landing.planCtaPaid")}
      </Link>
    </div>
  );
}
