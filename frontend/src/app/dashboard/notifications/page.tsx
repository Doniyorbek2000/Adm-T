"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/api";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface NotificationDto {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const { token } = useAuth();
  const { t, locale } = useTranslation();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    if (!token) return;
    apiRequest<{ notifications: NotificationDto[] }>("/notifications", { token })
      .then((data) => setItems(data.notifications))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function markAllRead() {
    if (!token) return;
    await apiRequest("/notifications/mark-all-read", { method: "POST", token });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("dash.notifications.title")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("dash.notifications.subtitle")}</p>
        </div>
        <button onClick={markAllRead} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
          {t("dash.notifications.markAllRead")}
        </button>
      </div>

      {loading && <p className="text-sm text-slate-400">{t("common.loading")}</p>}

      <div className="space-y-3">
        {items.map((n) => (
          <div
            key={n.id}
            className={`rounded-2xl border p-4 ${n.isRead ? "border-white/10 bg-white/[0.02]" : "border-emerald-400/30 bg-emerald-400/[0.05]"}`}
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold">{n.title}</p>
              {!n.isRead && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
            </div>
            <p className="mt-1 text-sm text-slate-400">{n.message}</p>
            <p className="mt-2 text-xs text-slate-500">{new Date(n.createdAt).toLocaleString(locale)}</p>
          </div>
        ))}
        {!loading && items.length === 0 && <p className="text-sm text-slate-500">{t("dash.notifications.empty")}</p>}
      </div>
    </div>
  );
}
