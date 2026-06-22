import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="max-w-md text-center">
        <div className="mb-4 text-7xl font-bold text-emerald-400">404</div>
        <h1 className="mb-2 text-2xl font-bold">Sahifa topilmadi</h1>
        <p className="mb-6 text-slate-400">
          Siz qidirayotgan sahifa mavjud emas yoki ko&apos;chirilgan. Manzilni tekshirib ko&apos;ring.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-emerald-500 px-6 py-2.5 font-semibold text-white transition hover:bg-emerald-600"
        >
          Bosh sahifaga qaytish
        </Link>
      </div>
    </div>
  );
}
