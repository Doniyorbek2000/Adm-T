@echo off
REM ADM Trading — lokal ishga tushirish (Windows)
REM Birinchi marta oldin ISHGA_TUSHIRISH.md dagi 3-qadamni bajaring
REM (npm install, prisma migrate, seed). Keyin shu fayl yetarli.

echo ADM Trading ishga tushmoqda...
start "ADM Backend (AI dvigatel)" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 5 /nobreak >nul
start "ADM Frontend (sayt)" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 8 /nobreak >nul
start http://localhost:3000
echo Ikkala server ochildi. Oynalarni yopmang - AI ishlashi uchun ochiq tursin.
