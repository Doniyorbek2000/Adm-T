import { analyzeCandles, Candle, fetchCandlesRange } from "./technicalAnalysis";

/**
 * Backtest mexanizmi — jonli AI strategiyasining AYNAN O'ZI (analyzeCandles)
 * tarixiy shamlar ustida yuritiladi va natijalar halol hisoblanadi:
 *
 *  - Komissiya: har tomonga 0.1% (Binance spot standart)
 *  - Slippage: kirishda va SL (stop-market) chiqishida 0.05%;
 *    TP limit buyurtma bo'lgani uchun slippage'siz
 *  - Konservativ qoida: bitta shamda ham TP, ham SL diapazonga tushsa,
 *    SL birinchi ishlagan deb hisoblanadi (yomon stsenariy)
 *  - Pozitsiya o'lchami jonli risk-menejment bilan bir xil:
 *    risk% / SL_masofa, balansning 25% dan oshmaydi
 *
 * Bu modul foydalanuvchiga strategiyaning REAL tarixiy natijasini ko'rsatish
 * uchun — bo'rttirilgan "ishonch foizi" o'rniga o'lchanadigan statistika.
 */

export interface BacktestOptions {
  /** Har tomonga komissiya (fraktsiya, 0.001 = 0.1%) */
  feePerSide: number;
  /** Kirish va stop-chiqishdagi slippage (fraktsiya) */
  slippagePerSide: number;
  /** Pozitsiya maksimal shu sham soni davomida ochiq turadi (48 = 1h da 48 soat) */
  maxHoldBars: number;
  /** Bitta savdodagi risk (kapital fraktsiyasi) */
  riskPerTradeFraction: number;
  /** Pozitsiya kapitalning shu ulushidan oshmaydi */
  maxPositionFraction: number;
}

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  feePerSide: 0.001,
  slippagePerSide: 0.0005,
  maxHoldBars: 48,
  riskPerTradeFraction: 0.01,
  maxPositionFraction: 0.25,
};

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  direction: "BUY" | "SELL";
  confidence: number;
  entryPrice: number;
  exitPrice: number;
  /** Pozitsiyaga nisbatan sof natija (komissiya/slippage hisobga olingan), % */
  pnlPct: number;
  /** Kapitalga ta'siri, % */
  equityImpactPct: number;
  outcome: "TP" | "SL" | "EXPIRED";
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  fromTime: number;
  toTime: number;
  candlesAnalyzed: number;
  totalTrades: number;
  wins: number;
  losses: number;
  expired: number;
  winRatePct: number;
  profitFactor: number | null;
  totalReturnPct: number;
  maxDrawdownPct: number;
  avgTradePnlPct: number;
  trades: BacktestTrade[];
  /** Kapital egri chizig'i (boshlang'ich 100 dan), grafik uchun siyraklashtirilgan */
  equityCurve: { time: number; equity: number }[];
}

const WARMUP_BARS = 60;
const ANALYSIS_WINDOW = 200;

