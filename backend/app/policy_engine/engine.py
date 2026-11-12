"""Deterministic Zero Trust policy evaluation engine.

The engine is a pure function of (context, policies, org settings). It never calls external
services or AI models. Evaluation order:

1. Baseline guards (non-overridable): account status, session validity, device block,
   resource state, entitlement, resource network/time restrictions, risk block threshold.
2. Adaptive risk control: risk above the MFA threshold requires an MFA-verified session.
3. Administrator policies (enabled, ordered by priority; lower number = evaluated first).
4. Combination: the most restrictive outcome wins (deny-overrides). If nothing produced an
   outcome, the organisation's default action (DENY by default) applies.
"""
from __future__ import annotations

import ipaddress
import time
from dataclasses import dataclass, field
from typing import Any

from app.models.enums import DECISION_SEVERITY, Decision
from app.policy_engine.fields import FIELDS, OPERATORS


@dataclass
class PolicyRule:
    id: str
    name: str
    priority: int
    action: str
    conditions: list[dict[str, Any]]
    match_mode: str = "all"
    enabled: bool = True


@dataclass
class OrgThresholds:
    risk_block_threshold: int = 80
    risk_mfa_threshold: int = 50
    default_action: str = Decision.DENY.value


@dataclass
class EvaluationContext:
    user: dict[str, Any]  # id, email, status, roles, permissions, risk_score, mfa_enabled, department
    session: dict[str, Any]  # id, valid, mfa_verified, age_minutes
    device: dict[str, Any] | None  # id, trust_status, risk_score, name
    request: dict[str, Any]  # ip, hour, weekday, is_business_hours
    resource: dict[str, Any]  # id, slug, name, sensitivity, type, required_permission, is_active, ...
    entitlement: dict[str, Any]  # has_permission, has_active_grant

    def attributes(self) -> dict[str, Any]:
        d = self.device or {}
        return {
            "user.role": list(self.user.get("roles", [])),
            "user.risk_score": int(self.user.get("risk_score", 0)),
            "user.department": self.user.get("department"),
            "user.mfa_enabled": bool(self.user.get("mfa_enabled")),
            "session.mfa_verified": bool(self.session.get("mfa_verified")),
            "session.age_minutes": int(self.session.get("age_minutes", 0)),
            "device.trust_status": d.get("trust_status", "unknown"),
            "device.risk_score": int(d.get("risk_score", 0)),
            "request.ip": self.request.get("ip"),
            "request.hour": int(self.request.get("hour", 0)),
            "request.weekday": int(self.request.get("weekday", 0)),
            "request.is_business_hours": bool(self.request.get("is_business_hours")),
            "resource.sensitivity": self.resource.get("sensitivity"),
            "resource.slug": self.resource.get("slug"),
            "resource.type": self.resource.get("type"),
        }


@dataclass
class EvaluationResult:
    decision: str
    reasons: list[str]
    trace: list[dict[str, Any]]
    matched_policies: list[dict[str, Any]] = field(default_factory=list)
    deciding_policy_id: str | None = None
    required_actions: list[str] = field(default_factory=list)
    duration_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "reasons": self.reasons,
            "trace": self.trace,
            "matched_policies": self.matched_policies,
            "deciding_policy_id": self.deciding_policy_id,
            "required_actions": self.required_actions,
            "duration_ms": round(self.duration_ms, 3),
        }


# ------------------------------------------------------------------ condition evaluation
def _ip_in(ip: str | None, networks: Any) -> bool:
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    nets = networks if isinstance(networks, list) else [networks]
    for n in nets:
        try:
            if addr in ipaddress.ip_network(str(n), strict=False):
                return True
        except ValueError:
            continue
    return False


