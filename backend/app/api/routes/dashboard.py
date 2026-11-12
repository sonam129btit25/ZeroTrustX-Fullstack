"""Dashboard analytics computed from live database records."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, select, text
from sqlalchemy.orm import Session

from app.api.utils import bad_request
from app.core.deps import AuthContext, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import AccessDecision, AccessRequest, AuditLog, Device, Policy, SecurityEvent, ThreatAlert, User, UserSession
from app.services import risk
from app.ws.manager import manager

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
STARTED = time.time()


def _range(range_: str, start: datetime | None, end: datetime | None) -> tuple[datetime, datetime, str]:
    now = utcnow()
    if range_ == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0), now, "hour"
    if range_ == "7d":
        return now - timedelta(days=7), now, "day"
    if range_ == "30d":
        return now - timedelta(days=30), now, "day"
    if not start or not end or start >= end:
        raise bad_request("Custom range requires start < end")
    if end - start > timedelta(days=366):
        raise bad_request("Custom range cannot exceed one year")
    return start, end, "hour" if end - start <= timedelta(days=2) else "day"


def _bucket(dt: datetime, unit: str) -> str:
    return dt.strftime("%Y-%m-%dT%H:00") if unit == "hour" else dt.strftime("%Y-%m-%d")


def _buckets(start: datetime, end: datetime, unit: str) -> list[str]:
    step = timedelta(hours=1) if unit == "hour" else timedelta(days=1)
    cur = start.replace(minute=0, second=0, microsecond=0)
    if unit == "day":
        cur = cur.replace(hour=0)
    out = []
    while cur <= end:
        out.append(_bucket(cur, unit))
        cur += step
    return out


@router.get("/overview")
def overview(
    request: Request,
    range: str = Query("7d", pattern="^(today|7d|30d|custom)$"),
    start: datetime | None = None,
    end: datetime | None = None,
    auth: AuthContext = Depends(require("dashboard:read")),
    db: Session = Depends(get_db),
) -> dict:
    s, e, unit = _range(range, start, end)
    now = utcnow()
    count = lambda q: db.scalar(q) or 0  # noqa: E731

    metrics = {
        "total_users": count(select(func.count()).select_from(User)),
        "active_users": count(select(func.count()).select_from(User).where(User.status == "active")),
        "active_sessions": count(select(func.count()).select_from(UserSession).where(
            UserSession.revoked_at.is_(None), UserSession.expires_at > now)),
        "trusted_devices": count(select(func.count()).select_from(Device).where(Device.trust_status == "trusted")),
        "total_devices": count(select(func.count()).select_from(Device)),
        "blocked_requests": count(select(func.count()).select_from(AccessDecision).where(
            AccessDecision.decision == "DENY", AccessDecision.evaluated_at.between(s, e))),
        "access_evaluations": count(select(func.count()).select_from(AccessDecision).where(AccessDecision.evaluated_at.between(s, e))),
        "active_threats": count(select(func.count()).select_from(ThreatAlert).where(ThreatAlert.status.in_(["open", "investigating"]))),
        "threats_in_range": count(select(func.count()).select_from(ThreatAlert).where(ThreatAlert.detected_at.between(s, e))),
        "policy_violations": count(select(func.count()).select_from(AccessDecision).where(
            AccessDecision.decision != "ALLOW", AccessDecision.evaluated_at.between(s, e))),
        "pending_requests": count(select(func.count()).select_from(AccessRequest).where(AccessRequest.status == "pending")),
        "mfa_adoption": 0,
        "enabled_policies": count(select(func.count()).select_from(Policy).where(Policy.is_enabled.is_(True))),
    }
    if metrics["total_users"]:
        mfa = count(select(func.count()).select_from(User).where(User.mfa_enabled.is_(True)))
        metrics["mfa_adoption"] = round(100 * mfa / metrics["total_users"])

    keys = _buckets(s, e, unit)
    activity = {k: {"bucket": k, "events": 0, "high_severity": 0} for k in keys}
    for created, sev in db.execute(select(AuditLog.created_at, AuditLog.severity).where(AuditLog.created_at.between(s, e))):
        b = activity.get(_bucket(created, unit))
        if b:
            b["events"] += 1
            if sev in ("high", "critical"):
                b["high_severity"] += 1

    access = {k: {"bucket": k, "ALLOW": 0, "DENY": 0, "REQUIRE_MFA": 0, "REQUIRE_DEVICE_VERIFICATION": 0,
                  "RESTRICTED_ACCESS": 0} for k in keys}
    decision_totals: dict[str, int] = defaultdict(int)
    for ts, dec in db.execute(select(AccessDecision.evaluated_at, AccessDecision.decision).where(
            AccessDecision.evaluated_at.between(s, e), AccessDecision.source != "simulation")):
        decision_totals[dec] += 1
        b = access.get(_bucket(ts, unit))
        if b:
            b[dec] += 1

    auth_series = {k: {"bucket": k, "success": 0, "failure": 0, "mfa_failure": 0} for k in keys}
    for ts, et in db.execute(select(SecurityEvent.created_at, SecurityEvent.event_type).where(
            SecurityEvent.created_at.between(s, e),
            SecurityEvent.event_type.in_(["login_success", "login_failure", "mfa_failure"]))):
        b = auth_series.get(_bucket(ts, unit))
        if b:
            b[{"login_success": "success", "login_failure": "failure", "mfa_failure": "mfa_failure"}[et]] += 1
    succ = sum(b["success"] for b in auth_series.values())
    fail = sum(b["failure"] for b in auth_series.values())

    threat_series = {k: {"bucket": k, "critical": 0, "high": 0, "medium": 0, "low": 0, "informational": 0} for k in keys}
    for ts, sev in db.execute(select(ThreatAlert.detected_at, ThreatAlert.severity).where(ThreatAlert.detected_at.between(s, e))):
        b = threat_series.get(_bucket(ts, unit))
        if b:
            b[sev] += 1

    dist = {"minimal": 0, "low": 0, "medium": 0, "high": 0, "critical": 0}
    for (score,) in db.execute(select(User.risk_score).where(User.status == "active")):
        dist[risk.level(score)] += 1

    trust = dict(db.execute(select(Device.trust_status, func.count()).group_by(Device.trust_status)).all())

    recent = db.execute(select(AuditLog).where(AuditLog.severity.in_(["medium", "high", "critical"]) | AuditLog.category.in_(
        ["authentication", "access", "threat"])).order_by(AuditLog.id.desc()).limit(12)).scalars()
    high_risk = db.execute(select(User).where(User.status == "active").order_by(User.risk_score.desc()).limit(6)).scalars()

    geo_rows = db.execute(select(SecurityEvent.location, SecurityEvent.country_code, func.count(),
                                 func.sum(case((SecurityEvent.event_type == "login_failure", 1), else_=0)))
                          .where(SecurityEvent.created_at.between(s, e),
                                 SecurityEvent.event_type.in_(["login_success", "login_failure"]))
                          .group_by(SecurityEvent.location, SecurityEvent.country_code)).all()
    geo = sorted([{"location": loc or "Unknown (no GeoIP)", "country_code": cc, "logins": n, "failures": int(f or 0)}
                  for loc, cc, n, f in geo_rows], key=lambda x: -x["logins"])

    t0 = time.perf_counter()
    db.execute(text("SELECT 1"))
    db_ms = round((time.perf_counter() - t0) * 1000, 2)

    return {
        "range": {"start": s, "end": e, "unit": unit},
        "metrics": metrics,
        "series": {
            "security_activity": list(activity.values()), "access_decisions": list(access.values()),
            "authentication": list(auth_series.values()), "threats": list(threat_series.values()),
        },
        "auth_rates": {"success": succ, "failure": fail,
                       "success_rate": round(100 * succ / (succ + fail), 1) if succ + fail else None},
        "decision_totals": dict(decision_totals),
        "risk_distribution": [{"level": k, "users": v} for k, v in dist.items()],
        "device_trust": [{"status": k, "count": trust.get(k, 0)} for k in
                         ("trusted", "pending_verification", "untrusted", "suspicious", "blocked")],
        "recent_events": [{"id": a.id, "action": a.action, "category": a.category, "severity": a.severity,
                           "actor_email": a.actor_email, "target_label": a.target_label, "created_at": a.created_at,
                           "outcome": a.outcome, "is_demo": a.is_demo} for a in recent],
        "high_risk_users": [{"id": str(u.id), "email": u.email, "full_name": u.full_name, "risk_score": u.risk_score,
                             "risk_level": risk.level(u.risk_score), "department": u.department} for u in high_risk],
        "geo_activity": geo,
        "system_health": {
            "api": "operational", "database": "operational", "database_latency_ms": db_ms,
            "realtime": "operational", "websocket_clients": manager.count,
            "uptime_seconds": int(time.time() - STARTED), "policy_engine": "operational",
        },
    }
