"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TranslationKey } from "@/lib/i18n/translations/en";

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: string;
}

const USER_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "sidebar.overview", icon: "📊" },
  { href: "/dashboard/signals", labelKey: "sidebar.signals", icon: "📡" },
  { href: "/dashboard/accounts", labelKey: "sidebar.accounts", icon: "🔗" },
  { href: "/dashboard/trades", labelKey: "sidebar.trades", icon: "📈" },
  { href: "/dashboard/stats", labelKey: "sidebar.stats", icon: "📉" },
  { href: "/dashboard/notifications", labelKey: "sidebar.notifications", icon: "🔔" },
  { href: "/dashboard/support", labelKey: "sidebar.support", icon: "💬" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", labelKey: "adminSidebar.dashboard", icon: "🛠️" },
  { href: "/admin/users", labelKey: "adminSidebar.users", icon: "👥" },
  { href: "/admin/signals", labelKey: "adminSidebar.signals", icon: "📡" },
  { href: "/admin/plans", labelKey: "adminSidebar.plans", icon: "💳" },
  { href: "/admin/trades", labelKey: "adminSidebar.trades", icon: "📈" },
  { href: "/admin/support", labelKey: "adminSidebar.support", icon: "💬" },
];

export function DashboardShell({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "user" | "admin";
}) {
  const { user, isLoading, logout } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  const navItems = USER_NAV;

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center py-32 text-slate-400">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-slate-950/60 p-4 lg:block">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 font-bold text-slate-950">
            A
          </span>
          <span className="font-semibold">
            ADM <span className="text-emerald-400">Trading</span>
          </span>
        </Link>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active ? "bg-emerald-400/10 text-emerald-300" : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6">
          <LanguageSwitcher />
        </div>
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="font-medium">{user.fullName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{user.email}</p>
          <button onClick={logout} className="mt-3 text-xs font-semibold text-rose-400 hover:underline">
            {t("sidebar.logout")}
          </button>
        </div>
      </aside>

      <div className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
        <div className="mb-6 flex items-center justify-between gap-3 lg:hidden">
          <span className="font-semibold">
            ADM <span className="text-emerald-400">Trading</span>
          </span>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <button onClick={logout} className="text-xs font-semibold text-rose-400">
              {t("sidebar.logout")}
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
