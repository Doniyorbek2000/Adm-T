# Kompyuterda ishga tushirish (testnet — bepul sinov)

Bu yoʻriqnoma platformani oʻz kompyuteringizda, Binance TESTNET (sunʼiy pul)
bilan ishga tushirishni koʻrsatadi. Hech qanday xarajat va risk yoʻq.

> Tezkor yoʻl (Windows): 1–2-qadamdan keyin `start-local.bat` faylini ikki marta
> bosing — u ikkala serverni oʻzi ochadi. Birinchi martada baribir 3-qadamdagi
> `npm install`/migratsiya buyruqlarini bir marta bajarish kerak.

## 1. Dasturlarni oʻrnating (bir marta)

1. **Node.js 22 LTS** — https://nodejs.org ("LTS" tugmasi, hammasi Next-Next).
2. **Git** — https://git-scm.com/download/win

Tekshirish (PowerShell oching: Start → "powershell"):

```powershell
node -v     # v22.x
git -v
```

## 2. Loyihani yuklab oling

```powershell
cd $HOME\Desktop
git clone https://github.com/Doniyorbek2000/Adm-T.git
cd Adm-T
```

## 3. Backend — AI dvigatel (birinchi marta)

```powershell
cd backend
npm install
copy .env.example .env
npx prisma migrate dev
npm run seed
npm run dev
```

Oxirida `AI Engine ishga tushdi (birja rejimi: TESTNET)` chiqadi — **bu oynani
yopmang**, AI shu yerda ishlaydi.

`.env` ga testnet uchun tegish shart emas — standart sozlamalar yetarli.

## 4. Frontend — sayt (yangi PowerShell oynasi)

```powershell
cd $HOME\Desktop\Adm-T\frontend
npm install
npm run dev
```

Brauzerda: **http://localhost:3000**
Kirish: `admin@admtrading.uz` / `Admin123!`

## 5. Testnet API kaliti (bepul sunʼiy $10,000)

1. https://testnet.binance.vision → **Log In with GitHub**
2. **Generate HMAC_SHA256 Key** → API Key + Secret chiqadi.
   Bu SINOV kaliti — real pulga hech qanday aloqasi yoʻq.
3. Saytda: **My accounts → Yangi hisob ulash** → Binance → **Spot** →
   kalitlarni kiriting → rejim: **AUTO_TRADE**, risk: **2 (oʻrta)**.

Tayyor — endi AI mustaqil ishlaydi.

## 6. Nimani kuzatish

| Qayerda | Nima |
|---|---|
| **AI signals** sahifasi | Topilgan signallar (sabablari bilan) |
| **Trade history** | Ochilgan/yopilgan savdolar, jonli PnL |
| **Statistics** | Win-rate, profit factor, equity curve (savdolar yigʻilgach) |
| Backend oynasi | Dvigatelning har bir qarori (loglar) |

**Bilib qoʻying:**
- Signal kuniga **0–3 ta** chiqadi — "Bu siklda kuchli signal topilmadi" degan
  log normal holat, filtrlar ishlayapti degani.
- AI faqat kompyuter yoniq va backend oynasi ochiq boʻlganda ishlaydi.
  24/7 uchun keyinroq VPS'ga oʻting (`DEPLOY.md`).
- Telegram xabarnomalarini xohlasangiz: `.env` ga `TELEGRAM_BOT_TOKEN` va
  `TELEGRAM_CHAT_ID` qoʻshing (BotFather'dan olinadi) va backend'ni qayta ishga
  tushiring.

## Muammolar

| Belgi | Yechim |
|---|---|
| `HTTP 451` yoki `403` loglarda | `.env` ga qoʻshing: `BINANCE_PUBLIC_API="https://data-api.binance.vision"` va backend'ni qayta ishga tushiring |
| `port 4000 already in use` | Eski backend oynasi ochiq — uni yoping |
| Sayt ochiladi, maʼlumot kelmaydi | Backend oynasi ishlayaptimi tekshiring (3-qadam) |
| `prisma migrate` xatosi | `backend` papkasida ekaningizni tekshiring |

## Keyingi qadam (1–2 haftadan soʻng)

Statistics sahifasida natijani baholang: profit factor > 1.3 va chidasa
boʻladigan drawdown boʻlsa — `DEPLOY.md` boʻyicha VPS'ga oʻtkazib, real (live)
rejimga kichik summa ($150–200) va risk 1 bilan oʻtishingiz mumkin.
