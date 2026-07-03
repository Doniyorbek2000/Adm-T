"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "./api";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: "USER" | "ADMIN";
  plan: "FREE" | "PRO" | "ULTRA" | "VIP";
  planExpiresAt: string | null;
  createdAt: string;
}

interface AuthContextValue {
  token: string | null;
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (fullName: string, email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "adm_trading_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const loadMe = useCallback(async (activeToken: string) => {
    const data = await apiRequest<{ user: SessionUser }>("/auth/me", { token: activeToken });
    setUser(data.user);
    return data.user;
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);
    loadMe(stored)
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        document.cookie = "token=; path=/; max-age=0";
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [loadMe]);

  const persistSession = useCallback((newToken: string, newUser: SessionUser) => {
    window.localStorage.setItem(STORAGE_KEY, newToken);
    document.cookie = `token=${newToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
    setToken(newToken);
    setUser(newUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiRequest<{ token: string; user: SessionUser }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      persistSession(data.token, data.user);
      return data.user;
    },
    [persistSession]
  );

  const register = useCallback(
    async (fullName: string, email: string, password: string) => {
      const data = await apiRequest<{ token: string; user: SessionUser }>("/auth/register", {
        method: "POST",
        body: { fullName, email, password },
      });
      persistSession(data.token, data.user);
      return data.user;
    },
    [persistSession]
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    document.cookie = "token=; path=/; max-age=0";
    setToken(null);
    setUser(null);
    router.push("/");
  }, [router]);

  // Auto-logout when any API call returns 401 (expired/revoked token)
  useEffect(() => {
    const handle = () => {
      if (token) logout();
    };
    window.addEventListener("adm:unauthorized", handle);
    return () => window.removeEventListener("adm:unauthorized", handle);
  }, [token, logout]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    await loadMe(token);
  }, [token, loadMe]);

  const value = useMemo(
    () => ({ token, user, isLoading, login, register, logout, refreshUser }),
    [token, user, isLoading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth AuthProvider ichida ishlatilishi kerak");
  return ctx;
}
