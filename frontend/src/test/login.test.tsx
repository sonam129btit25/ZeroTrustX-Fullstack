import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const login = vi.fn();
let impl: (...a: unknown[]) => Promise<unknown> = async () => ({});
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ login: (...a: unknown[]) => { login(...a); return impl(...a); } }),
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { min_length: 12, require_upper: true, require_lower: true, require_digit: true, require_symbol: true, allow_self_registration: true } }) },
  apiError: (e: any) => ({ message: e?.message ?? "error" }),
}));
vi.mock("@/components/brand/NetworkCanvas", () => ({ NetworkCanvas: () => null }));

import Login from "@/pages/auth/Login";

function renderLogin() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/mfa" element={<p>MFA PAGE</p>} />
          <Route path="/" element={<p>HOME</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Login workflow", () => {
  beforeEach(() => { login.mockReset(); impl = async () => ({}); });

  it("validates required fields before calling the API", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("redirects to MFA verification when the account requires it", async () => {
    impl = async () => ({ mfa_required: true, mfa_token: "tok", auth: null });
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("you@company.com"), "mfa@zerotrustx.dev");
    await userEvent.type(screen.getByPlaceholderText("••••••••••••"), "MfaDemo!2026x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText("MFA PAGE")).toBeInTheDocument());
    expect(login).toHaveBeenCalledWith("mfa@zerotrustx.dev", "MfaDemo!2026x");
  });

  it("shows the API error for invalid credentials", async () => {
    impl = () => Promise.reject({ message: "Invalid email or password" });
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("you@company.com"), "x@y.dev");
    await userEvent.type(screen.getByPlaceholderText("••••••••••••"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("navigates home after a password-only login", async () => {
    impl = async () => ({ mfa_required: false, mfa_token: null, auth: {} });
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("you@company.com"), "employee@zerotrustx.dev");
    await userEvent.type(screen.getByPlaceholderText("••••••••••••"), "Employee!2026");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText("HOME")).toBeInTheDocument());
  });
});
