"""Unit tests for the deterministic policy engine (no database)."""
from app.policy_engine.engine import EvaluationContext, OrgThresholds, PolicyEngine, PolicyRule, evaluate_condition
from app.policy_engine.fields import validate_condition


def ctx(**over) -> EvaluationContext:
    base = dict(
        user={"status": "active", "roles": ["employee"], "risk_score": 10, "mfa_enabled": True, "department": "Eng"},
        session={"valid": True, "mfa_verified": True, "age_minutes": 5},
        device={"trust_status": "trusted", "risk_score": 5},
        request={"ip": "10.1.2.3", "hour": 10, "weekday": 1, "is_business_hours": True},
        resource={"slug": "fin", "sensitivity": "confidential", "type": "database", "required_permission": "p",
                  "is_active": True, "allowed_ip_ranges": [], "access_hours_start": None, "access_hours_end": None},
        entitlement={"has_permission": True, "has_active_grant": False},
    )
    for k, v in over.items():
        base[k] = {**base[k], **v} if isinstance(v, dict) and base.get(k) is not None else v
    return EvaluationContext(**base)


ALLOW_TRUSTED = PolicyRule("p-allow", "Allow trusted", 90, "ALLOW", [{"field": "device.trust_status", "operator": "eq", "value": "trusted"}])
MFA_SENSITIVE = PolicyRule("p-mfa", "MFA sensitive", 30, "REQUIRE_MFA", [
    {"field": "session.mfa_verified", "operator": "is_false", "value": None},
    {"field": "resource.sensitivity", "operator": "in", "value": ["confidential", "restricted"]}])
DEVICE_RESTRICTED = PolicyRule("p-dev", "Device for restricted", 20, "REQUIRE_DEVICE_VERIFICATION", [
    {"field": "device.trust_status", "operator": "neq", "value": "trusted"},
    {"field": "resource.sensitivity", "operator": "eq", "value": "restricted"}])
DENY_SUSPICIOUS = PolicyRule("p-deny", "Deny suspicious", 10, "DENY", [
    {"field": "device.trust_status", "operator": "eq", "value": "suspicious"}])
ALL = [ALLOW_TRUSTED, MFA_SENSITIVE, DEVICE_RESTRICTED, DENY_SUSPICIOUS]


def test_allow_when_all_controls_pass():
    r = PolicyEngine(ALL).evaluate(ctx())
    assert r.decision == "ALLOW"
    assert r.deciding_policy_id == "p-allow"
    assert any(t["stage"] == "baseline" for t in r.trace)


def test_inactive_user_denied_before_policies():
    r = PolicyEngine(ALL).evaluate(ctx(user={"status": "suspended"}))
    assert r.decision == "DENY"
    assert "suspended" in r.reasons[0]
    assert not any(t["stage"] == "policy" for t in r.trace)


def test_invalid_session_denied():
    assert PolicyEngine(ALL).evaluate(ctx(session={"valid": False})).decision == "DENY"


def test_blocked_device_denied():
    assert PolicyEngine(ALL).evaluate(ctx(device={"trust_status": "blocked"})).decision == "DENY"


def test_not_entitled_denied():
    r = PolicyEngine(ALL).evaluate(ctx(entitlement={"has_permission": False, "has_active_grant": False}))
    assert r.decision == "DENY" and "not entitled" in r.reasons[0]


def test_active_grant_counts_as_entitlement():
    r = PolicyEngine(ALL).evaluate(ctx(entitlement={"has_permission": False, "has_active_grant": True}))
    assert r.decision == "ALLOW"


def test_require_mfa_when_session_not_verified():
    r = PolicyEngine(ALL).evaluate(ctx(session={"mfa_verified": False}))
    assert r.decision == "REQUIRE_MFA"
    assert r.required_actions


def test_require_device_verification_for_restricted():
    c = ctx(device={"trust_status": "pending_verification"}, resource={"sensitivity": "restricted"})
    assert PolicyEngine(ALL).evaluate(c).decision == "REQUIRE_DEVICE_VERIFICATION"


