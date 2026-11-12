import { describe, expect, it } from "vitest";
import { cn, riskLevel, timeAgo, titleCase } from "@/utils/format";
import { passwordChecks } from "@/components/security/PasswordStrength";

describe("format utils", () => {
  it("joins class names", () => expect(cn("a", false, "b", null)).toBe("a b"));
  it("maps risk levels", () => {
    expect(riskLevel(5)).toBe("minimal");
    expect(riskLevel(40)).toBe("medium");
    expect(riskLevel(85)).toBe("critical");
  });
  it("title-cases identifiers", () => expect(titleCase("pending_verification")).toBe("Pending Verification"));
  it("formats relative time", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 3 * 3600 * 1000).toISOString())).toBe("3h ago");
    expect(timeAgo(null)).toBe("never");
  });
});

describe("password policy checks", () => {
  const policy = { min_length: 12, require_upper: true, require_lower: true, require_digit: true, require_symbol: true, allow_self_registration: true };
  it("rejects weak passwords", () => {
    expect(passwordChecks("password", policy).filter((c) => !c.ok).length).toBeGreaterThan(2);
  });
  it("accepts strong passwords", () => {
    expect(passwordChecks("Str0ng!Passw0rd", policy).every((c) => c.ok)).toBe(true);
  });
});
