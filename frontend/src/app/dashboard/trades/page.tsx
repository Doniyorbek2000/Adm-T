"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest, ApiError } from "@/lib/api";

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
  executionMode?: string | null;
  openedAt: string;
  closedAt: string | null;
  brokerAccount?: { exchange: string; label: string } | null;
  signal?: { confidence: number; analysis?: string | null } | null;
}

interface Summary {
  totalBalance: number;
  realizedPnl: number;
  openPositions: number;
  closedTrades: number;
  winRate: number;
}

type HistoryFilter = "ALL" | "WIN" | "LOSS" | "BUY" | "SELL" | "AI";

const REFRESH_SEC = 30;

function duration(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now();
  const diff = end - new Date(from).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}k ${h % 24}s`;
}

function pnlPct(entry: number, exit: number | null, dir: "BUY" | "SELL"): string | null {
  if (exit == null) return null;
  const raw = dir === "BUY" ? (exit - entry) / entry : (entry - exit) / entry;
  return (raw * 100).toFixed(2);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

const MODE_BADGE: Record<string, string> = {
  LIVE:      "bg-rose-500/20 text-rose-300 border-rose-500/30",
  TESTNET:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  SIMULATED: "bg-slate-500/15 text-slate-400 border-slate-500/20",
};

export default function TradesPage() {
  const { token } = useAuth();
  const [trades, setTrades]     = useState<TradeDto[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [prices, setPrices]     = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [histFilter, setHistFilter] = useState<HistoryFilter>("ALL");
  const [closingId, setClosingId]  = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [t, s] = await Promise.all([
        apiRequest<{ trades: TradeDto[] }>("/trades", { token }),
        apiRequest<Summary>("/trades/summary", { token }),
      ]);
      setTrades(t.trades);
      setSummary(s);
      setCountdown(REFRESH_SEC);

      // Fetch live prices for open positions
      const openSymbols = [...new Set(t.trades.filter((tr) => tr.status === "OPEN").map((tr) => tr.symbol))];
      if (openSymbols.length > 0) {
        try {
          const pd = await apiRequest<{ prices: Record<string, number> }>(
            `/market/prices?symbols=${openSymbols.join(",")}`,
            { token }
          );
          setPrices(pd.prices);
        } catch {
          // non-critical
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ma'lumotlarni yuklashda xatolik");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial load + auto-refresh every REFRESH_SEC seconds
  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_SEC * 1000);
    return () => clearInterval(interval);
  }, [load]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : REFRESH_SEC)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleClose(tradeId: string) {
    const trade = trades.find((t) => t.id === tradeId);
    const isReal = trade?.executionMode === "LIVE" || trade?.executionMode === "TESTNET";
    const confirmMsg = isReal
      ? `DIQQAT: Bu HAQIQIY savdo!\n${trade?.symbol} pozitsiyasini birjada bozor narxida yopasizmi?`
      : `${trade?.symbol} simulyatsiya savdosini yopasizmi?`;

    if (!window.confirm(confirmMsg)) return;
    if (!token) return;

    setClosingId(tradeId);
    try {
      await apiRequest(`/trades/${tradeId}/close`, { method: "POST", token });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Yopishda xatolik yuz berdi");
    } finally {
      setClosingId(null);
    }
  }

  const open   = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status === "CLOSED");

  const filteredClosed = closed.filter((t) => {
    if (histFilter === "WIN")  return (t.pnlUsd ?? 0) > 0;
    if (histFilter === "LOSS") return (t.pnlUsd ?? 0) < 0;
    if (histFilter === "BUY")  return t.direction === "BUY";
    if (histFilter === "SELL") return t.direction === "SELL";
    if (histFilter === "AI")   return t.executedByAi;
    return true;
  });

  const totalWins  = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const totalLoss  = closed.filter((t) => (t.pnlUsd ?? 0) < 0).length;
  const bestTrade  = closed.reduce<TradeDto | null>((best, t) => (!best || (t.pnlUsd ?? 0) > (best.pnlUsd ?? 0) ? t : best), null);
  const worstTrade = closed.reduce<TradeDto | null>((w, t) => (!w || (t.pnlUsd ?? 0) < (w.pnlUsd ?? 0) ? t : w), null);

  const HIST_FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: "ALL",  label: `Barchasi (${closed.length})` },
    { key: "WIN",  label: `Foydali (${totalWins})` },
    { key: "LOSS", label: `Zararli (${totalLoss})` },
    { key: "BUY",  label: "BUY" },
    { key: "SELL", label: "SELL" },
    { key: "AI",   label: "🤖 AI" },
  ];

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Savdolar</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            AI tomonidan bajarilgan va qo'lda ochilgan barcha pozitsiyalar
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{countdown}s da yangilanadi</span>
          <button
            onClick={load}
            className="self-start rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
          >
            ↻ Yangilash
          </button>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Chip label="Jami balans" value={summary ? `$${summary.totalBalance.toLocaleString()}` : "—"} color="white" />
        <Chip
          label="Amalga oshirilgan P&L"
          value={summary ? `${summary.realizedPnl >= 0 ? "+" : ""}$${summary.realizedPnl.toFixed(2)}` : "—"}
          color={summary ? (summary.realizedPnl >= 0 ? "emerald" : "rose") : "white"}
          big
        />
        <Chip label="Ochiq pozitsiya" value={open.length} color="sky" />
        <Chip label="Jami savdo" value={closed.length} color="slate" />
        <Chip
          label="Win Rate"
          value={summary ? `${summary.winRate}%` : "—"}
          color={summary ? (summary.winRate >= 60 ? "emerald" : summary.winRate >= 45 ? "amber" : "rose") : "white"}
          big
        />
      </div>

      {/* ── Extra Stats ── */}
      {closed.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {bestTrade && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <div>
                <p className="text-xs text-slate-400">Eng yaxshi savdo</p>
                <p className="mt-0.5 font-mono font-semibold">{bestTrade.symbol}</p>
              </div>
              <p className="font-mono text-xl font-bold text-emerald-400">
                +${(bestTrade.pnlUsd ?? 0).toFixed(2)}
              </p>
            </div>
          )}
          {worstTrade && (
            <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <div>
                <p className="text-xs text-slate-400">Eng yomon savdo</p>
                <p className="mt-0.5 font-mono font-semibold">{worstTrade.symbol}</p>
              </div>
              <p className="font-mono text-xl font-bold text-rose-400">
                ${(worstTrade.pnlUsd ?? 0).toFixed(2)}
              </p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          Yuklanmoqda...
        </div>
      )}

      {/* ── Open Positions ── */}
      {open.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            <h2 className="font-semibold">Ochiq pozitsiyalar</h2>
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-300">
              {open.length}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((t) => (
              <OpenTradeCard
                key={t.id}
                trade={t}
                currentPrice={prices[t.symbol]}
                closing={closingId === t.id}
                onClose={() => handleClose(t.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Trade History ── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 font-semibold">Savdo tarixi</h2>
          {HIST_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setHistFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                histFilter === f.key
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Aktiv</th>
                <th className="px-4 py-3 font-medium">Hisob</th>
                <th className="px-4 py-3 font-medium">Kirish</th>
                <th className="px-4 py-3 font-medium">Chiqish</th>
                <th className="px-4 py-3 font-medium">Miqdor</th>
                <th className="px-4 py-3 font-medium">P&L</th>
                <th className="px-4 py-3 font-medium">Davomiylik</th>
                <th className="px-4 py-3 font-medium">Sana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredClosed.map((t) => {
                const pct = pnlPct(t.entryPrice, t.exitPrice, t.direction);
                const isWin = (t.pnlUsd ?? 0) > 0;
                const mode = t.executionMode ?? "SIMULATED";
                return (
                  <tr key={t.id} className="group hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold">{t.symbol}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${t.direction === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                          {t.direction === "BUY" ? "▲" : "▼"} {t.direction}
                        </span>
                        {t.executedByAi && (
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">🤖</span>
                        )}
                        {mode !== "SIMULATED" && (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${MODE_BADGE[mode] ?? MODE_BADGE.SIMULATED}`}>
                            {mode}
                          </span>
                        )}
                        {t.signal?.confidence != null && (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                            {t.signal.confidence}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {t.brokerAccount ? `${t.brokerAccount.exchange} · ${t.brokerAccount.label}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{fmt(t.entryPrice)}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{t.exitPrice != null ? fmt(t.exitPrice) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">
                      {t.quantity} <span className="text-[10px] text-slate-600">{t.symbol.split("/")[0]}</span>
                    </td>
                    <td className="px-4 py-3">
                      {t.pnlUsd != null ? (
                        <div>
                          <p className={`font-mono font-semibold ${isWin ? "text-emerald-400" : "text-rose-400"}`}>
                            {isWin ? "+" : ""}${t.pnlUsd.toFixed(2)}
                          </p>
                          {pct && (
                            <p className={`text-xs ${isWin ? "text-emerald-500" : "text-rose-500"}`}>
                              {Number(pct) >= 0 ? "+" : ""}{pct}%
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{duration(t.openedAt, t.closedAt)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(t.openedAt).toLocaleDateString("uz-UZ")}
                      <br />
                      <span className="text-slate-600">
                        {new Date(t.openedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && filteredClosed.length === 0 && (
            <p className="px-4 py-14 text-center text-sm text-slate-500">
              {histFilter === "ALL" ? "Hali yopilgan savdolar yo'q" : "Bu filtr bo'yicha savdo topilmadi"}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Open Trade Card ──────────────────────────────────────────────────────────
function OpenTradeCard({
  trade: t,
  currentPrice,
  closing,
  onClose,
}: {
  trade: TradeDto;
  currentPrice?: number;
  closing: boolean;
  onClose: () => void;
}) {
  const isBuy = t.direction === "BUY";
  const mode  = t.executionMode ?? "SIMULATED";
  const isReal = mode === "LIVE" || mode === "TESTNET";

  const unrealizedPnl = currentPrice != null
    ? (isBuy ? (currentPrice - t.entryPrice) : (t.entryPrice - currentPrice)) * t.quantity
    : null;
  const unrealizedPct = currentPrice != null && t.entryPrice > 0
    ? ((isBuy ? currentPrice - t.entryPrice : t.entryPrice - currentPrice) / t.entryPrice) * 100
    : null;
  const isProfit = unrealizedPnl != null && unrealizedPnl >= 0;

  return (
    <div className={`rounded-2xl border p-4 ${isBuy ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-rose-500/25 bg-rose-500/[0.04]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-lg font-bold">{t.symbol}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${isBuy ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
            {isBuy ? "▲ BUY" : "▼ SELL"}
          </span>
          {t.executedByAi && <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">🤖 AI</span>}
          {mode !== "SIMULATED" && (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${MODE_BADGE[mode] ?? MODE_BADGE.SIMULATED}`}>
              {mode}
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 text-xs text-sky-300 shrink-0">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
          Faol
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-white/5 px-2.5 py-2">
          <p className="text-xs text-slate-500">Kirish narxi</p>
          <p className="mt-0.5 font-mono font-semibold">{t.entryPrice.toFixed(2)}</p>
        </div>
        {currentPrice != null ? (
          <div className="rounded-lg bg-white/5 px-2.5 py-2">
            <p className="text-xs text-slate-500">Joriy narx</p>
            <p className="mt-0.5 font-mono font-semibold">{currentPrice.toFixed(2)}</p>
          </div>
        ) : (
          <div className="rounded-lg bg-white/5 px-2.5 py-2">
            <p className="text-xs text-slate-500">Miqdor</p>
            <p className="mt-0.5 font-mono font-semibold">{t.quantity} <span className="text-[10px] text-slate-600">{t.symbol.split("/")[0]}</span></p>
          </div>
        )}
        <div className={`rounded-lg px-2.5 py-2 ${unrealizedPnl != null ? (isProfit ? "bg-emerald-500/10" : "bg-rose-500/10") : "bg-white/5"}`}>
          <p className="text-xs text-slate-500">Hisob. P&L</p>
          {unrealizedPnl != null ? (
            <p className={`mt-0.5 font-mono font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
              {isProfit ? "+" : ""}${unrealizedPnl.toFixed(2)}
              {unrealizedPct != null && (
                <span className="ml-1 text-[10px] font-normal">
                  ({isProfit ? "+" : ""}{unrealizedPct.toFixed(2)}%)
                </span>
              )}
            </p>
          ) : (
            <p className="mt-0.5 font-mono text-slate-500">—</p>
          )}
        </div>
        <div className="rounded-lg bg-white/5 px-2.5 py-2">
          <p className="text-xs text-slate-500">Vaqt</p>
          <p className="mt-0.5 font-mono text-xs font-semibold">{duration(t.openedAt, null)}</p>
        </div>
      </div>

      {t.brokerAccount && (
        <p className="mt-2.5 text-xs text-slate-500">
          {t.brokerAccount.exchange} · {t.brokerAccount.label}
        </p>
      )}
      {t.signal?.confidence != null && (
        <p className="mt-1 text-xs text-slate-500">
          AI ishonchi: <span className="font-semibold text-slate-300">{t.signal.confidence}%</span>
        </p>
      )}

      <button
        onClick={onClose}
        disabled={closing}
        className={`mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          isReal
            ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
        } disabled:opacity-50`}
      >
        {closing ? "Yopilmoqda…" : isReal ? "⚠ Pozitsiyani yopish (REAL)" : "Pozitsiyani yopish"}
      </button>
    </div>
  );
}

// ── Stat Chip ────────────────────────────────────────────────────────────────
function Chip({
  label,
  value,
  color,
  big,
}: {
  label: string;
  value: string | number;
  color: "white" | "emerald" | "rose" | "sky" | "slate" | "amber";
  big?: boolean;
}) {
  const cls: Record<string, string> = {
    white:   "text-white",
    emerald: "text-emerald-300",
    rose:    "text-rose-300",
    sky:     "text-sky-300",
    slate:   "text-slate-300",
    amber:   "text-amber-300",
  };
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-mono font-bold ${big ? "text-2xl" : "text-lg"} ${cls[color]}`}>
        {value}
      </p>
    </div>
  );
}
