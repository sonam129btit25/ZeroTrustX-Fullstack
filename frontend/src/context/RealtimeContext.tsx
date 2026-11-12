import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { tokenStore } from "@/services/api";

export interface RealtimeEvent { type: string; id?: string; ts?: string; data: Record<string, any> }
type Listener = (e: RealtimeEvent) => void;
type ConnState = "connecting" | "live" | "offline";

interface RealtimeApi { state: ConnState; subscribe: (fn: Listener) => () => void; lastEvent: RealtimeEvent | null }
const Ctx = createContext<RealtimeApi | null>(null);

/** Which TanStack Query keys to invalidate for each server event type. */
const INVALIDATE: Record<string, string[][]> = {
  "session.created": [["sessions"], ["dashboard"]],
  "session.revoked": [["sessions"], ["dashboard"]],
  "device.updated": [["devices"], ["dashboard"]],
  "access.decision": [["dashboard"], ["decisions"]],
  "access_request.updated": [["access-requests"], ["dashboard"]],
  "threat.created": [["threats"], ["dashboard"]],
  "threat.updated": [["threats"], ["dashboard"]],
  "incident.updated": [["incidents"]],
  "notification.created": [["notifications"]],
  "audit.created": [["audit-logs"]],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<ConnState>("offline");
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const listeners = useRef(new Set<Listener>());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (status !== "authenticated") return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let ping: number | undefined;
    let timer: number | undefined;
    const pending = new Set<string>();
    let flush: number | undefined;

    const connect = () => {
      const token = tokenStore.get();
      if (!token || closed) return;
      setState("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/v1/ws`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token: tokenStore.get() }));
      ws.onmessage = (m) => {
        let ev: RealtimeEvent;
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "ready") {
          setState("live");
          retry = 0;
          ping = window.setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 25000);
          return;
        }
        if (ev.type === "pong") return;
        if (ev.type === "session.revoked" && !ev.data?.user_id) {
          toastRef.current.warning("Your session was terminated", ev.data?.reason ? `Reason: ${ev.data.reason}` : undefined);
          closed = true;
          void logout();
          return;
        }
        setLastEvent(ev);
        listeners.current.forEach((fn) => fn(ev));
        (INVALIDATE[ev.type] ?? []).forEach((k) => pending.add(JSON.stringify(k)));
        window.clearTimeout(flush);
        flush = window.setTimeout(() => {
          pending.forEach((k) => qc.invalidateQueries({ queryKey: JSON.parse(k) }));
          pending.clear();
        }, 250);
        if (ev.type === "notification.created") {
          const sev = ev.data.severity;
          const fn = sev === "critical" || sev === "high" ? toastRef.current.warning : toastRef.current.info;
          fn(ev.data.title, ev.data.body);
        }
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        if (closed) return;
        setState("offline");
        retry = Math.min(retry + 1, 6);
        timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** retry));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      window.clearTimeout(flush);
      ws?.close();
      setState("offline");
    };
  }, [status, qc, logout]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);
  const api = useMemo<RealtimeApi>(() => ({ state, lastEvent, subscribe }), [state, lastEvent, subscribe]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRealtime() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRealtime outside RealtimeProvider");
  return c;
}

export function useRealtimeEvent(types: string[], fn: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(fn);
  ref.current = fn;
  const key = types.join(",");
  useEffect(() => subscribe((e) => { if (key.split(",").includes(e.type)) ref.current(e); }), [subscribe, key]);
}
