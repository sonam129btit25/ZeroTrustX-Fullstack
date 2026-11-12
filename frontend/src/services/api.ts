import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import type { TokenResponse } from "@/types/api";

/**
 * API client.
 * - Access token lives only in memory (never localStorage).
 * - Refresh token is an HttpOnly, SameSite=Strict cookie scoped to /api/v1/auth (JS cannot read it).
 * - 401 token_expired responses trigger a single-flight refresh + replay.
 */
export const API_BASE = "/api/v1";

let accessToken: string | null = null;
let onSessionLost: ((code: string) => void) | null = null;
let onTokens: ((t: TokenResponse) => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => { accessToken = t; },
};

export function configureAuthHandlers(h: { onSessionLost: (code: string) => void; onTokens: (t: TokenResponse) => void }) {
  onSessionLost = h.onSessionLost;
  onTokens = h.onTokens;
}

function deviceId(): string {
  try {
    let id = localStorage.getItem("ztx-device-id");
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, "");
      localStorage.setItem("ztx-device-id", id);
    }
    return id;
  } catch {
    return "ephemeral-browser";
  }
}

export const api = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 20000 });

api.interceptors.request.use((cfg) => {
  cfg.headers.set("X-Device-Id", deviceId());
  if (accessToken) cfg.headers.set("Authorization", `Bearer ${accessToken}`);
  return cfg;
});

let refreshing: Promise<TokenResponse> | null = null;

export function refreshSession(): Promise<TokenResponse> {
  if (!refreshing) {
    refreshing = (async () => {
      const attempt = () => axios.post<TokenResponse>(`${API_BASE}/auth/refresh`, null, {
        withCredentials: true, headers: { "X-Device-Id": deviceId() },
      });
      try {
        const r = await attempt();
        return r.data;
      } catch (e) {
        const err = e as AxiosError<{ detail?: { code?: string } }>;
        if (err.response?.status === 409) {
          await new Promise((res) => setTimeout(res, 600));
          return (await attempt()).data;
        }
        throw e;
      }
    })()
      .then((t) => {
        accessToken = t.access_token;
        onTokens?.(t);
        return t;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<{ detail?: { code?: string } }>) => {
    const cfg = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.detail?.code;
    if (error.response?.status === 401 && cfg && !cfg._retried && !cfg.url?.includes("/auth/")) {
      if (code === "token_expired") {
        cfg._retried = true;
        try {
          await refreshSession();
          return api.request(cfg);
        } catch {
          onSessionLost?.("session_expired");
        }
      } else if (code && ["session_revoked", "session_expired", "session_invalid", "invalid_token"].includes(code)) {
        onSessionLost?.(code);
      }
    }
    if (error.response?.status === 403 && code === "account_inactive") onSessionLost?.("account_inactive");
    return Promise.reject(error);
  },
);

export interface ApiErrorInfo { status?: number; code?: string; message: string; errors?: { field?: string; message: string }[] | string[] }

export function apiError(e: unknown): ApiErrorInfo {
  const err = e as AxiosError<{ detail?: any }>;
  const d = err?.response?.data?.detail;
  if (d && typeof d === "object") return { status: err.response?.status, code: d.code, message: d.message ?? "Request failed", errors: d.errors };
  if (typeof d === "string") return { status: err.response?.status, message: d };
  if (err?.code === "ECONNABORTED") return { message: "The request timed out" };
  if (err?.message === "Network Error") return { message: "Cannot reach the ZeroTrustX API" };
  return { status: err?.response?.status, message: "Something went wrong" };
}

/** Download a file from an authenticated endpoint. */
export async function downloadFile(url: string, params: Record<string, unknown>, filename: string) {
  const r = await api.get(url, { params, responseType: "blob" });
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function cleanParams<T extends Record<string, unknown>>(p: T): Partial<T> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as Partial<T>;
}
