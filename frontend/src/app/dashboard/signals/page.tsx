"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";

interface SignalDto {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL" | null;
  entryPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  confidence: number;
  analysis: string | null;
  minPlan: string;
  status: "ACTIVE" | "TP_HIT" | "SL_HIT" | "CLOSED";
  resultPnlPct?: number | null;
  createdAt: string;
  closedAt?: string | null;
  locked: boolean;
  unlocksAt?: string;
  lockedReason?: string;
}

interface SignalStats {
  total: number;
  active: number;
  closed: number;
  wins: number;
  winRate: number;
}

type FilterType = "ALL" | "ACTIVE" | "TP_HIT" | "SL_HIT" | "BUY" | "SELL";

const REFRESH_SEC = 30;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} soat oldin`;
  return `${Math.floor(h / 24)} kun oldin`;
}

function calcRR(entry: number, tp: number, sl: number, dir: "BUY" | "SELL"): string {
  const risk = dir === "BUY" ? entry - sl : sl - entry;
  const reward = dir === "BUY" ? tp - entry : entry - tp;
  if (risk <= 0) return "—";
  return (reward / risk).toFixed(2);
}

function priceDiff(entry: number, target: number): string {
  const pct = ((target - entry) / entry) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
}

export default function SignalsPage() {
  const { token } = useAuth();
  const [signals, setSignals] = useState<SignalDto[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    Promise.all([
      apiRequest<{ signals: SignalDto[] }>("/signals", { token }),
      apiRequest<SignalStats>("/signals/stats", { token }),
    ]).then(([s, st]) => {
      setSignals(s.signals);
      setStats(st);
      setCountdown(REFRESH_SEC);
    }).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { load(); return REFRESH_SEC; }
        return c - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  const filtered = signals.filter((s) => {
    if (filter === "ALL") return true;
    if (filter === "ACTIVE") return s.status === "ACTIVE";
    if (filter === "TP_HIT") return s.status === "TP_HIT";
    if (filter === "SL_HIT") return s.status === "SL_HIT";
    if (filter === "BUY") return s.direction === "BUY";
    if (filter === "SELL") return s.direction === "SELL";
    return true;
  });

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "ALL", label: `Barchasi (${signals.length})` },
    { key: "ACTIVE", label: `Faol (${signals.filter((s) => s.status === "ACTIVE").length})` },
    { key: "BUY", label: "BUY" },
    { key: "SELL", label: "SELL" },
    { key: "TP_HIT", label: "TP ✓" },
    { key: "SL_HIT", label: "SL ✗" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Signallar</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Real vaqtda AI tomonidan generatsiya qilingan savdo signallari
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Yangilanish: <span className="font-mono text-slate-300">{countdown}s</span>
          </span>
          <button
            onClick={() => { load(); setCountdown(REFRESH_SEC); }}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
          >
            ↻ Yangilash
          </button>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatChip label="Jami signallar" value={stats?.total ?? "—"} color="slate" />
        <StatChip label="Faol" value={stats?.active ?? "—"} color="sky" />
        <StatChip label="Yopilgan" value={stats?.closed ?? "—"} color="slate" />
        <StatChip label="Muvaffaqiyat" value={stats?.wins ?? "—"} color="emerald" />
        <StatChip
          label="Win Rate"
          value={stats ? `${stats.winRate}%` : "—"}
          color={stats && stats.winRate >= 60 ? "emerald" : stats && stats.winRate >= 45 ? "amber" : "rose"}
          big
        />
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === f.key
                ? "bg-emerald-500 text-slate-950"
                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          Yuklanmoqda...
        </div>
      )}

      {/* ── Signal Grid ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => (
          <SignalCard
            key={s.id}
            signal={s}
            expanded={expandedIds.has(s.id)}
            onToggle={() => toggleExpand(s.id)}
          />
        ))}
        {!loading && filtered.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center text-slate-500">
            Bu filtr bo&apos;yicha signal topilmadi
          </div>
        )}
      </div>
    </div>
  );
}

// ── Signal Card ──────────────────────────────────────────────────────────────
function SignalCard({
  signal: s,
  expanded,
  onToggle,
}: {
  signal: SignalDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isBuy = s.direction === "BUY";

  const statusMeta: Record<string, { label: string; cls: string }> = {
    ACTIVE:  { label: "● FAOL",   cls: "text-sky-300 bg-sky-500/10 border-sky-500/20" },
    TP_HIT:  { label: "✓ TP",     cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
    SL_HIT:  { label: "✗ SL",     cls: "text-rose-300 bg-rose-500/10 border-rose-500/20" },
    CLOSED:  { label: "○ Yopiq",  cls: "text-slate-300 bg-white/5 border-white/10" },
  };

  const sm = statusMeta[s.status] ?? statusMeta.CLOSED;

  const confidence = s.confidence;
  const confColor =
    confidence >= 85 ? "bg-emerald-400"
    : confidence >= 70 ? "bg-sky-400"
    : "bg-amber-400";
  const confText =
    confidence >= 85 ? "text-emerald-400"
    : confidence >= 70 ? "text-sky-400"
    : "text-amber-400";

  const borderColor =
    s.status === "ACTIVE"
      ? isBuy ? "border-emerald-500/30" : "border-rose-500/30"
      : s.status === "TP_HIT" ? "border-emerald-500/20"
      : s.status === "SL_HIT" ? "border-rose-500/20"
      : "border-white/10";

  // Calculate TP/SL distances and R:R
  const hasPrice = s.entryPrice != null && s.takeProfit != null && s.stopLoss != null;
  const rr = hasPrice && s.direction ? calcRR(s.entryPrice!, s.takeProfit!, s.stopLoss!, s.direction) : null;
  const tpPct = hasPrice ? priceDiff(s.entryPrice!, s.takeProfit!) : null;
  const slPct = hasPrice ? priceDiff(s.entryPrice!, s.stopLoss!) : null;

  return (
    <div className={`flex flex-col rounded-2xl border bg-white/[0.025] ${borderColor} overflow-hidden`}>
      {/* Top bar */}
      <div className={`flex items-center justify-between px-4 py-2 text-xs font-medium ${
        s.status === "ACTIVE" && isBuy ? "bg-emerald-500/10"
        : s.status === "ACTIVE" && !isBuy ? "bg-rose-500/10"
        : "bg-white/[0.02]"
      }`}>
        <span className={`font-mono font-bold text-sm ${sm.cls.includes("sky") ? "text-sky-300" : sm.cls.includes("emerald") ? "text-emerald-300" : sm.cls.includes("rose") ? "text-rose-300" : "text-slate-300"}`}>
          {sm.label}
        </span>
        <span className="text-slate-500">{timeAgo(s.createdAt)}</span>
      </div>

      {/* Body */}
      <div className="flex-1 p-4">
        {/* Symbol + Direction */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-xl font-bold tracking-tight">{s.symbol}</p>
            {s.direction && (
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${
                  isBuy
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {isBuy ? "▲ BUY" : "▼ SELL"}
              </span>
            )}
          </div>
          {rr && (
            <div className="text-right">
              <p className="text-xs text-slate-500">Risk/Reward</p>
              <p className="font-mono text-lg font-bold text-white">1 : {rr}</p>
            </div>
          )}
        </div>

        {/* Price Grid */}
        {hasPrice && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <PriceCell
              label="Kirish"
              value={s.entryPrice!}
              sub={null}
              color="white"
            />
            <PriceCell
              label="Take Profit"
              value={s.takeProfit!}
              sub={tpPct}
              color="emerald"
            />
            <PriceCell
              label="Stop Loss"
              value={s.stopLoss!}
              sub={slPct}
              color="rose"
            />
          </div>
        )}

        {/* Confidence bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">AI ishonch darajasi</span>
            <span className={`font-bold ${confText}`}>{confidence}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full transition-all ${confColor}`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>

        {/* Result PnL */}
        {s.resultPnlPct != null && (
          <div
            className={`mt-4 flex items-center justify-between rounded-xl px-3 py-2.5 ${
              s.resultPnlPct >= 0
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-rose-500/10 text-rose-300"
            }`}
          >
            <span className="text-sm font-medium">Natija</span>
            <span className="font-mono text-lg font-bold">
              {s.resultPnlPct >= 0 ? "+" : ""}
              {s.resultPnlPct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* AI Analysis — collapsible */}
        {s.analysis && (
          <div className="mt-4">
            <button
              onClick={onToggle}
              className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-400 hover:text-white"
            >
              <span>🤖 AI tahlili</span>
              <span>{expanded ? "▲ Yig'ish" : "▼ Ko'rish"}</span>
            </button>
            {expanded && (
              <p className="mt-2 rounded-xl bg-white/5 px-3 py-3 text-sm leading-relaxed text-slate-300">
                {s.analysis}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 px-4 py-2.5 text-xs text-slate-500">
        {new Date(s.createdAt).toLocaleString("uz-UZ")}
        {s.closedAt && (
          <span> → {new Date(s.closedAt).toLocaleString("uz-UZ")}</span>
        )}
      </div>
    </div>
  );
}

function PriceCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub: string | null;
  color: "white" | "emerald" | "rose";
}) {
  const textColor =
    color === "emerald" ? "text-emerald-300"
    : color === "rose" ? "text-rose-300"
    : "text-white";
  const subColor =
    color === "emerald" ? "text-emerald-400/70"
    : color === "rose" ? "text-rose-400/70"
    : "text-slate-400";

  return (
    <div className="rounded-xl bg-white/5 px-2.5 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${textColor}`}>
        {value.toLocaleString()}
      </p>
      {sub && <p className={`text-xs ${subColor}`}>{sub}</p>}
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
  big,
}: {
  label: string;
  value: string | number;
  color: "slate" | "sky" | "emerald" | "rose" | "amber";
  big?: boolean;
}) {
  const cls: Record<string, string> = {
    slate:   "text-slate-200",
    sky:     "text-sky-300",
    emerald: "text-emerald-300",
    rose:    "text-rose-300",
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
