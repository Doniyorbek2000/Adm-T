/**
 * Savdo natijalarining professional statistikasi — treyder o'z natijasini
 * baholaydigan haqiqiy ko'rsatkichlar: equity curve, maksimal drawdown,
 * profit factor, kutilma (expectancy), Sharpe koeffitsienti, oylik PnL.
 *
 * Sof (pure) modul: DB yoki tarmoqqa bog'lanmagan, to'liq test qilinadi.
 */

export interface ClosedTradeInput {
  closedAt: Date;
  pnlUsd: number;
  feeUsd?: number | null;
  symbol: string;
  direction: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface MonthlyPnl {
  month: string; // "2026-06"
  pnlUsd: number;
  trades: number;
}

export interface SymbolBreakdown {
  symbol: string;
  trades: number;
  pnlUsd: number;
  winRatePct: number;
}

export interface PerformanceStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsd: number;
  totalFeesUsd: number;
  profitFactor: number | null;
  avgWinUsd: number;
  avgLossUsd: number;
  /** O'rtacha kutilma: har bir savdodan kutiladigan natija (USD) */
  expectancyUsd: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  /** Yillashtirilgan Sharpe (kunlik daromadlardan); ma'lumot kam bo'lsa null */
  sharpeRatio: number | null;
  startingCapitalUsd: number;
  equityCurve: EquityPoint[];
  monthly: MonthlyPnl[];
  bySymbol: SymbolBreakdown[];
}

export function computePerformance(
  trades: ClosedTradeInput[],
  currentBalanceUsd: number,
  maxCurvePoints = 300
): PerformanceStats {
  const sorted = [...trades].sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  const totalPnlUsd = sorted.reduce((s, t) => s + t.pnlUsd, 0);
  const totalFeesUsd = sorted.reduce((s, t) => s + (t.feeUsd ?? 0), 0);

  // Boshlang'ich kapital: hozirgi balansdan yig'ilgan PnL ayirilgan qiymat
  // (statistika uchun asos; salbiy chiqsa 1 bilan himoyalanadi)
  const startingCapitalUsd = Math.max(1, currentBalanceUsd - totalPnlUsd);

  const wins = sorted.filter((t) => t.pnlUsd > 0);
  const losses = sorted.filter((t) => t.pnlUsd < 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  // Equity curve va drawdown
  const equityCurve: EquityPoint[] = [];
  let equity = startingCapitalUsd;
  let peak = startingCapitalUsd;
  let maxDdUsd = 0;
  let maxDdPct = 0;

  for (const t of sorted) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    const ddUsd = peak - equity;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;
    const ddPct = peak > 0 ? (ddUsd / peak) * 100 : 0;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
    equityCurve.push({ time: t.closedAt.getTime(), equity: Number(equity.toFixed(2)) });
  }

  // Sharpe: kunlik PnL -> kunlik daromad (boshlang'ich kapitalga nisbatan)
  const dailyPnl = new Map<string, number>();
  for (const t of sorted) {
    const day = t.closedAt.toISOString().slice(0, 10);
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + t.pnlUsd);
  }
  let sharpeRatio: number | null = null;
  if (dailyPnl.size >= 5) {
    const returns = [...dailyPnl.values()].map((p) => p / startingCapitalUsd);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    sharpeRatio = std > 0 ? Number(((mean / std) * Math.sqrt(365)).toFixed(2)) : null;
  }

  // Oylik PnL
  const monthlyMap = new Map<string, { pnlUsd: number; trades: number }>();
  for (const t of sorted) {
    const month = t.closedAt.toISOString().slice(0, 7);
    const cur = monthlyMap.get(month) ?? { pnlUsd: 0, trades: 0 };
    cur.pnlUsd += t.pnlUsd;
    cur.trades += 1;
    monthlyMap.set(month, cur);
  }
  const monthly: MonthlyPnl[] = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, pnlUsd: Number(v.pnlUsd.toFixed(2)), trades: v.trades }));

  // Simvollar kesimida
  const symbolMap = new Map<string, { trades: number; pnlUsd: number; wins: number }>();
  for (const t of sorted) {
    const cur = symbolMap.get(t.symbol) ?? { trades: 0, pnlUsd: 0, wins: 0 };
    cur.trades += 1;
    cur.pnlUsd += t.pnlUsd;
    if (t.pnlUsd > 0) cur.wins += 1;
    symbolMap.set(t.symbol, cur);
  }
  const bySymbol: SymbolBreakdown[] = [...symbolMap.entries()]
    .map(([symbol, v]) => ({
      symbol,
      trades: v.trades,
      pnlUsd: Number(v.pnlUsd.toFixed(2)),
      winRatePct: Number(((v.wins / v.trades) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd);

  return {
    totalTrades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: sorted.length > 0 ? Number(((wins.length / sorted.length) * 100).toFixed(1)) : 0,
    totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
    totalFeesUsd: Number(totalFeesUsd.toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : null,
    avgWinUsd: wins.length > 0 ? Number((grossProfit / wins.length).toFixed(2)) : 0,
    avgLossUsd: losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    expectancyUsd: sorted.length > 0 ? Number((totalPnlUsd / sorted.length).toFixed(2)) : 0,
    bestTradeUsd: sorted.length > 0 ? Number(Math.max(...sorted.map((t) => t.pnlUsd)).toFixed(2)) : 0,
    worstTradeUsd: sorted.length > 0 ? Number(Math.min(...sorted.map((t) => t.pnlUsd)).toFixed(2)) : 0,
    maxDrawdownUsd: Number(maxDdUsd.toFixed(2)),
    maxDrawdownPct: Number(maxDdPct.toFixed(2)),
    sharpeRatio,
    startingCapitalUsd: Number(startingCapitalUsd.toFixed(2)),
    equityCurve: downsample(equityCurve, maxCurvePoints),
    monthly,
    bySymbol,
  };
}

function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  result[result.length - 1] = points[points.length - 1];
  return result;
}
