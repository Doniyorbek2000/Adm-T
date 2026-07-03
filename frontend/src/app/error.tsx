"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="max-w-md text-center">
        <div className="mb-4 text-6xl">⚠</div>
        <h1 className="mb-2 text-2xl font-bold">Kutilmagan xatolik yuz berdi</h1>
        <p className="mb-6 text-slate-400">
          Tizimda xatolik ro&apos;y berdi. Iltimos, qayta urinib ko&apos;ring yoki keyinroq tashrif buyuring.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => unstable_retry()}
            className="rounded-lg bg-emerald-500 px-6 py-2.5 font-semibold text-white transition hover:bg-emerald-600"
          >
            Qayta urinish
          </button>
          <a
            href="/"
            className="rounded-lg border border-white/10 px-6 py-2.5 font-semibold text-slate-300 transition hover:bg-white/5"
          >
            Bosh sahifaga
          </a>
        </div>
      </div>
    </div>
  );
}
