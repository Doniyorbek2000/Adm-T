# ADM Trading — loyiha qoʻllanmasi (Claude Code uchun)

Shaxsiy avtonom AI kripto-savdo platformasi: backend (Express + Prisma/SQLite +
AI savdo dvigateli) va frontend (Next.js). AI oʻzi tahlil qiladi, risk hisoblaydi,
BUY/SELL ochadi, kuzatadi va yopadi.

## Ishga tushirish (lokal, testnet)

Ikkita alohida terminal kerak:

```bash
# Terminal 1 — backend (API + AI dvigatel, port 4000)
cd backend
npm install                 # birinchi marta
npx prisma migrate dev      # birinchi marta (DATABASE_URL=file:./dev.db)
npm run seed                # birinchi marta (admin + tariflar)
npm run dev

# Terminal 2 — frontend (port 3000)
cd frontend
npm install                 # birinchi marta
npm run dev
```

Sayt: http://localhost:3000 — standart admin: `admin@admtrading.uz` / `Admin123!`
(env orqali o'zgartiriladi). Toʻliq bosqichma-bosqich yoʻriqnoma: `ISHGA_TUSHIRISH.md`.
VPS'ga joylashtirish: `DEPLOY.md`.

## Muhim buyruqlar

| Buyruq | Qayerda | Nima |
|---|---|---|
| `npm run dev` | backend | API + AI dvigatel (tsx watch) |
| `npm test` | backend | Vitest — 66 test, hammasi yashil boʻlishi shart |
| `npm run build` | backend/frontend | Production build |
| `npx prisma migrate dev` | backend | Sxema oʻzgarganda migratsiya |

## Arxitektura (qisqa xarita)

- `backend/src/services/aiEngine.ts` — asosiy sikl: signal yaratish, avto-savdo,
  pozitsiyalarni boshqarish (break-even/trailing), yopish, watchdog, kunlik hisobot.
- `backend/src/services/technicalAnalysis.ts` — sof indikatorlar (RSI, MACD, EMA,
  BB, ADX, Stochastic, ATR) + 4h trend konteksti. `analyzeCandles` — pure, backtest
  ham aynan shuni ishlatadi.
- `backend/src/services/riskManager.ts` — pozitsiya oʻlchami (SL masofasiga
  asoslangan), kunlik zarar limiti, maksimal pozitsiyalar, trailing-stop matematikasi.
- `backend/src/services/marketContext.ts` — Fear&Greed, BTC-crash himoyasi, funding.
- `backend/src/services/exchanges/` — Binance spot (OCO himoya), Binance futures
  (short + birja tomonidagi TP/SL), Bybit/OKX/KuCoin/BingX/MT5 adapterlari.
- `backend/src/services/backtest.ts` — tarixiy sinov; `performance.ts` — statistika.
- `frontend/src/app/dashboard/` — foydalanuvchi paneli; `admin/` — admin + kill-switch.

## Qat'iy qoidalar

- **Pul mantigʻiga tegishda ehtiyot boʻling**: aiEngine/riskManager oʻzgarishlarida
  avval testlarni yozing/yangilang (`backend/src/services/__tests__/`).
- AI dvigatel **bitta nusxada** ishlashi shart (PM2'da `instances: 1`) — ikki nusxa
  ikki marta savdo ochadi.
- `EXCHANGE_MODE=testnet` (standart) — xavfsiz sinov; `live` — REAL pul. Zaif
  JWT_SECRET/ENCRYPTION_KEY bilan live rejim ataylab ishga tushmaydi.
- `ENCRYPTION_KEY` ni real maʼlumotlar paydo boʻlgach OʻZGARTIRMANG — shifrlangan
  API kalitlar oʻqib boʻlmas holga keladi.
- Binance geo-blok (HTTP 451) boʻlsa: `BINANCE_PUBLIC_API=https://data-api.binance.vision`.
- Izohlar va foydalanuvchi matnlari oʻzbek tilida — shu uslubni saqlang.
