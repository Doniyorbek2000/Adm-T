# ADM Trading

AI yordamida avtomatik treding qiluvchi platforma. Sun'iy intellekt bozorni 24/7 tahlil qiladi,
savdo signallari generatsiya qiladi va xohlovchi foydalanuvchilar uchun savdoni to'liq mustaqil
(odam ishtirokisiz) amalga oshiradi.

## Tuzilma

- `backend/` — Node.js + Express + TypeScript + Prisma (SQLite) REST API va AI dvigateli
- `frontend/` — Next.js (App Router) + TypeScript + Tailwind CSS — foydalanuvchi sayti, boshqaruv paneli va admin panel

## Asosiy imkoniyatlar

- **Ro'yxatdan o'tish / kirish** — JWT asosida autentifikatsiya
- **Broker hisobini ulash** — foydalanuvchi birja API kalitlarini ulaydi (shifrlangan saqlanadi);
  ulamagan foydalanuvchilar uchun avtomatik ravishda virtual ($10,000) Demo hisob taklif etiladi
- **Ikki rejim**: "Faqat signal" (foydalanuvchi o'zi savdo qiladi) yoki "To'liq avto-treding"
  (AI hammasini mustaqil bajaradi — faqat ULTRA/VIP tariflarida)
- **AI dvigateli** (`backend/src/services/aiEngine.ts`) — fonda muntazam ishlab, signal generatsiya
  qiladi, faol signallarni TP/SL bo'yicha yopadi va AUTO_TRADE rejimidagi hisoblar uchun
  avtomatik savdo ochib-yopadi
- **Tariflar**: Bepul / Pro / Ultra / VIP — har birida turli signal kechikishi, broker hisoblari
  soni va avto-treding huquqi
- **To'lov / obuna oqimi** — oylik obuna (simulyatsiya qilingan to'lov, real shlyuz keyinchalik ulanadi)
- **Admin panel** — foydalanuvchilarni boshqarish (bloklash, tarif o'zgartirish), AI signallarini
  nazorat qilish, tarif rejalarini tahrirlash, savdolar monitoringi, umumiy statistika

## Ishga tushirish

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev   # ma'lumotlar bazasini yaratadi va seed qiladi
npm run dev              # http://localhost:4000
```

Standart admin login: `.env` dagi `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default: `admin@admtrading.uz` / `Admin123!`)

### Frontend

```bash
cd frontend
npm install
npm run dev              # http://localhost:3000
```

`.env.local` faylida `NEXT_PUBLIC_API_URL` backend manzilini ko'rsatadi (default: `http://localhost:4000/api`).
