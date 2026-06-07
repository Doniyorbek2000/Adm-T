import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { apiRequest } from "@/lib/api";

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

async function getPlans(): Promise<PlanDto[]> {
  try {
    const data = await apiRequest<{ plans: PlanDto[] }>("/plans");
    return data.plans;
  } catch {
    return [];
  }
}

const STEPS = [
  {
    title: "1. Ro'yxatdan o'ting",
    text: "Bir necha soniyada hisob yarating — ism, email va parol yetarli. Hech qanday murakkab tasdiqlash yo'q.",
  },
  {
    title: "2. Hisobingizni ulang (yoki ulamang)",
    text: "Birja (Binance, Bybit, OKX...) API kalitlaringizni ulasangiz, AI siz uchun avtomatik savdo qiladi. Agar ulamasangiz — tizim sizga bepul Demo (virtual $10,000) hisob beradi, shu orqali AI qanday ishlashini xavfsiz kuzatasiz.",
  },
  {
    title: "3. Rejimni tanlang",
    text: "“Faqat signal” rejimida AI tahlillarini o'zingiz qo'llaysiz, “To'liq avto-treding” rejimida esa AI hammasini — tahlil, kirish, chiqish, risk boshqaruvini — sizning ishtirokingizsiz mustaqil bajaradi.",
  },
  {
    title: "4. AI ishlay boshlaydi",
    text: "Sun'iy intellekt bozorni 24/7 kuzatadi, signal generatsiya qiladi, pozitsiyalarni ochadi va yopadi, natijalarni va statistikani boshqaruv panelingizda ko'rsatadi.",
  },
];

const FAQ = [
  {
    q: "Agar men birja hisobimni ulamasam-chi?",
    a: "Hech qanday muammo yo'q. Tizim sizga avtomatik ravishda virtual balansli (Demo) hisob ochib beradi. Siz AI signallarini va uning savdo strategiyasini xavfsiz tarzda, real pulingizni tavakkal qilmasdan kuzata olasiz. Tayyor bo'lganingizda istalgan vaqtda real hisobingizni ulashingiz mumkin.",
  },
  {
    q: "AI chindan ham mening o'rnimga savdo qila oladimi?",
    a: "Ha. ULTRA va VIP tariflarida “To'liq avto-treding” rejimini yoqsangiz, AI bozorni tahlil qiladi, signalni generatsiya qiladi, pozitsiyani ochadi, Take-Profit/Stop-Loss darajalarini kuzatadi va pozitsiyani yopadi — bularning barchasi siz hech qanday amal bajarmasdan, to'liq mustaqil amalga oshiriladi.",
  },
  {
    q: "Tariflar orasidagi farq nima?",
    a: "Bepul tarif sizga tanishish imkoniyatini beradi (kechikish bilan signal). Pro tarifida tezroq va kengaytirilgan tahlillar mavjud. Ultra va VIP esa to'liq avtomatik savdo, kechikishsiz signal va eksklyuziv imkoniyatlarni ochadi — VIP'da esa eng yuqori ishonchli, eksklyuziv signallar va shaxsiy AI sozlamalari mavjud.",
  },
  {
    q: "To'lovlar qanday amalga oshiriladi?",
    a: "Obuna oylik asosda ishlaydi. Tarifni tanlaganingizdan so'ng to'lov amalga oshiriladi va hisobingiz darhol yangilanadi — keyingi oy uchun avtomatik eslatma yuboriladi.",
  },
];

