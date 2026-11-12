"""Zero Trust policy management, execution history and simulator."""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.utils import bad_request, conflict, not_found
from app.core.deps import AuthContext, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import AccessDecision, AccessDecisionPolicy, Device, Policy, PolicyCondition, ProtectedResource, User
from app.models.enums import Decision
from app.policy_engine.engine import EvaluationContext, PolicyEngine, PolicyRule
from app.policy_engine.fields import FIELDS, OPERATORS, validate_condition
from app.services import audit
from app.services.access import build_engine, has_active_grant, policy_rule, resource_dict, time_attrs
from app.services.org import get_org

router = APIRouter(prefix="/policies", tags=["Zero Trust Policies"])
ACTIONS = "^(ALLOW|DENY|REQUIRE_MFA|REQUIRE_DEVICE_VERIFICATION|RESTRICTED_ACCESS)$"


class ConditionIn(BaseModel):
    field: str = Field(max_length=60)
    operator: str = Field(max_length=20)
    value: Any = None

    @model_validator(mode="after")
    def check(self):
        err = validate_condition(self.field, self.operator, self.value)
        if err:
            raise ValueError(err)
        return self


class PolicyIn(BaseModel):
    name: str = Field(min_length=3, max_length=150)
    description: str = Field("", max_length=2000)
    priority: int = Field(100, ge=1, le=10000)
    action: str = Field(pattern=ACTIONS)
    match_mode: str = Field("all", pattern="^(all|any)$")
    is_enabled: bool = True
    conditions: list[ConditionIn] = Field(default_factory=list, max_length=20)


class ReorderIn(BaseModel):
    policy_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class SimulateIn(BaseModel):
    user_id: uuid.UUID | None = None
    resource_id: uuid.UUID
    roles: list[str] | None = None
    user_status: str | None = Field(None, pattern="^(active|suspended|deactivated|locked)$")
    risk_score: int | None = Field(None, ge=0, le=100)
    department: str | None = Field(None, max_length=100)
    mfa_enabled: bool | None = None
    mfa_verified: bool = False
    session_valid: bool = True
    device_trust_status: str = Field("trusted", pattern="^(trusted|untrusted|suspicious|blocked|pending_verification|unknown)$")
    device_risk_score: int = Field(0, ge=0, le=100)
    ip_address: str = Field("10.0.0.10", max_length=64)
    hour: int | None = Field(None, ge=0, le=23)
    weekday: int | None = Field(None, ge=0, le=6)
    has_entitlement: bool | None = None
    draft_policy: PolicyIn | None = None


def policy_out(p: Policy, stats: dict | None = None) -> dict:
    return {
        "id": str(p.id), "name": p.name, "description": p.description, "priority": p.priority, "action": p.action,
        "match_mode": p.match_mode, "is_enabled": p.is_enabled, "version": p.version, "is_demo": p.is_demo,
        "created_at": p.created_at, "updated_at": p.updated_at,
        "conditions": [{"id": str(c.id), "field": c.field, "operator": c.operator, "value": c.value} for c in p.conditions],
        "stats": stats or {"matches_30d": 0, "deciding_30d": 0, "last_matched_at": None},
    }


def _stats(db: Session) -> dict:
    since = utcnow() - timedelta(days=30)
    rows = db.execute(
        select(AccessDecisionPolicy.policy_id, func.count(), func.sum(case((AccessDecisionPolicy.was_deciding.is_(True), 1), else_=0)),
               func.max(AccessDecision.evaluated_at))
        .join(AccessDecision, AccessDecision.id == AccessDecisionPolicy.decision_id)
        .where(AccessDecision.evaluated_at >= since).group_by(AccessDecisionPolicy.policy_id)
    ).all()
    return {r[0]: {"matches_30d": r[1], "deciding_30d": int(r[2] or 0), "last_matched_at": r[3]} for r in rows}


def _apply(p: Policy, body: PolicyIn) -> None:
    p.name, p.description, p.priority, p.action = body.name, body.description, body.priority, body.action
    p.match_mode, p.is_enabled = body.match_mode, body.is_enabled
    p.conditions = [PolicyCondition(field=c.field, operator=c.operator, value=c.value, position=i)
                    for i, c in enumerate(body.conditions)]


@router.get("/fields")
def fields(auth: AuthContext = Depends(require("policies:read"))) -> dict:
    return {"fields": FIELDS, "operators": OPERATORS, "actions": [d.value for d in Decision]}


