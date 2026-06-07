"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(fullName, email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.register.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <h1 className="text-2xl font-bold">{t("auth.register.title")}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {t("auth.register.haveAccount")}{" "}
            <Link href="/login" className="text-emerald-400 hover:underline">
              {t("auth.register.loginLink")}
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("auth.register.fullName")}</label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
                placeholder={t("auth.register.fullNamePlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("auth.register.email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
                placeholder={t("auth.register.emailPlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">{t("auth.register.password")}</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
                placeholder={t("auth.register.passwordPlaceholder")}
              />
            </div>

            {error && <p className="rounded-lg bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">{t("auth.register.footerHint")}</p>
        </div>
      </main>
    </div>
  );
}
