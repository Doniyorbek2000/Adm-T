"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const USER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Umumiy ko'rinish", icon: "📊" },
  { href: "/dashboard/signals", label: "AI signallari", icon: "📡" },
  { href: "/dashboard/accounts", label: "Hisoblarim", icon: "🔗" },
  { href: "/dashboard/trades", label: "Savdolar tarixi", icon: "📈" },
  { href: "/dashboard/subscription", label: "Tarif / Obuna", icon: "💳" },
  { href: "/dashboard/notifications", label: "Bildirishnomalar", icon: "🔔" },
  { href: "/dashboard/support", label: "Yordam", icon: "💬" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Boshqaruv paneli", icon: "🛠️" },
  { href: "/admin/users", label: "Foydalanuvchilar", icon: "👥" },
  { href: "/admin/signals", label: "AI signallari", icon: "📡" },
  { href: "/admin/plans", label: "Tarif rejalari", icon: "💳" },
  { href: "/admin/trades", label: "Savdolar", icon: "📈" },
  { href: "/admin/support", label: "Xabarlar / Yordam", icon: "💬" },
];

export function DashboardShell({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "user" | "admin";
}) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (variant === "admin" && user.role !== "ADMIN") {
      router.replace("/dashboard");
    }
    if (variant === "user" && user.role === "ADMIN") {
      router.replace("/admin");
    }
  }, [isLoading, user, variant, router]);

  const navItems = variant === "admin" ? ADMIN_NAV : USER_NAV;

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center py-32 text-slate-400">
        Yuklanmoqda...
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
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="font-medium">{user.fullName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{user.email}</p>
          <button onClick={logout} className="mt-3 text-xs font-semibold text-rose-400 hover:underline">
            Chiqish
          </button>
        </div>
      </aside>

      <div className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <span className="font-semibold">
            ADM <span className="text-emerald-400">Trading</span>
          </span>
          <button onClick={logout} className="text-xs font-semibold text-rose-400">
            Chiqish
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