def evaluate_condition(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "is_true":
        return actual is True
    if operator == "is_false":
        return actual is False
    if operator == "eq":
        return actual == expected
    if operator == "neq":
        return actual != expected
    if operator == "in":
        return actual in (expected or [])
    if operator == "not_in":
        return actual not in (expected or [])
    if operator == "contains":
        return any(v in (actual or []) for v in (expected or []))
    if operator == "not_contains":
        return not any(v in (actual or []) for v in (expected or []))
    if operator in ("in_cidr", "not_in_cidr"):
        inside = _ip_in(actual, expected)
        return inside if operator == "in_cidr" else not inside
    try:
        if operator == "gt":
            return actual > expected
        if operator == "gte":
            return actual >= expected
        if operator == "lt":
            return actual < expected
        if operator == "lte":
            return actual <= expected
        if operator == "between":
            lo, hi = expected
            return lo <= actual <= hi
    except TypeError:
        return False
    raise ValueError(f"Unsupported operator {operator}")


def describe_condition(fld: str, op: str, value: Any) -> str:
    label = FIELDS.get(fld, {}).get("label", fld)
    if op in ("is_true", "is_false"):
        return f"{label} {OPERATORS[op]}"
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value) if op != "between" else f"{value[0]} and {value[1]}"
    return f"{label} {OPERATORS.get(op, op)} {value}"


ACTION_TEXT = {
    Decision.ALLOW.value: "Access allowed",
    Decision.DENY.value: "Access denied",
    Decision.REQUIRE_MFA.value: "Step-up MFA verification required",
    Decision.REQUIRE_DEVICE_VERIFICATION.value: "Device verification required",
    Decision.RESTRICTED_ACCESS.value: "Restricted (read-only / limited) access granted",
}

REQUIRED_ACTION_TEXT = {
    Decision.REQUIRE_MFA.value: "Complete multi-factor authentication for this session",
    Decision.REQUIRE_DEVICE_VERIFICATION.value: "Have a security administrator verify and trust this device",
    Decision.RESTRICTED_ACCESS.value: "Access is limited to read-only operations",
}


