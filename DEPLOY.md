# ADM Trading — VPS'ga joylashtirish yoʻriqnomasi

Bu yoʻriqnoma platformani (backend API + AI savdo dvigateli + frontend) bitta
VPS serverga, HTTPS domen bilan, 24/7 ishlaydigan qilib joylashtirishni bosqichma-bosqich
koʻrsatadi. Har bir buyruqni ketma-ket bajaring.

---

## 0. Nima kerak boʻladi

| Narsa | Tavsiya |
|---|---|
| VPS | 2 vCPU, 2–4 GB RAM, 40 GB SSD, **Ubuntu 22.04/24.04** (Hetzner, DigitalOcean, Vultr, Contabo — istalgani) |
| Domen | masalan `trading.example.com` — A yozuvi VPS IP'ga koʻrsatilgan |
| Binance API kalit | Withdrawal **OʻCHIRILGAN**, Spot (+ kerak boʻlsa Futures) yoqilgan |
| Telegram bot (ixtiyoriy) | @BotFather'dan token |

> **Muhim tanlov — server joylashuvi:** Binance ayrim mintaqalarni (masalan, AQSH
> IP'larini) bloklaydi. Yevropa (Germaniya, Finlyandiya, Niderlandiya) yoki Osiyo
> (Singapur, Yaponiya) datamarkazlarini tanlang. AQSH regionini TANLAMANG.

---

## 1. Serverni tayyorlash (root sifatida bir marta)

```bash
# Tizimni yangilash
apt update && apt upgrade -y

# Alohida foydalanuvchi yaratish (root'da servis ishlatmaymiz)
adduser adm --gecos "" # parol so'raydi
usermod -aG sudo adm

# Firewall: faqat SSH, HTTP, HTTPS ochiq
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# SSH'ni qo'pol hujumlardan himoyalash
apt install -y fail2ban
systemctl enable --now fail2ban
```

Shu yerdan boshlab **`adm` foydalanuvchisi bilan** ishlang: `su - adm`

---

## 2. Node.js 22 va kerakli vositalar

```bash
# Node.js 22 LTS (NodeSource orqali)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

node -v   # v22.x bo'lishi kerak

# PM2 — jarayonlarni boshqaruvchi (o'chib qolsa qayta ko'taradi)
sudo npm install -g pm2
```

---

## 3. Loyihani yuklab olish

```bash
cd ~
git clone https://github.com/Doniyorbek2000/Adm-T.git
cd Adm-T
mkdir -p logs
```

> Repo private boʻlsa: GitHub → Settings → Developer settings → Personal access
> token yarating va `git clone https://<TOKEN>@github.com/Doniyorbek2000/Adm-T.git`
> koʻrinishida ishlating.

---

## 4. Backend sozlash

```bash
cd ~/Adm-T/backend
npm ci
cp .env.example .env
```

`.env` faylini oching (`nano .env`) va quyidagilarni toʻldiring:

```ini
PORT=4000
DATABASE_URL="file:./prod.db"

# MAJBURIY — har birini alohida generatsiya qiling: openssl rand -hex 32
JWT_SECRET="<openssl rand -hex 32 natijasi>"
ENCRYPTION_KEY="<openssl rand -hex 32 natijasi>"

ADMIN_EMAIL="sizning@email.uz"
ADMIN_PASSWORD="<kuchli parol>"

# Frontend'ning HTTPS manzili (CORS uchun) — o'z domeningizni yozing
CORS_ORIGIN="https://trading.example.com"

# AVVAL testnet! Kamida 1-2 hafta sinab, keyin "live" ga o'tkazasiz
EXCHANGE_MODE="testnet"
FUTURES_LEVERAGE=3

# Telegram (tavsiya etiladi — har bir savdo telefoningizga keladi)
TELEGRAM_BOT_TOKEN="<@BotFather'dan>"
TELEGRAM_CHAT_ID="<chat id>"

PAYMENT_MODE="test"
```

> **DIQQAT:** `ENCRYPTION_KEY` bir marta oʻrnatiladi va **hech qachon
> oʻzgartirilmaydi** — u bilan shifrlangan birja API kalitlari aks holda oʻqib
> boʻlmas holga keladi.

Bazani yaratish, seed va build:

```bash
npx prisma migrate deploy     # barcha migratsiyalarni qo'llaydi
npx prisma generate
npm run seed                  # admin foydalanuvchi + tariflar
npm run build                 # dist/ ga kompilyatsiya
npm test                      # 57 test — hammasi o'tishi kerak
```

---

## 5. Frontend sozlash

```bash
cd ~/Adm-T/frontend
npm ci

# API manzili BUILD paytida kodga kiradi — o'z domeningizni yozing:
echo 'NEXT_PUBLIC_API_URL=https://trading.example.com/api' > .env.production

npm run build
```

> `NEXT_PUBLIC_API_URL` ni keyin oʻzgartirsangiz, `npm run build` ni QAYTA
> bajarish shart — u runtime emas, build-time oʻzgaruvchi.

---

## 6. PM2 bilan ishga tushirish

Repo ildizida tayyor `ecosystem.config.js` bor:

```bash
cd ~/Adm-T
pm2 start ecosystem.config.js
pm2 status          # ikkalasi ham "online" bo'lishi kerak

# Server qayta yonganda avtomatik tiklanish:
pm2 save
pm2 startup         # chiqargan buyruqni nusxalab bajaring (sudo bilan)

# Log aylanishi (loglar diskni to'ldirmasligi uchun):
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

Tekshirish:

```bash
curl http://localhost:4000/api/health   # {"status":"ok",...}
pm2 logs adm-backend --lines 20         # "AI Engine ishga tushdi" ko'rinishi kerak
```

> **MUHIM:** `adm-backend` har doim **bitta nusxada** (instances: 1) ishlashi
> shart — ikki nusxa ikki marta savdo ochadi. `pm2 scale` ishlatmang.

---

## 7. Nginx + HTTPS (domen)

```bash
sudo nano /etc/nginx/sites-available/adm-trading
```

Quyidagini joylashtiring (domeningizni almashtiring):

```nginx
server {
    listen 80;
    server_name trading.example.com;

    # API -> backend (4000)
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Qolgan hammasi -> frontend (3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Yoqish va SSL:

```bash
sudo ln -s /etc/nginx/sites-available/adm-trading /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Bepul SSL sertifikat (Let's Encrypt) — avtomatik yangilanadi
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d trading.example.com
```

Endi `https://trading.example.com` ochilishi kerak. Admin sifatida `.env` dagi
`ADMIN_EMAIL`/`ADMIN_PASSWORD` bilan kiring.

---

## 8. Binance API kalitni toʻgʻri yaratish

Binance → Profile → **API Management** → Create API:

1. ✅ **Enable Reading**
2. ✅ **Enable Spot & Margin Trading**
3. ✅ **Enable Futures** — faqat FUTURES rejim (short savdolar) kerak boʻlsa
4. ❌ **Enable Withdrawals — HECH QACHON YOQMANG** (tizim baribir bunday
   kalitni rad etadi — bu sizning himoyangiz)
5. **IP access restriction → Restrict access to trusted IPs** → VPS IP
   manzilingizni kiriting. Bu eng kuchli himoya: kalit oʻgʻirlansa ham
   faqat sizning serveringizdan ishlaydi.

Keyin saytda: **My accounts → Yangi hisob ulash** → Binance → Spot yoki
Futures → kalitlarni kiriting → rejim: **AUTO_TRADE**, risk: **1 (past)** dan
boshlang.

---

## 9. Testnet → Live oʻtish tartibi (shoshilmang!)

1. `EXCHANGE_MODE="testnet"` bilan **kamida 1–2 hafta** ishlating.
2. Statistika sahifasida natijani baholang: profit factor > 1.3? Max drawdown
   chidasa boʻladigan darajadami? Telegram xabarlari kelyaptimi?
3. Live'ga oʻtish:
   ```bash
   cd ~/Adm-T/backend
   nano .env                 # EXCHANGE_MODE="live"
   pm2 restart adm-backend
   pm2 logs adm-backend --lines 5   # "birja rejimi: LIVE" ko'rinadi
   ```
   > Zaif JWT_SECRET/ENCRYPTION_KEY bilan live rejim ATAYLAB ishga tushmaydi.
4. **Kichik summa** bilan boshlang (masalan $100–300), risk darajasi 1
   (har savdoda balansning 0.5% tavakkal).
5. Favqulodda holatda: Admin panel → **AI treding dvigateli → Favqulodda
   toʻxtatish** — yangi savdolar toʻxtaydi, ochiq pozitsiyalar birja
   tomonidagi TP/SL bilan himoyalangan holda qoladi.

---

## 10. Zaxira nusxa (backup)

Baza — bitta SQLite fayl. Kunlik avtomatik nusxa:

```bash
mkdir -p ~/backups
crontab -e
```

Qoʻshing (har kuni 03:00 da, 30 kunlik tarix):

```cron
0 3 * * * sqlite3 /home/adm/Adm-T/backend/prisma/prod.db ".backup /home/adm/backups/adm-$(date +\%F).db" && find /home/adm/backups -name 'adm-*.db' -mtime +30 -delete
```

`sqlite3` oʻrnatilmagan boʻlsa: `sudo apt install -y sqlite3`

> Balandroq ishonchlilik uchun `~/backups` ni boshqa joyga ham sinxronlang
> (masalan `rclone` bilan Google Drive'ga).

---

## 11. Yangilash (yangi kod chiqqanda)

```bash
cd ~/Adm-T
git pull

cd backend
npm ci
npx prisma migrate deploy
npm run build
npm test

cd ../frontend
npm ci
npm run build

cd ..
pm2 restart all
pm2 logs --lines 20   # xatosiz ko'tarilganini tekshiring
```

---

## 12. Kundalik nazorat

| Buyruq | Nima koʻrsatadi |
|---|---|
| `pm2 status` | Ikkala servis holati (online/errored, qayta ishga tushishlar soni) |
| `pm2 logs adm-backend` | AI dvigatel loglari: signallar, savdolar, xatolar |
| `curl -s localhost:4000/api/health` | API tirikligini tekshirish |
| Statistika sahifasi | PnL, drawdown, profit factor — haftada bir koʻrib turing |

Telegram yoqilgan boʻlsa, har bir ochilgan/yopilgan savdo, break-even va xato
xabari telefoningizga oʻzi keladi — bu asosiy monitoring kanalingiz.

### Tez-tez uchraydigan muammolar

| Belgi | Sabab / Yechim |
|---|---|
| `Klines so'rovi muvaffaqiyatsiz: HTTP 451/403` | Binance sizning server mintaqangizni bloklagan — VPS'ni Yevropa/Osiyo regioniga koʻchiring |
| `API kalit tasdiqlanmadi` | Kalitda IP cheklovi VPS IP bilan mos emas, yoki ruxsatlar yetarli emas |
| Frontend ochiladi, lekin maʼlumot kelmaydi | `NEXT_PUBLIC_API_URL` notoʻgʻri — `.env.production` ni tuzatib, frontend'ni qayta build qiling |
| `SIGN CHECK FAILED` yoki vaqt xatosi | Server soati adashgan: `sudo timedatectl set-ntp true` |
| Server qayta yondi, servislar yoʻq | `pm2 save` va `pm2 startup` bajarilmagan — 6-bosqichga qaytib bajaring |
