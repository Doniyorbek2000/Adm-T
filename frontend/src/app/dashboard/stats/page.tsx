"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface EquityPoint { time: number; equity: number }
interface MonthlyPnl { month: string; pnlUsd: number; trades: number }
interface SymbolBreakdown { symbol: string; trades: number; pnlUsd: number; winRatePct: number }

interface PerformanceDto {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsd: number;
  totalFeesUsd: number;
  profitFactor: number | null;
  avgWinUsd: number;
  avgLossUsd: number;
  expectancyUsd: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
  startingCapitalUsd: number;
  equityCurve: EquityPoint[];
  monthly: MonthlyPnl[];
  bySymbol: SymbolBreakdown[];
}

const POS = "#34d399"; // foyda (emerald-400)
const NEG = "#fb7185"; // zarar (rose-400)

function fmtUsd(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}$`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function StatsPage() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const [perf, setPerf] = useState<PerformanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest<{ performance: PerformanceDto }>("/trades/performance", { token })
      .then((d) => setPerf(d.performance))
      .catch((e) => setError(e.message));
  }, [token]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("stats.title")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("stats.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {perf && perf.totalTrades === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-slate-400">
          {t("stats.empty")}
        </div>
      )}

      {perf && perf.totalTrades > 0 && (
        <>
          {/* Asosiy ko'rsatkichlar */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t("stats.totalPnl")} value={fmtUsd(perf.totalPnlUsd)} positive={perf.totalPnlUsd >= 0} />
            <StatTile label={t("stats.winRate")} value={`${perf.winRatePct}%`} sub={`${perf.wins}W / ${perf.losses}L · ${perf.totalTrades} ${t("stats.tradesSuffix")}`} />
            <StatTile label={t("stats.profitFactor")} value={perf.profitFactor === null ? "—" : String(perf.profitFactor)} sub={t("stats.profitFactorHint")} />
            <StatTile label={t("stats.maxDrawdown")} value={`−${perf.maxDrawdownPct}%`} sub={`−$${perf.maxDrawdownUsd.toLocaleString()}`} positive={false} />
            <StatTile label={t("stats.expectancy")} value={fmtUsd(perf.expectancyUsd)} positive={perf.expectancyUsd >= 0} sub={t("stats.expectancyHint")} />
            <StatTile label={t("stats.sharpe")} value={perf.sharpeRatio === null ? "—" : String(perf.sharpeRatio)} sub={t("stats.sharpeHint")} />
            <StatTile label={t("stats.avgWinLoss")} value={`${fmtUsd(perf.avgWinUsd)} / −$${perf.avgLossUsd}`} />
            <StatTile label={t("stats.fees")} value={`−$${perf.totalFeesUsd.toLocaleString()}`} />
          </div>

          {/* Equity curve */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold">{t("stats.equityTitle")}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {t("stats.equityStart")}: ${perf.startingCapitalUsd.toLocaleString()}
            </p>
            <EquityChart points={perf.equityCurve} baseline={perf.startingCapitalUsd} />
          </div>

          {/* Oylik PnL */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold">{t("stats.monthlyTitle")}</h2>
            <MonthlyBars data={perf.monthly} />
          </div>

          {/* Simvollar kesimida */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="mb-4 text-lg font-semibold">{t("stats.bySymbolTitle")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                    <th className="pb-2 pr-4 font-medium">{t("stats.colSymbol")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("stats.colTrades")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("stats.colWinRate")}</th>
                    <th className="pb-2 font-medium">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.bySymbol.map((s) => (
                    <tr key={s.symbol} className="border-b border-white/[0.04]">
                      <td className="py-2.5 pr-4 font-semibold">{s.symbol}</td>
                      <td className="py-2.5 pr-4 text-slate-300">{s.trades}</td>
                      <td className="py-2.5 pr-4 text-slate-300">{s.winRatePct}%</td>
                      <td className={`py-2.5 font-semibold ${s.pnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {fmtUsd(s.pnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === undefined ? "text-slate-100" : positive ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/* ── Equity curve: bitta seriya, 2px chiziq, hover crosshair + tooltip ─────── */
function EquityChart({ points, baseline }: { points: EquityPoint[]; baseline: number }) {
  const W = 800;
  const H = 260;
  const PAD = { top: 16, right: 16, bottom: 28, left: 64 };
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { path, areaPath, xOf, yOf, yTicks, minY, maxY } = useMemo(() => {
    const values = points.map((p) => p.equity).concat([baseline]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-9) { max = min + 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;

    const t0 = points[0]?.time ?? 0;
    const t1 = points[points.length - 1]?.time ?? 1;
    const xOf = (t: number) =>
      PAD.left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right) : 0);
    const yOf = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.time).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(" ");
    const areaPath = points.length > 1
      ? `${path} L${xOf(t1).toFixed(1)},${H - PAD.bottom} L${xOf(t0).toFixed(1)},${H - PAD.bottom} Z`
      : "";

    const yTicks: number[] = [];
    for (let i = 0; i <= 3; i++) yTicks.push(min + ((max - min) * i) / 3);

    return { path, areaPath, xOf, yOf, yTicks, minY: min, maxY: max };
  }, [points, baseline]);

  if (points.length === 0) return null;

  const hovered = hover !== null ? points[hover] : null;
  const lineColor = points[points.length - 1].equity >= baseline ? POS : NEG;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(xOf(p.time) - px);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHover(best);
  }

  return (
    <div className="relative mt-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Equity curve"
      >
        {/* recessive grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yOf(v) + 4} textAnchor="end" fontSize={11} fill="rgba(148,163,184,0.8)">
              ${Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}
        {/* boshlang'ich kapital chizig'i */}
        <line x1={PAD.left} x2={W - PAD.right} y1={yOf(baseline)} y2={yOf(baseline)}
          stroke="rgba(148,163,184,0.45)" strokeWidth={1} strokeDasharray="4 4" />

        {areaPath && <path d={areaPath} fill={lineColor} opacity={0.08} />}
        <path d={path} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hovered && (
          <g>
            <line x1={xOf(hovered.time)} x2={xOf(hovered.time)} y1={PAD.top} y2={H - PAD.bottom}
              stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <circle cx={xOf(hovered.time)} cy={yOf(hovered.equity)} r={4.5}
              fill={lineColor} stroke="#0f172a" strokeWidth={2} />
          </g>
        )}

        {/* x-axis chetki sanalar */}
        <text x={PAD.left} y={H - 8} fontSize={11} fill="rgba(148,163,184,0.8)">{fmtDate(points[0].time)}</text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize={11} fill="rgba(148,163,184,0.8)">
          {fmtDate(points[points.length - 1].time)}
        </text>
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -top-2 rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: `${(xOf(hovered.time) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="text-slate-400">{fmtDate(hovered.time)}</p>
          <p className="font-semibold text-slate-100">${hovered.equity.toLocaleString()}</p>
          <p className={hovered.equity >= baseline ? "text-emerald-400" : "text-rose-400"}>
            {fmtUsd(hovered.equity - baseline)}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Oylik PnL: nol chiziqdan yuqoriga (foyda) / pastga (zarar) barlar ──────── */
function MonthlyBars({ data }: { data: MonthlyPnl[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;

  const W = 800;
  const H = 220;
  const PAD = { top: 24, right: 16, bottom: 28, left: 16 };
  const maxAbs = Math.max(...data.map((m) => Math.abs(m.pnlUsd)), 1);
  const zeroY = PAD.top + (H - PAD.top - PAD.bottom) / 2;
  const halfH = (H - PAD.top - PAD.bottom) / 2;
  const slot = (W - PAD.left - PAD.right) / data.length;
  const barW = Math.min(48, Math.max(8, slot - 8));

  return (
    <div className="relative mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly PnL">
        {/* nol chiziq */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="rgba(148,163,184,0.35)" strokeWidth={1} />

        {data.map((m, i) => {
          const h = (Math.abs(m.pnlUsd) / maxAbs) * (halfH - 4);
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const positive = m.pnlUsd >= 0;
          const y = positive ? zeroY - h : zeroY;
          const monthLabel = m.month.slice(2).replace("-", "/");
          return (
            <g key={m.month}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* katta hit-target */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} fill="transparent" />
              <rect
                x={x} y={y} width={barW} height={Math.max(2, h)}
                rx={4}
                fill={positive ? POS : NEG}
                opacity={hover === null || hover === i ? 0.9 : 0.45}
              />
              {/* ishorali qiymat — bar uchida (rang emas, matn ishora tashiydi) */}
              <text
                x={x + barW / 2}
                y={positive ? y - 6 : y + h + 14}
                textAnchor="middle" fontSize={11} fontWeight={600}
                fill="rgba(226,232,240,0.9)"
              >
                {fmtUsd(m.pnlUsd)}
              </text>
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(148,163,184,0.8)">
                {monthLabel}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-900/95 px-3 py-1.5 text-xs shadow-xl">
          <span className="text-slate-400">{data[hover].month}:</span>{" "}
          <span className={data[hover].pnlUsd >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-rose-400"}>
            {fmtUsd(data[hover].pnlUsd)}
          </span>{" "}
          <span className="text-slate-500">({data[hover].trades} savdo)</span>
        </div>
      )}
    </div>
  );
}
