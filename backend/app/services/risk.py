"""Explainable, rule-based user risk scoring (0-100). Weights are configurable in org settings."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import AccessDecision, SecurityEvent, ThreatAlert, User, UserSession
from app.services.org import get_org, risk_weights


def compute_user_risk(db: Session, user: User) -> tuple[int, list[dict[str, Any]]]:
    org = get_org(db)
    w = risk_weights(org)
    since = utcnow() - timedelta(hours=24)
    factors: list[dict[str, Any]] = []

    def add(key: str, label: str, points: int) -> None:
        if points > 0:
            factors.append({"factor": key, "label": label, "points": points})

    failed = db.scalar(
        select(func.count()).select_from(SecurityEvent).where(
            SecurityEvent.user_id == user.id, SecurityEvent.event_type == "login_failure", SecurityEvent.created_at >= since
        )
    ) or 0
    add("failed_login", f"{failed} failed login attempt(s) in 24h", min(failed * w["failed_login"], w["failed_login_cap"]))

    denied = db.scalar(
        select(func.count()).select_from(AccessDecision).where(
            AccessDecision.user_id == user.id, AccessDecision.decision == "DENY", AccessDecision.evaluated_at >= since
        )
    ) or 0
    add("access_denied", f"{denied} access denial(s) in 24h", min(denied * w["access_denied"], w["access_denied_cap"]))

    last_session = db.execute(
        select(UserSession).where(UserSession.user_id == user.id).order_by(UserSession.created_at.desc()).limit(1)
    ).scalar()
    if last_session and (last_session.device is None or last_session.device.trust_status != "trusted"):
        add("untrusted_device", "Most recent session used a non-trusted device", w["untrusted_device"])

    if not user.mfa_enabled:
        add("no_mfa", "MFA is not enrolled", w["no_mfa"])

    alerts = db.execute(
        select(ThreatAlert.severity, func.count()).where(
            ThreatAlert.user_id == user.id, ThreatAlert.status.in_(["open", "investigating"])
        ).group_by(ThreatAlert.severity)
    ).all()
    for sev, cnt in alerts:
        if sev in ("high", "critical"):
            add("open_alert_high", f"{cnt} open {sev} alert(s)", cnt * w["open_alert_high"])
        elif sev == "medium":
            add("open_alert_medium", f"{cnt} open medium alert(s)", cnt * w["open_alert_medium"])

    off_hours = db.scalar(
        select(func.count()).select_from(ThreatAlert).where(
            ThreatAlert.user_id == user.id, ThreatAlert.rule_key == "unusual_login_time", ThreatAlert.detected_at >= since
        )
    ) or 0
    if off_hours:
        add("off_hours_login", "Login outside business hours in 24h", w["off_hours_login"])

    new_ip = db.scalar(
        select(func.count()).select_from(ThreatAlert).where(
            ThreatAlert.user_id == user.id, ThreatAlert.rule_key == "ip_change", ThreatAlert.detected_at >= since
        )
    ) or 0
    if new_ip:
        add("new_ip", "Login from a new IP address in 24h", w["new_ip"])

    score = max(0, min(100, sum(f["points"] for f in factors)))
    return score, factors


def recompute_user_risk(db: Session, user: User) -> int:
    score, _ = compute_user_risk(db, user)
    user.risk_score = score
    return score


def level(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
        return "medium"
    if score >= 15:
        return "low"
    return "minimal"
