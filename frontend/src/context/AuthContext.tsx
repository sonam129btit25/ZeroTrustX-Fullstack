import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, configureAuthHandlers, refreshSession, tokenStore } from "@/services/api";
import type { LoginResponse, Me, TokenResponse } from "@/types/api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: Status;
  user: Me | null;
  sessionLostReason: string | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  verifyMfa: (mfaToken: string, payload: { code?: string; recovery_code?: string }) => Promise<void>;
  logout: (everywhere?: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
  applyTokens: (t: TokenResponse) => void;
  can: (...perms: string[]) => boolean;
  canAny: (...perms: string[]) => boolean;
  hasRole: (...roles: string[]) => boolean;
  clearSessionLost: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const [sessionLostReason, setSessionLostReason] = useState<string | null>(null);
  const qc = useQueryClient();
  const lostRef = useRef(false);

  const applyTokens = useCallback((t: TokenResponse) => {
    tokenStore.set(t.access_token);
    setUser(t.user);
    setStatus("authenticated");
    lostRef.current = false;
  }, []);

  const reset = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setStatus("anonymous");
    qc.clear();
  }, [qc]);

  useEffect(() => {
    configureAuthHandlers({
      onTokens: (t) => setUser(t.user),
      onSessionLost: (code) => {
        if (lostRef.current || !tokenStore.get()) return;
        lostRef.current = true;
        setSessionLostReason(code);
        reset();
      },
    });
    refreshSession()
      .then(applyTokens)
      .catch(() => setStatus("anonymous"));
  }, [applyTokens, reset]);

  // Proactively refresh shortly before the access token expires.
  useEffect(() => {
    if (status !== "authenticated") return;
    const id = window.setInterval(() => { refreshSession().catch(() => undefined); }, 12 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<LoginResponse>("/auth/login", { email, password });
    if (!r.data.mfa_required && r.data.auth) {
      setSessionLostReason(null);
      applyTokens(r.data.auth);
    }
    return r.data;
  }, [applyTokens]);

  const verifyMfa = useCallback(async (mfa_token: string, payload: { code?: string; recovery_code?: string }) => {
    const r = await api.post<TokenResponse>("/auth/mfa/verify", { mfa_token, ...payload });
    setSessionLostReason(null);
    applyTokens(r.data);
  }, [applyTokens]);

  const logout = useCallback(async (everywhere = false) => {
    try {
      await api.post(everywhere ? "/auth/logout-all" : "/auth/logout");
    } catch {
      /* session may already be gone */
    }
    reset();
  }, [reset]);

  const refreshUser = useCallback(async () => {
    const r = await api.get<Me>("/auth/me");
    setUser(r.data);
  }, []);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    const roles = new Set(user?.roles.map((r) => r.name) ?? []);
    return {
      status, user, sessionLostReason, login, verifyMfa, logout, refreshUser, applyTokens,
      can: (...p) => p.every((x) => perms.has(x)),
      canAny: (...p) => p.some((x) => perms.has(x)),
      hasRole: (...r) => r.some((x) => roles.has(x)),
      clearSessionLost: () => setSessionLostReason(null),
    };
  }, [status, user, sessionLostReason, login, verifyMfa, logout, refreshUser, applyTokens]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