export default async function Home() {
  const plans = await getPlans();

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_55%)]" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6 lg:px-8">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm text-emerald-300">
            ⚡ Sun'iy intellekt — odam ishtirokisiz tahlil va savdo
          </span>
          <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">
            Bozorni AI tahlil qiladi.<br className="hidden sm:block" /> Savdoni AI bajaradi.{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">Siz esa natijani kuzatasiz.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-300">
            ADM Trading — kripto va moliya bozorlarini 24/7 kuzatuvchi, signal generatsiya qiluvchi va
            xohlasangiz savdoni to'liq mustaqil amalga oshiruvchi AI platforma. Tajribali treyder bo'lish shart emas.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/register"
              className="rounded-xl bg-emerald-500 px-8 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              Bepul boshlash →
            </Link>
            <Link
              href="#tariflar"
              className="rounded-xl border border-white/15 bg-white/5 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Tariflarni ko'rish
            </Link>
          </div>
          <div className="mt-16 grid w-full max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              ["24/7", "Tinimsiz tahlil"],
              ["AI", "To'liq avtomatik savdo"],
              ["4", "Tarif darajasi"],
              ["0", "Tajriba talab etilmaydi"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5">
                <div className="text-2xl font-bold text-emerald-400">{value}</div>
                <div className="mt-1 text-sm text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QANDAY ISHLAYDI */}
      <section id="qanday-ishlaydi" className="border-b border-white/10 bg-slate-950 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Qanday ishlaydi?</h2>
            <p className="mt-4 text-slate-400">
              Hisob ulashdan tortib, birinchi avtomatik savdogacha — bor-yo'g'i to'rtta qadam.
              Hisobingizni ulamasangiz ham, tizim siz uchun yechim taklif qiladi.
            </p>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="text-lg font-semibold text-emerald-300">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARIFLAR */}
      <section id="tariflar" className="border-b border-white/10 bg-gradient-to-b from-slate-950 to-slate-900 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Tarif rejalari</h2>
            <p className="mt-4 text-slate-400">
              Ehtiyojingizga mos tarifni tanlang. Istalgan vaqtda yangi tarifga o'tishingiz mumkin.
            </p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-4">
            {plans.length === 0 && (
              <p className="col-span-4 text-center text-slate-500">Tariflar yuklanmoqda... (backend serveri ishga tushirilganligini tekshiring)</p>
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
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Tez-tez so'raladigan savollar</h2>
          <div className="mt-12 space-y-4">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 open:bg-white/[0.06]">
                <summary className="cursor-pointer list-none text-base font-semibold text-white marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {item.q}
                    <span className="text-emerald-400 transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-slate-400">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-gradient-to-r from-emerald-500/10 via-sky-500/10 to-violet-500/10 py-20">
        <div className="mx-auto flex max-w-4xl flex-col items-center px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">AI bilan tredingni hoziroq sinab ko'ring</h2>
          <p className="mt-4 max-w-xl text-slate-300">
            Ro'yxatdan o'ting, broker hisobingizni ulang yoki bepul Demo orqali boshlang — qolganini AI o'ziga oladi.
          </p>
          <Link
            href="/register"
            className="mt-8 rounded-xl bg-emerald-500 px-8 py-3.5 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
          >
            Bepul ro'yxatdan o'tish
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-slate-950 py-10 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} ADM Trading. Barcha huquqlar himoyalangan.</p>
        <p className="mt-2 max-w-2xl mx-auto px-4 text-xs text-slate-600">
          Ogohlantirish: kripto va moliya bozorlarida savdo qilish yuqori tavakkalchilik bilan bog'liq. AI signallari
          moliyaviy maslahat hisoblanmaydi, sarmoyaviy qarorlar uchun mas'uliyat foydalanuvchining o'zida qoladi.
        </p>
      </footer>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanDto }) {
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
          Eng mashhur
        </span>
      )}
      <h3 className="text-xl font-bold">{plan.name}</h3>
      <p className="mt-1 text-sm text-slate-400">{plan.description}</p>
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-3xl font-bold">${plan.priceMonthlyUsd}</span>
        <span className="text-sm text-slate-400">/ oyiga</span>
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
        {plan.priceMonthlyUsd === 0 ? "Bepul boshlash" : "Tarifni tanlash"}
      </Link>
    </div>
  );
}