def test_deny_overrides_allow():
    # Suspicious device matches DENY; no ALLOW match either, but even with an ALLOW match deny wins
    allow_any = PolicyRule("p-any", "Allow anything", 1, "ALLOW", [])
    r = PolicyEngine([allow_any, DENY_SUSPICIOUS]).evaluate(ctx(device={"trust_status": "suspicious"}))
    assert r.decision == "DENY"
    assert r.deciding_policy_id == "p-deny"
    assert {m["policy_id"] for m in r.matched_policies} == {"p-any", "p-deny"}


def test_default_deny_when_no_policy_matches():
    r = PolicyEngine([ALLOW_TRUSTED]).evaluate(ctx(device={"trust_status": "untrusted"}))
    assert r.decision == "DENY"
    assert "default" in r.reasons[0].lower()


def test_configurable_default_action():
    r = PolicyEngine([], OrgThresholds(default_action="RESTRICTED_ACCESS")).evaluate(ctx())
    assert r.decision == "RESTRICTED_ACCESS"


def test_risk_block_threshold():
    r = PolicyEngine(ALL, OrgThresholds(risk_block_threshold=70)).evaluate(ctx(user={"risk_score": 75}))
    assert r.decision == "DENY" and "risk" in r.reasons[0].lower()


def test_adaptive_risk_requires_mfa():
    r = PolicyEngine(ALL, OrgThresholds(risk_mfa_threshold=40)).evaluate(
        ctx(user={"risk_score": 45}, session={"mfa_verified": False}, resource={"sensitivity": "internal"}))
    assert r.decision == "REQUIRE_MFA"


def test_resource_ip_allowlist():
    c = ctx(resource={"allowed_ip_ranges": ["192.168.0.0/16"]})
    assert PolicyEngine(ALL).evaluate(c).decision == "DENY"
    c2 = ctx(resource={"allowed_ip_ranges": ["10.0.0.0/8"]})
    assert PolicyEngine(ALL).evaluate(c2).decision == "ALLOW"


def test_resource_time_window():
    c = ctx(resource={"access_hours_start": 9, "access_hours_end": 17}, request={"hour": 22})
    assert PolicyEngine(ALL).evaluate(c).decision == "DENY"


def test_disabled_policy_ignored():
    p = PolicyRule("x", "Deny all", 1, "DENY", [], enabled=False)
    assert PolicyEngine([p, ALLOW_TRUSTED]).evaluate(ctx()).decision == "ALLOW"


def test_match_mode_any():
    p = PolicyRule("x", "Any", 5, "RESTRICTED_ACCESS", [
        {"field": "user.role", "operator": "contains", "value": ["guest"]},
        {"field": "request.hour", "operator": "between", "value": [0, 11]}], match_mode="any")
    r = PolicyEngine([p, ALLOW_TRUSTED]).evaluate(ctx())
    assert r.decision == "RESTRICTED_ACCESS"


def test_operators():
    assert evaluate_condition("10.0.0.5", "in_cidr", ["10.0.0.0/8"])
    assert evaluate_condition("8.8.8.8", "not_in_cidr", ["10.0.0.0/8"])
    assert evaluate_condition(["employee"], "not_contains", ["super_admin"])
    assert evaluate_condition(5, "between", [1, 5])
    assert not evaluate_condition(None, "gt", 3)


def test_condition_validation():
    assert validate_condition("device.trust_status", "eq", "trusted") is None
    assert validate_condition("nope", "eq", 1)
    assert validate_condition("user.risk_score", "contains", [1])
    assert validate_condition("request.ip", "in_cidr", ["not-a-net"])


def test_engine_is_deterministic():
    e = PolicyEngine(ALL)
    a, b = e.evaluate(ctx(session={"mfa_verified": False})), e.evaluate(ctx(session={"mfa_verified": False}))
    assert (a.decision, a.reasons, a.deciding_policy_id) == (b.decision, b.reasons, b.deciding_policy_id)
