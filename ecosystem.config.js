/**
 * PM2 konfiguratsiyasi — backend (API + AI dvigatel) va frontend (Next.js)
 * ikkalasini bitta buyruq bilan boshqarish uchun:
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # server qayta yonganda avto-tiklanish
 *
 * To'liq yo'riqnoma: DEPLOY.md
 */
module.exports = {
  apps: [
    {
      name: "adm-backend",
      cwd: "./backend",
      script: "dist/server.js",
      instances: 1, // MUHIM: AI dvigatel bitta nusxada ishlashi shart (takroriy savdo bo'lmasligi uchun)
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      kill_timeout: 12000, // graceful shutdown'ga 12s beriladi (server.ts dagi 10s failsafe'dan uzunroq)
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/backend-out.log",
      error_file: "./logs/backend-err.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "adm-frontend",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/frontend-out.log",
      error_file: "./logs/frontend-err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