@router.get("")
def list_policies(auth: AuthContext = Depends(require("policies:read")), db: Session = Depends(get_db)) -> list[dict]:
    stats = _stats(db)
    ps = db.execute(select(Policy).order_by(Policy.priority, Policy.name)).scalars().all()
    return [policy_out(p, stats.get(p.id)) for p in ps]


@router.post("", status_code=201)
def create_policy(body: PolicyIn, auth: AuthContext = Depends(require("policies:write")), db: Session = Depends(get_db)) -> dict:
    if db.execute(select(Policy.id).where(Policy.name == body.name)).first():
        raise conflict("A policy with this name already exists")
    p = Policy(created_by_id=auth.user.id, updated_by_id=auth.user.id)
    _apply(p, body)
    db.add(p)
    db.flush()
    audit.record(db, "policy.created", "policy", actor=auth.user, ip=auth.client.ip, severity="medium",
                 target_type="policy", target_id=p.id, target_label=p.name, details=body.model_dump())
    db.commit()
    return policy_out(p)


@router.post("/reorder")
def reorder(body: ReorderIn, auth: AuthContext = Depends(require("policies:write")), db: Session = Depends(get_db)) -> list[dict]:
    ps = {p.id: p for p in db.execute(select(Policy).where(Policy.id.in_(body.policy_ids))).scalars()}
    if len(ps) != len(set(body.policy_ids)):
        raise bad_request("Unknown policy id in ordering")
    for i, pid in enumerate(body.policy_ids):
        new_prio = (i + 1) * 10
        if ps[pid].priority != new_prio:
            audit.record(db, "policy.priority_changed", "policy", actor=auth.user, ip=auth.client.ip, severity="medium",
                         target_type="policy", target_id=pid, target_label=ps[pid].name,
                         details={"from": ps[pid].priority, "to": new_prio})
            ps[pid].priority = new_prio
            ps[pid].version += 1
    audit.record(db, "policy.reordered", "policy", actor=auth.user, ip=auth.client.ip, severity="medium",
                 details={"order": [ps[pid].name for pid in body.policy_ids]})
    db.commit()
    return list_policies(auth, db)


@router.post("/simulate")
def simulate(body: SimulateIn, auth: AuthContext = Depends(require("policies:simulate")), db: Session = Depends(get_db)) -> dict:
    resource = db.get(ProtectedResource, body.resource_id)
    if not resource:
        raise not_found("Resource")
    user = db.get(User, body.user_id) if body.user_id else None
    if body.user_id and not user:
        raise not_found("User")
    roles = body.roles if body.roles is not None else (user.role_names if user else ["employee"])
    perms = user.permission_codes if user else set()
    entitled = body.has_entitlement
    if entitled is None:
        entitled = bool(user and (resource.required_permission in perms or has_active_grant(db, user.id, resource.id)))
    t = time_attrs(db)
    if body.hour is not None:
        t["hour"] = body.hour
    if body.weekday is not None:
        t["weekday"] = body.weekday
    org = get_org(db)
    t["is_business_hours"] = org.business_hours_start <= t["hour"] < org.business_hours_end and t["weekday"] < 5
    ctx = EvaluationContext(
        user={"id": str(user.id) if user else None, "email": user.email if user else "simulated@user",
              "status": body.user_status or (user.status if user else "active"), "roles": roles,
              "risk_score": body.risk_score if body.risk_score is not None else (user.risk_score if user else 0),
              "mfa_enabled": body.mfa_enabled if body.mfa_enabled is not None else bool(user and user.mfa_enabled),
              "department": body.department if body.department is not None else (user.department if user else None)},
        session={"id": None, "valid": body.session_valid, "mfa_verified": body.mfa_verified, "age_minutes": 5},
        device=None if body.device_trust_status == "unknown" else {"id": None, "name": "Simulated device",
                                                                      "trust_status": body.device_trust_status,
                                                                      "risk_score": body.device_risk_score},
        request={"ip": body.ip_address, **t},
        resource=resource_dict(resource),
        entitlement={"has_permission": entitled, "has_active_grant": False},
    )
    engine = build_engine(db)
    if body.draft_policy:
        draft = PolicyRule(id="draft", name=f"(draft) {body.draft_policy.name}", priority=body.draft_policy.priority,
                           action=body.draft_policy.action, match_mode=body.draft_policy.match_mode,
                           conditions=[c.model_dump() for c in body.draft_policy.conditions])
        engine = PolicyEngine([*engine.policies, draft], engine.t)
    result = engine.evaluate(ctx)
    audit.record(db, "policy.simulated", "policy", actor=auth.user, ip=auth.client.ip, target_type="resource",
                 target_id=resource.id, target_label=resource.name, details={"decision": result.decision})
    db.commit()
    return {"context": {"user": ctx.user, "session": ctx.session, "device": ctx.device, "request": ctx.request,
                        "resource": ctx.resource, "entitlement": ctx.entitlement}, **result.to_dict()}


