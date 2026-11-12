import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DecisionTrace, DecisionIndicator } from "@/components/security/DecisionView";
import { OtpInput } from "@/pages/auth/MfaVerify";
import type { TraceStep } from "@/types/api";

describe("DecisionTrace", () => {
  it("renders every evaluation step with its outcome", () => {
    const trace: TraceStep[] = [
      { stage: "baseline", check: "User account active", result: "pass", detail: "Account status is 'active'" },
      { stage: "policy", check: "[P30] MFA for sensitive data", result: "match", detail: "Matched -> REQUIRE_MFA",
        conditions: [{ condition: "Session MFA verified is false", actual: false, matched: true }] },
      { stage: "result", check: "Final decision", result: "REQUIRE_MFA", detail: "Step-up MFA verification required" },
    ];
    render(<DecisionTrace trace={trace} />);
    expect(screen.getByText("User account active")).toBeInTheDocument();
    expect(screen.getByText("[P30] MFA for sensitive data")).toBeInTheDocument();
    expect(screen.getByText("Session MFA verified is false")).toBeInTheDocument();
    expect(screen.getByText("Final decision")).toBeInTheDocument();
  });

  it("shows the animated decision indicator label", () => {
    render(<DecisionIndicator decision="DENY" />);
    expect(screen.getByText("DENY")).toBeInTheDocument();
    expect(screen.getByText(/refused/i)).toBeInTheDocument();
  });
});

describe("OtpInput", () => {
  it("fills all digits on paste and completes", () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<OtpInput value="" onChange={onChange} onComplete={onComplete} />);
    fireEvent.paste(screen.getByLabelText("Digit 1"), { clipboardData: { getData: () => "123 456" } });
    expect(onChange).toHaveBeenCalledWith("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });
});

describe("RequirePermission", () => {
  it("renders the 403 page when the permission is missing", async () => {
    vi.resetModules();
    vi.doMock("@/context/AuthContext", () => ({ useAuth: () => ({ can: (p: string) => p === "resources:read" }) }));
    const { RequirePermission } = await import("@/routes/guards");
    render(
      <MemoryRouter>
        <RequirePermission perm="users:read"><p>secret admin content</p></RequirePermission>
        <RequirePermission perm="resources:read"><p>catalogue</p></RequirePermission>
      </MemoryRouter>,
    );
    expect(screen.queryByText("secret admin content")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
    expect(screen.getByText("catalogue")).toBeInTheDocument();
    vi.doUnmock("@/context/AuthContext");
  });
});
