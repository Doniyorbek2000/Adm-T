"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TranslationKey } from "@/lib/i18n/translations/en";

const PLAN_STYLES: Record<string, string> = {
  FREE: "bg-slate-700 text-slate-200",
  PRO: "bg-sky-600 text-white",
  ULTRA: "bg-violet-600 text-white",
  VIP: "bg-amber-500 text-slate-950",
};

export function Navbar() {
  const { user, logout, isLoading } = useAuth();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 font-bold text-slate-950">
            A
          </span>
          <span className="text-lg font-semibold tracking-tight">
            ADM <span className="text-emerald-400">Trading</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
          <Link href="/#qanday-ishlaydi" className="hover:text-white">
            {t("nav.howItWorks")}
          </Link>
          <Link href="/#tariflar" className="hover:text-white">
            {t("nav.pricing")}
          </Link>
          <Link href="/#savollar" className="hover:text-white">
            {t("nav.faq")}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher compact />
          {isLoading ? null : user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
              >
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PLAN_STYLES[user.plan]}`}>
                  {t(`plan.${user.plan}` as TranslationKey)}
                </span>
                <span className="max-w-[120px] truncate">{user.fullName}</span>
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <Link
                    href={user.role === "ADMIN" ? "/admin" : "/dashboard"}
                    className="block px-4 py-3 text-sm hover:bg-white/5"
                    onClick={() => setMenuOpen(false)}
                  >
                    {user.role === "ADMIN" ? t("nav.adminPanel") : t("nav.dashboard")}
                  </Link>
                  {user.role !== "ADMIN" && (
                    <Link
                      href="/dashboard/subscription"
                      className="block px-4 py-3 text-sm hover:bg-white/5"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t("nav.myPlan")}
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="block w-full px-4 py-3 text-left text-sm text-rose-400 hover:bg-white/5"
                  >
                    {t("nav.logout")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:text-white"
              >
                {t("nav.login")}
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                {t("nav.register")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