@router.get("/{policy_id}")
def get_policy(policy_id: uuid.UUID, auth: AuthContext = Depends(require("policies:read")), db: Session = Depends(get_db)) -> dict:
    p = db.get(Policy, policy_id)
    if not p:
        raise not_found("Policy")
    history = db.execute(
        select(AccessDecisionPolicy, AccessDecision)
        .join(AccessDecision, AccessDecision.id == AccessDecisionPolicy.decision_id)
        .where(AccessDecisionPolicy.policy_id == p.id).order_by(AccessDecision.evaluated_at.desc()).limit(50)
    ).all()
    changes = audit_changes(db, p.id)
    return {
        **policy_out(p, _stats(db).get(p.id)),
        "executions": [{"decision_id": str(d.id), "final_decision": d.decision, "policy_action": l.action,
                        "was_deciding": l.was_deciding, "user": d.user.email if d.user else None,
                        "resource": d.resource.name if d.resource else None, "evaluated_at": d.evaluated_at,
                        "source": d.source} for l, d in history],
        "change_history": changes,
    }


def audit_changes(db: Session, pid: uuid.UUID) -> list[dict]:
    from app.models import AuditLog

    rows = db.execute(select(AuditLog).where(AuditLog.target_type == "policy", AuditLog.target_id == str(pid))
                      .order_by(AuditLog.id.desc()).limit(30)).scalars()
    return [{"id": r.id, "action": r.action, "actor": r.actor_email, "created_at": r.created_at, "details": r.details}
            for r in rows]


@router.put("/{policy_id}")
def update_policy(policy_id: uuid.UUID, body: PolicyIn, auth: AuthContext = Depends(require("policies:write")),
                  db: Session = Depends(get_db)) -> dict:
    p = db.get(Policy, policy_id)
    if not p:
        raise not_found("Policy")
    if db.execute(select(Policy.id).where(Policy.name == body.name, Policy.id != p.id)).first():
        raise conflict("A policy with this name already exists")
    before = policy_rule(p).__dict__
    _apply(p, body)
    p.version += 1
    p.updated_by_id = auth.user.id
    audit.record(db, "policy.updated", "policy", actor=auth.user, ip=auth.client.ip, severity="medium",
                 target_type="policy", target_id=p.id, target_label=p.name,
                 details={"before": {k: before[k] for k in ("name", "priority", "action", "conditions", "enabled")},
                          "after": body.model_dump(), "version": p.version})
    db.commit()
    return policy_out(p)


@router.post("/{policy_id}/toggle")
def toggle_policy(policy_id: uuid.UUID, auth: AuthContext = Depends(require("policies:write")), db: Session = Depends(get_db)) -> dict:
    p = db.get(Policy, policy_id)
    if not p:
        raise not_found("Policy")
    p.is_enabled = not p.is_enabled
    p.version += 1
    audit.record(db, "policy.enabled" if p.is_enabled else "policy.disabled", "policy", actor=auth.user,
                 ip=auth.client.ip, severity="medium", target_type="policy", target_id=p.id, target_label=p.name)
    db.commit()
    return policy_out(p)


@router.delete("/{policy_id}", status_code=204)
def delete_policy(policy_id: uuid.UUID, auth: AuthContext = Depends(require("policies:write")), db: Session = Depends(get_db)) -> None:
    p = db.get(Policy, policy_id)
    if not p:
        raise not_found("Policy")
    audit.record(db, "policy.deleted", "policy", actor=auth.user, ip=auth.client.ip, severity="high",
                 target_type="policy", target_id=p.id, target_label=p.name, details={"snapshot": policy_out(p)["conditions"],
                                                                                    "action": p.action})
    db.delete(p)
    db.commit()