/** Sof backtest — berilgan shamlar ustida strategiyani yuritadi (tarmoqsiz, test qilinadi) */
export function runBacktest(
  symbol: string,
  interval: string,
  candles: Candle[],
  options: Partial<BacktestOptions> = {}
): BacktestResult {
  const opts: BacktestOptions = { ...DEFAULT_BACKTEST_OPTIONS, ...options };

  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  let equity = 100;
  let peakEquity = 100;
  let maxDrawdownPct = 0;

  let i = WARMUP_BARS;
  while (i < candles.length - 1) {
    const window = candles.slice(Math.max(0, i - ANALYSIS_WINDOW + 1), i + 1);
    const signal = analyzeCandles(window);

    if (!signal || signal.direction === "HOLD") {
      i++;
      continue;
    }

    const isBuy = signal.direction === "BUY";
    const rawEntry = candles[i].close;
    // Kirish slippage: BUY qimmatroqqa, SELL arzonroqqa to'ldiriladi
    const entryPrice = isBuy ? rawEntry * (1 + opts.slippagePerSide) : rawEntry * (1 - opts.slippagePerSide);
    const tp = signal.takeProfit;
    const sl = signal.stopLoss;

    // Pozitsiya o'lchami — jonli risk-menejment bilan bir xil formula
    const slDistanceFraction = Math.abs(entryPrice - sl) / entryPrice;
    if (slDistanceFraction < 0.001) {
      i++;
      continue;
    }
    const positionFraction = Math.min(opts.riskPerTradeFraction / slDistanceFraction, opts.maxPositionFraction);

    // Oldinga yurish: TP/SL/muddat
    let exitPrice: number | null = null;
    let outcome: "TP" | "SL" | "EXPIRED" = "EXPIRED";
    let exitIndex = Math.min(i + opts.maxHoldBars, candles.length - 1);

    for (let j = i + 1; j <= Math.min(i + opts.maxHoldBars, candles.length - 1); j++) {
      const bar = candles[j];
      if (isBuy) {
        // Konservativ: avval SL tekshiriladi (bitta shamda ikkalasi tegsa — SL)
        if (bar.low <= sl) {
          exitPrice = sl * (1 - opts.slippagePerSide); // stop-market slippage
          outcome = "SL";
          exitIndex = j;
          break;
        }
        if (bar.high >= tp) {
          exitPrice = tp; // limit buyurtma — slippage yo'q
          outcome = "TP";
          exitIndex = j;
          break;
        }
      } else {
        if (bar.high >= sl) {
          exitPrice = sl * (1 + opts.slippagePerSide);
          outcome = "SL";
          exitIndex = j;
          break;
        }
        if (bar.low <= tp) {
          exitPrice = tp;
          outcome = "TP";
          exitIndex = j;
          break;
        }
      }
    }

    if (exitPrice === null) {
      // Muddat tugadi — oxirgi shamning yopilish narxida chiqamiz
      exitPrice = candles[exitIndex].close;
      outcome = "EXPIRED";
    }

    const grossPct = isBuy
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;
    const feePct = opts.feePerSide * 2 * 100;
    const netPct = grossPct - feePct;

    const equityImpactPct = netPct * positionFraction;
    equity *= 1 + equityImpactPct / 100;

    peakEquity = Math.max(peakEquity, equity);
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);

    trades.push({
      entryTime: candles[i].time,
      exitTime: candles[exitIndex].time,
      direction: signal.direction,
      confidence: signal.confidence,
      entryPrice: Number(entryPrice.toFixed(8)),
      exitPrice: Number(exitPrice.toFixed(8)),
      pnlPct: Number(netPct.toFixed(3)),
      equityImpactPct: Number(equityImpactPct.toFixed(3)),
      outcome,
    });
    equityCurve.push({ time: candles[exitIndex].time, equity: Number(equity.toFixed(3)) });

    // Bir vaqtda bitta pozitsiya — chiqish shamidan davom etamiz
    i = exitIndex + 1;
  }

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const losses = trades.filter((t) => t.pnlPct <= 0 && t.outcome !== "EXPIRED").length;
  const expired = trades.filter((t) => t.outcome === "EXPIRED").length;

  const grossProfit = trades.filter((t) => t.equityImpactPct > 0).reduce((s, t) => s + t.equityImpactPct, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.equityImpactPct < 0).reduce((s, t) => s + t.equityImpactPct, 0));

  return {
    symbol,
    interval,
    fromTime: candles[0]?.time ?? 0,
    toTime: candles[candles.length - 1]?.time ?? 0,
    candlesAnalyzed: candles.length,
    totalTrades: trades.length,
    wins,
    losses,
    expired,
    winRatePct: trades.length > 0 ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : null,
    totalReturnPct: Number((equity - 100).toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    avgTradePnlPct:
      trades.length > 0 ? Number((trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length).toFixed(3)) : 0,
    trades: trades.slice(-50), // javob hajmini cheklash — oxirgi 50 savdo
    equityCurve: downsample(equityCurve, 200),
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

/* ─── Keshlangan tarmoqli backtest ──────────────────────────────────────────── */

const INTERVAL_MS: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

const cache = new Map<string, { result: BacktestResult; computedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 soat

/** Tarixiy ma'lumotni yuklab, keshlangan backtest natijasini qaytaradi */
export async function backtestSymbol(
  symbol: string,
  interval: "15m" | "1h" | "4h",
  days: number
): Promise<BacktestResult> {
  const cacheKey = `${symbol}:${interval}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) return cached.result;

  const endTime = Date.now();
  // Warmup uchun qo'shimcha shamlar ham yuklaymiz
  const startTime = endTime - days * 24 * 60 * 60 * 1000 - ANALYSIS_WINDOW * INTERVAL_MS[interval];

  const candles = await fetchCandlesRange(symbol, interval, startTime, endTime);
  if (candles.length < WARMUP_BARS + 10) {
    throw new Error(`${symbol} uchun yetarli tarixiy ma'lumot topilmadi (${candles.length} sham)`);
  }

  const result = runBacktest(symbol, interval, candles);
  cache.set(cacheKey, { result, computedAt: Date.now() });
  return result;
}