# ------------------------------------------------------------------ engine
class PolicyEngine:
    def __init__(self, policies: list[PolicyRule], thresholds: OrgThresholds | None = None):
        self.policies = sorted((p for p in policies if p.enabled), key=lambda p: (p.priority, p.name))
        self.t = thresholds or OrgThresholds()

    def evaluate(self, ctx: EvaluationContext) -> EvaluationResult:
        start = time.perf_counter()
        trace: list[dict[str, Any]] = []

        def step(stage: str, check: str, passed: bool, detail: str) -> None:
            trace.append({"stage": stage, "check": check, "result": "pass" if passed else "fail", "detail": detail})

        def deny(reason: str) -> EvaluationResult:
            trace.append({"stage": "result", "check": "Evaluation stopped", "result": "fail", "detail": reason})
            return EvaluationResult(
                decision=Decision.DENY.value,
                reasons=[reason],
                trace=trace,
                duration_ms=(time.perf_counter() - start) * 1000,
            )

        u, s, d, r, ent = ctx.user, ctx.session, ctx.device, ctx.resource, ctx.entitlement
        attrs = ctx.attributes()

        # ---- 1. baseline guards ----------------------------------------------------------
        ok = u.get("status") == "active"
        step("baseline", "User account active", ok, f"Account status is '{u.get('status')}'")
        if not ok:
            return deny(f"User account is {u.get('status')}; only active accounts may access resources")

        ok = bool(s.get("valid"))
        step("baseline", "Session valid", ok, "Session is active and not revoked" if ok else "Session invalid")
        if not ok:
            return deny("Session is expired, revoked or missing")

        trust = (d or {}).get("trust_status", "unknown")
        ok = trust != "blocked"
        step("baseline", "Device not blocked", ok, f"Device trust status is '{trust}'")
        if not ok:
            return deny("The device has been blocked by a security administrator")

        ok = bool(r.get("is_active", True))
        step("baseline", "Resource available", ok, "Resource is active" if ok else "Resource is disabled")
        if not ok:
            return deny("The requested resource is disabled")

        is_public = r.get("sensitivity") == "public"
        entitled = is_public or bool(ent.get("has_permission")) or bool(ent.get("has_active_grant")) \
            or bool(ent.get("assumed_for_request"))
        if is_public:
            detail = "Public resource; no entitlement required"
        elif ent.get("has_permission"):
            detail = f"Role grants permission '{r.get('required_permission')}'"
        elif ent.get("has_active_grant"):
            detail = "User holds an approved, unexpired access grant"
        elif ent.get("assumed_for_request"):
            detail = "Entitlement assumed: evaluating security posture for an access request"
        else:
            detail = f"Missing permission '{r.get('required_permission')}' and no active access grant"
        step("baseline", "User entitled to resource", entitled, detail)
        if not entitled:
            return deny("User is not entitled to this resource; submit an access request with justification")

        ranges = r.get("allowed_ip_ranges") or []
        if ranges:
            ok = _ip_in(ctx.request.get("ip"), ranges)
            step("baseline", "Source network allowed", ok, f"IP {ctx.request.get('ip')} vs {', '.join(ranges)}")
            if not ok:
                return deny(f"Source IP {ctx.request.get('ip')} is outside the resource's allowed networks")

        hs, he = r.get("access_hours_start"), r.get("access_hours_end")
        if hs is not None and he is not None:
            hour = attrs["request.hour"]
            ok = hs <= hour < he if hs <= he else (hour >= hs or hour < he)
            step("baseline", "Within resource access window", ok, f"Hour {hour:02d}:00, window {hs:02d}:00-{he:02d}:00")
            if not ok:
                return deny(f"Resource may only be accessed between {hs:02d}:00 and {he:02d}:00")

        risk = attrs["user.risk_score"]
        ok = risk < self.t.risk_block_threshold
        step("baseline", "Risk below block threshold", ok, f"User risk {risk} vs threshold {self.t.risk_block_threshold}")
        if not ok:
            return deny(f"User risk score {risk} meets or exceeds the block threshold ({self.t.risk_block_threshold})")

        # ---- 2. adaptive risk ---------------------------------------------------------------
        candidates: list[tuple[str, str | None, str]] = []  # (action, policy_id, reason)
        if risk >= self.t.risk_mfa_threshold and not attrs["session.mfa_verified"]:
            step("adaptive", "Elevated risk step-up", False, f"Risk {risk} >= {self.t.risk_mfa_threshold} and session not MFA verified")
            candidates.append((Decision.REQUIRE_MFA.value, None, f"Elevated user risk ({risk}) requires an MFA-verified session"))
        else:
            step("adaptive", "Elevated risk step-up", True, f"Risk {risk} below step-up threshold or session MFA verified")

        # ---- 3. policies ----------------------------------------------------------------------
        matched: list[dict[str, Any]] = []
        for p in self.policies:
            results = []
            for c in p.conditions:
                actual = attrs.get(c["field"])
                try:
                    res = evaluate_condition(actual, c["operator"], c.get("value"))
                except ValueError:
                    res = False
                results.append(
                    {
                        "condition": describe_condition(c["field"], c["operator"], c.get("value")),
                        "actual": actual,
                        "matched": res,
                    }
                )
            if not p.conditions:
                is_match = True
            elif p.match_mode == "any":
                is_match = any(x["matched"] for x in results)
            else:
                is_match = all(x["matched"] for x in results)
            trace.append(
                {
                    "stage": "policy",
                    "check": f"[P{p.priority}] {p.name}",
                    "result": "match" if is_match else "no_match",
                    "detail": f"{'Matched' if is_match else 'Did not match'} -> {p.action}" if is_match else "Conditions not met",
                    "policy_id": p.id,
                    "conditions": results,
                }
            )
            if is_match:
                matched.append({"policy_id": p.id, "name": p.name, "priority": p.priority, "action": p.action})
                candidates.append((p.action, p.id, f"Policy '{p.name}' -> {p.action}"))

        # ---- 4. combine -------------------------------------------------------------------
        default = self.t.default_action
        explicit = [c for c in candidates if c[1] is not None]
        if not explicit:
            # No administrator policy matched -> organisation default applies (default-deny posture).
            pool = candidates + [(default, None, f"No policy explicitly matched; organisation default action is {default}")]
        else:
            pool = candidates
        # Most restrictive outcome wins (deny-overrides); ties keep policy priority order.
        best = max(pool, key=lambda c: DECISION_SEVERITY[Decision(c[0])])
        final, deciding = best[0], best[1]
        reasons = [c[2] for c in sorted(pool, key=lambda c: -DECISION_SEVERITY[Decision(c[0])])]

        for m in matched:
            m["deciding"] = m["policy_id"] == deciding
        trace.append({"stage": "result", "check": "Final decision", "result": final, "detail": ACTION_TEXT[final]})
        required = [REQUIRED_ACTION_TEXT[final]] if final in REQUIRED_ACTION_TEXT else []
        return EvaluationResult(
            decision=final,
            reasons=reasons,
            trace=trace,
            matched_policies=matched,
            deciding_policy_id=deciding,
            required_actions=required,
            duration_ms=(time.perf_counter() - start) * 1000,
        )
