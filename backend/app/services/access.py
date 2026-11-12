"""Bridges database state and the pure policy engine; persists every decision."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import (
    AccessDecision,
    AccessDecisionPolicy,
    AccessRequest,
    Device,
    Policy,
    ProtectedResource,
    User,
    UserSession,
)
from app.policy_engine.engine import EvaluationContext, EvaluationResult, OrgThresholds, PolicyEngine, PolicyRule
from app.services import audit, threats
from app.services.org import get_org
from app.ws.manager import ADMINS, queue_event


def policy_rule(p: Policy) -> PolicyRule:
    return PolicyRule(
        id=str(p.id), name=p.name, priority=p.priority, action=p.action, match_mode=p.match_mode, enabled=p.is_enabled,
        conditions=[{"field": c.field, "operator": c.operator, "value": c.value} for c in p.conditions],
    )


def build_engine(db: Session) -> PolicyEngine:
    org = get_org(db)
    policies = db.execute(select(Policy).where(Policy.is_enabled.is_(True))).scalars().all()
    return PolicyEngine(
        [policy_rule(p) for p in policies],
        OrgThresholds(org.risk_block_threshold, org.risk_mfa_threshold, org.default_policy_action),
    )


def time_attrs(db: Session, now: datetime | None = None) -> dict:
    org = get_org(db)
    try:
        tz = ZoneInfo(org.timezone)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo("UTC")
    local = (now or utcnow()).astimezone(tz)
    return {
        "hour": local.hour,
        "weekday": local.weekday(),
        "is_business_hours": org.business_hours_start <= local.hour < org.business_hours_end and local.weekday() < 5,
        "timezone": org.timezone,
    }


def has_active_grant(db: Session, user_id, resource_id) -> bool:
    now = utcnow()
    return db.execute(
        select(AccessRequest.id).where(
            AccessRequest.requester_id == user_id,
            AccessRequest.resource_id == resource_id,
            AccessRequest.status == "approved",
            AccessRequest.expires_at > now,
        ).limit(1)
    ).first() is not None


def resource_dict(r: ProtectedResource) -> dict:
    return {
        "id": str(r.id), "slug": r.slug, "name": r.name, "sensitivity": r.sensitivity, "type": r.resource_type,
        "required_permission": r.required_permission, "is_active": r.is_active,
        "allowed_ip_ranges": r.allowed_ip_ranges or [], "access_hours_start": r.access_hours_start,
        "access_hours_end": r.access_hours_end,
    }


def build_context(
    db: Session, user: User, resource: ProtectedResource, session: UserSession | None, device: Device | None,
    ip: str | None, now: datetime | None = None, assume_entitled: bool = False,
) -> EvaluationContext:
    now = now or utcnow()
    session_valid = bool(session and session.revoked_at is None and session.expires_at > now)
    perms = user.permission_codes
    return EvaluationContext(
        user={
            "id": str(user.id), "email": user.email, "status": user.status, "roles": user.role_names,
            "permissions": sorted(perms), "risk_score": user.risk_score, "mfa_enabled": user.mfa_enabled,
            "department": user.department,
        },
        session={
            "id": str(session.id) if session else None,
            "valid": session_valid,
            "mfa_verified": bool(session and session.mfa_verified),
            "age_minutes": int((now - session.created_at).total_seconds() // 60) if session else 0,
        },
        device=(
            {"id": str(device.id), "name": device.name, "trust_status": device.trust_status, "risk_score": device.risk_score}
            if device else None
        ),
        request={"ip": ip, **time_attrs(db, now)},
        resource=resource_dict(resource),
        entitlement={
            "has_permission": bool(resource.required_permission and resource.required_permission in perms),
            "has_active_grant": has_active_grant(db, user.id, resource.id),
            "assumed_for_request": assume_entitled,
        },
    )


def persist_decision(
    db: Session, ctx: EvaluationContext, result: EvaluationResult, *, user: User, resource: ProtectedResource,
    session: UserSession | None, device: Device | None, ip: str | None, source: str, access_request_id=None,
) -> AccessDecision:
    d = AccessDecision(
        user_id=user.id, resource_id=resource.id, session_id=session.id if session else None,
        device_id=device.id if device else None, access_request_id=access_request_id, decision=result.decision,
        reasons=result.reasons, trace=result.trace, ip_address=ip, source=source, duration_ms=result.duration_ms,
        context={
            "user": {k: ctx.user[k] for k in ("email", "status", "roles", "risk_score", "mfa_enabled", "department")},
            "session": ctx.session, "device": ctx.device, "request": ctx.request,
            "resource": {k: ctx.resource[k] for k in ("slug", "name", "sensitivity", "type", "required_permission")},
            "entitlement": ctx.entitlement, "required_actions": result.required_actions,
        },
    )
    for m in result.matched_policies:
        d.matched_policies.append(
            AccessDecisionPolicy(policy_id=m["policy_id"], action=m["action"], was_deciding=m.get("deciding", False))
        )
    db.add(d)
    db.flush()
    sev = "medium" if result.decision == "DENY" else "informational"
    audit.record(
        db, "access.decision", "access", actor=user, severity=sev,
        outcome="success" if result.decision in ("ALLOW", "RESTRICTED_ACCESS") else "failure",
        target_type="resource", target_id=resource.id, target_label=resource.name, ip=ip,
        details={"decision": result.decision, "source": source, "decision_id": str(d.id), "reasons": result.reasons[:3]},
    )
    queue_event(
        db, "access.decision",
        {"id": str(d.id), "decision": d.decision, "user": user.email, "resource": resource.name, "source": source},
        ADMINS,
    )
    queue_event(db, "access.decision", {"id": str(d.id), "decision": d.decision, "resource": resource.name},
                {"users": [str(user.id)]})
    threats.on_access_decision(db, user, result.decision, ip)
    return d


def evaluate_access(
    db: Session, user: User, resource: ProtectedResource, session: UserSession | None, device: Device | None,
    ip: str | None, source: str = "gateway", access_request_id=None, assume_entitled: bool = False,
) -> tuple[AccessDecision, EvaluationResult]:
    ctx = build_context(db, user, resource, session, device, ip, assume_entitled=assume_entitled)
    result = build_engine(db).evaluate(ctx)
    d = persist_decision(db, ctx, result, user=user, resource=resource, session=session, device=device, ip=ip,
                         source=source, access_request_id=access_request_id)
    return d, result
