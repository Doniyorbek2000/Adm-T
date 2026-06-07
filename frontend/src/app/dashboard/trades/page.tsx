"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";

interface TradeDto {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnlUsd: number | null;
  status: "OPEN" | "CLOSED";
  executedByAi: boolean;
  openedAt: string;
  closedAt: string | null;
  brokerAccount?: { exchange: string; label: string } | null;
}

export default function TradesPage() {
  const { token } = useAuth();
  const [trades, setTrades] = useState<TradeDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiRequest<{ trades: TradeDto[] }>("/trades", { token })
      .then((data) => setTrades(data.trades))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Savdolar tarixi</h1>
        <p className="mt-1 text-sm text-slate-400">
          AI tomonidan avtomatik ochilgan va yopilgan barcha pozitsiyalaringiz ro'yxati.
        </p>
      </div>

      {loading && <p className="text-sm text-slate-400">Yuklanmoqda...</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Juftlik</th>
              <th className="px-4 py-3">Yo'nalish</th>
              <th className="px-4 py-3">Hisob</th>
              <th className="px-4 py-3">Kirish narxi</th>
              <th className="px-4 py-3">Chiqish narxi</th>
              <th className="px-4 py-3">PnL</th>
              <th className="px-4 py-3">Holat</th>
              <th className="px-4 py-3">Ochilgan vaqti</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {trades.map((t) => (
              <tr key={t.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium">{t.symbol}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      t.direction === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {t.direction === "BUY" ? "XARID" : "SOTISH"}
                  </span>
                  {t.executedByAi && <span className="ml-2 text-[11px] text-slate-500">🤖 AI</span>}
                </td>
                <td className="px-4 py-3 text-slate-400">{t.brokerAccount ? `${t.brokerAccount.exchange} • ${t.brokerAccount.label}` : "—"}</td>
                <td className="px-4 py-3">{t.entryPrice}</td>
                <td className="px-4 py-3">{t.exitPrice ?? "—"}</td>
                <td className={`px-4 py-3 font-semibold ${(t.pnlUsd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.pnlUsd != null ? `${t.pnlUsd >= 0 ? "+" : ""}$${t.pnlUsd.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      t.status === "OPEN" ? "bg-sky-500/15 text-sky-300" : "bg-slate-500/15 text-slate-300"
                    }`}
                  >
                    {t.status === "OPEN" ? "Ochiq" : "Yopilgan"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(t.openedAt).toLocaleString("uz-UZ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && trades.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Hozircha savdolar mavjud emas. "To'liq avto-treding" rejimini yoqsangiz, AI siz uchun savdoni avtomatik boshlaydi.
          </p>
        )}
      </div>
    </div>
  );
}
