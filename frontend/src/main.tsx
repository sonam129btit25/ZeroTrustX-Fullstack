import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import App from "./App";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { RealtimeProvider } from "@/context/RealtimeContext";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { FluidCursor } from "@/components/cursor/FluidCursor";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err: any) => count < 2 && ![401, 403, 404, 422].includes(err?.response?.status),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <ToastProvider>
            <AuthProvider>
              <RealtimeProvider>
                <App />
                <FluidCursor />
              </RealtimeProvider>
            </AuthProvider>
          </ToastProvider>
        </PreferencesProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
