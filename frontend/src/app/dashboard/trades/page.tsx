"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { TranslationKey } from "@/lib/i18n/translations/en";

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
  const { t, locale } = useTranslation();
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
        <h1 className="text-2xl font-bold">{t("dash.trades.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("dash.trades.subtitle")}</p>
      </div>

      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">{t("dash.trades.colSymbol")}</th>
              <th className="px-4 py-3">{t("dash.trades.colDirection")}</th>
              <th className="px-4 py-3">{t("dash.trades.colAccount")}</th>
              <th className="px-4 py-3">{t("dash.trades.colEntry")}</th>
              <th className="px-4 py-3">{t("dash.trades.colExit")}</th>
              <th className="px-4 py-3">{t("dash.trades.colPnl")}</th>
              <th className="px-4 py-3">{t("dash.trades.colStatus")}</th>
              <th className="px-4 py-3">{t("dash.trades.colOpened")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {trades.map((trade) => (
              <tr key={trade.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium">{trade.symbol}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      trade.direction === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {t(`dash.trades.${trade.direction.toLowerCase()}` as TranslationKey)}
                  </span>
                  {trade.executedByAi && <span className="ml-2 text-[11px] text-slate-500">🤖 AI</span>}
                </td>
                <td className="px-4 py-3 text-slate-400">{trade.brokerAccount ? `${trade.brokerAccount.exchange} • ${trade.brokerAccount.label}` : "—"}</td>
                <td className="px-4 py-3">{trade.entryPrice}</td>
                <td className="px-4 py-3">{trade.exitPrice ?? "—"}</td>
                <td className={`px-4 py-3 font-semibold ${(trade.pnlUsd ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {trade.pnlUsd != null ? `${trade.pnlUsd >= 0 ? "+" : ""}$${trade.pnlUsd.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      trade.status === "OPEN" ? "bg-sky-500/15 text-sky-300" : "bg-slate-500/15 text-slate-300"
                    }`}
                  >
                    {t(`dash.trades.${trade.status.toLowerCase()}` as TranslationKey)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(trade.openedAt).toLocaleString(locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && trades.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-500">{t("dash.trades.empty")}</p>
        )}
      </div>
    </div>
  );
}
