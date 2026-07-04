#!/usr/bin/env bash
# ADM Trading — lokal ishga tushirish (Mac/Linux)
# Birinchi marta oldin ISHGA_TUSHIRISH.md dagi 3-qadamni bajaring.
set -e
cd "$(dirname "$0")"

echo "ADM Trading ishga tushmoqda..."
(cd backend && npm run dev) &
BACKEND_PID=$!
sleep 5
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
echo "Backend: http://localhost:4000 | Frontend: http://localhost:3000"
echo "To'xtatish: Ctrl+C"
wait
