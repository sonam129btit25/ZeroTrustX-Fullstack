"""Explainable rule-based anomaly detection. No ML or external threat-intel feeds are used."""
from __future__ import annotations

from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import AccessDecision, Device, SecurityEvent, ThreatAlert, User
from app.services import audit
from app.services.notify import notify_permission
from app.services.org import get_org
from app.ws.manager import SECURITY, queue_event

RULES: dict[str, dict[str, Any]] = {
    "brute_force": {
        "title": "Repeated failed login attempts",
        "category": "Credential Attack",
        "severity": "high",
        "description": "{count} failed logins for {email} within 15 minutes.",
        "action": "Verify the user's identity, consider resetting the password and confirm MFA enrolment.",
        "risk": 70,
    },
    "password_spray": {
        "title": "Password spraying from single IP",
        "category": "Credential Attack",
        "severity": "critical",
        "description": "{count} failed logins across {accounts} accounts from {ip} within 15 minutes.",
        "action": "Block the source IP at the perimeter and review targeted accounts.",
        "risk": 90,
    },
    "access_denials": {
        "title": "Multiple access denials",
        "category": "Access Anomaly",
        "severity": "medium",
        "description": "{count} access requests by {email} were denied within 30 minutes.",
        "action": "Review whether the user needs additional entitlements or is probing resources.",
        "risk": 45,
    },
    "unusual_login_time": {
        "title": "Login outside business hours",
        "category": "Behavioural Anomaly",
        "severity": "low",
        "description": "{email} signed in at {hour:02d}:00 ({tz}), outside business hours {start:02d}:00-{end:02d}:00.",
        "action": "Confirm the activity with the user if it is unexpected.",
        "risk": 20,
    },
    "new_device": {
        "title": "Sign-in from unrecognised device",
        "category": "Device Trust",
        "severity": "low",
        "description": "{email} signed in from a new device '{device}' that is pending verification.",
        "action": "Verify the device with the user before granting trust.",
        "risk": 25,
    },
    "untrusted_device_login": {
        "title": "Sign-in from untrusted or suspicious device",
        "category": "Device Trust",
        "severity": "medium",
        "description": "{email} signed in from device '{device}' with trust status '{trust}'.",
        "action": "Inspect the device history; block it if the activity is not legitimate.",
        "risk": 45,
    },
    "ip_change": {
        "title": "Unexpected IP address change",
        "category": "Behavioural Anomaly",
        "severity": "low",
        "description": "{email} signed in from {ip}; previous sign-in was from {previous_ip}.",
        "action": "Check whether the new network location is expected.",
        "risk": 20,
    },
    "session_ip_change": {
        "title": "Session token used from a different IP",
        "category": "Session Anomaly",
        "severity": "medium",
        "description": "Session for {email} was refreshed from {ip} but started from {previous_ip}.",
        "action": "Terminate the session if the user cannot explain the change (possible token theft).",
        "risk": 55,
    },
    "refresh_token_reuse": {
        "title": "Refresh token reuse detected",
        "category": "Session Anomaly",
        "severity": "high",
        "description": "A rotated refresh token for {email} was presented again. The session was revoked.",
        "action": "Treat the session credentials as compromised; require password reset.",
        "risk": 75,
    },
    "abnormal_access_frequency": {
        "title": "Abnormal access frequency",
        "category": "Access Anomaly",
        "severity": "medium",
        "description": "{email} made {count} resource access evaluations within 10 minutes.",
        "action": "Check for automation or scraping using the user's session.",
        "risk": 50,
    },
    "mfa_failures": {
        "title": "Repeated MFA failures",
        "category": "Credential Attack",
        "severity": "high",
        "description": "{count} failed MFA verifications for {email} within 15 minutes after a correct password.",
        "action": "The password may be compromised. Force a password reset and contact the user.",
        "risk": 70,
    },
}


def create_alert(
    db: Session, rule_key: str, *, user: User | None = None, device: Device | None = None, session_id=None,
    ip: str | None = None, evidence: dict[str, Any] | None = None, dedup_minutes: int = 60, fmt: dict[str, Any] | None = None,
) -> ThreatAlert | None:
    rule = RULES[rule_key]
    since = utcnow() - timedelta(minutes=dedup_minutes)
    q = select(ThreatAlert).where(
        ThreatAlert.rule_key == rule_key,
        ThreatAlert.detected_at >= since,
        ThreatAlert.status.in_(["open", "investigating"]),
    )
    q = q.where(ThreatAlert.user_id == user.id) if user else q.where(ThreatAlert.ip_address == ip)
    existing = db.execute(q.limit(1)).scalar()
    if existing:
        ev = dict(existing.evidence or {})
        ev["occurrences"] = int(ev.get("occurrences", 1)) + 1
        ev.update(evidence or {})
        existing.evidence = ev
        return None

    fmt = {"email": user.email if user else "unknown", "ip": ip, **(fmt or {})}
    alert = ThreatAlert(
        rule_key=rule_key,
        title=rule["title"],
        description=rule["description"].format(**fmt),
        category=rule["category"],
        severity=rule["severity"],
        user_id=user.id if user else None,
        device_id=device.id if device else None,
        session_id=session_id,
        ip_address=ip,
        risk_score=rule["risk"],
        recommended_action=rule["action"],
        evidence={"occurrences": 1, **(evidence or {})},
    )
    db.add(alert)
    db.flush()
    audit.record(
        db, "threat.detected", "threat", actor_email="system", severity=rule["severity"],
        target_type="threat_alert", target_id=alert.id, target_label=alert.title,
        details={"rule": rule_key, "user": fmt["email"], "ip": ip},
    )
    queue_event(
        db, "threat.created",
        {"id": str(alert.id), "title": alert.title, "severity": alert.severity, "user": fmt["email"]},
        SECURITY,
    )
    org = get_org(db)
    if alert.severity in ("high", "critical") and (org.notification_settings or {}).get("notify_admins_on_high_alerts", True):
        notify_permission(
            db, "threats:read", f"{alert.severity.title()} alert: {alert.title}", alert.description,
            category="threat", severity=alert.severity, link=f"/threats?alert={alert.id}",
        )
    return alert


def _count_events(db: Session, minutes: int, **filters) -> int:
    since = utcnow() - timedelta(minutes=minutes)
    q = select(func.count()).select_from(SecurityEvent).where(SecurityEvent.created_at >= since)
    for k, v in filters.items():
        q = q.where(getattr(SecurityEvent, k) == v)
    return db.scalar(q) or 0


def on_login_failure(db: Session, user: User | None, email: str, ip: str | None) -> None:
    if user:
        n = _count_events(db, 15, user_id=user.id, event_type="login_failure")
        if n >= 5:
            create_alert(db, "brute_force", user=user, ip=ip, evidence={"failed_attempts": n}, fmt={"count": n})
    if ip:
        since = utcnow() - timedelta(minutes=15)
        rows = db.execute(
            select(func.count(), func.count(func.distinct(SecurityEvent.email_attempted))).where(
                SecurityEvent.ip_address == ip, SecurityEvent.event_type == "login_failure", SecurityEvent.created_at >= since
            )
        ).one()
        if rows[0] >= 10 and rows[1] >= 3:
            create_alert(db, "password_spray", ip=ip, evidence={"failures": rows[0], "accounts": rows[1]},
                         fmt={"count": rows[0], "accounts": rows[1]})


def on_mfa_failure(db: Session, user: User, ip: str | None) -> None:
    n = _count_events(db, 15, user_id=user.id, event_type="mfa_failure")
    if n >= 3:
        create_alert(db, "mfa_failures", user=user, ip=ip, evidence={"failed_mfa": n}, fmt={"count": n})


def on_login_success(db: Session, user: User, ip: str | None, device: Device | None, previous_ip: str | None,
                     device_is_new: bool, session_id=None) -> None:
    org = get_org(db)
    try:
        tz = ZoneInfo(org.timezone)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo("UTC")
    hour = utcnow().astimezone(tz).hour
    if not (org.business_hours_start <= hour < org.business_hours_end):
        create_alert(db, "unusual_login_time", user=user, ip=ip, session_id=session_id, dedup_minutes=240,
                     fmt={"hour": hour, "tz": org.timezone, "start": org.business_hours_start, "end": org.business_hours_end},
                     evidence={"hour": hour})
    if device is not None:
        if device_is_new:
            create_alert(db, "new_device", user=user, device=device, ip=ip, session_id=session_id,
                         fmt={"device": device.name}, evidence={"device_identifier": device.device_identifier})
        elif device.trust_status in ("untrusted", "suspicious"):
            create_alert(db, "untrusted_device_login", user=user, device=device, ip=ip, session_id=session_id,
                         fmt={"device": device.name, "trust": device.trust_status})
    if previous_ip and ip and previous_ip != ip:
        create_alert(db, "ip_change", user=user, ip=ip, session_id=session_id, dedup_minutes=240,
                     fmt={"previous_ip": previous_ip}, evidence={"previous_ip": previous_ip, "new_ip": ip})


def on_access_decision(db: Session, user: User, decision: str, ip: str | None) -> None:
    since30 = utcnow() - timedelta(minutes=30)
    if decision == "DENY":
        n = db.scalar(select(func.count()).select_from(AccessDecision).where(
            AccessDecision.user_id == user.id, AccessDecision.decision == "DENY", AccessDecision.evaluated_at >= since30,
            AccessDecision.source != "simulation"))
        if n and n >= 3:
            create_alert(db, "access_denials", user=user, ip=ip, evidence={"denials": n}, fmt={"count": n})
    since10 = utcnow() - timedelta(minutes=10)
    n = db.scalar(select(func.count()).select_from(AccessDecision).where(
        AccessDecision.user_id == user.id, AccessDecision.evaluated_at >= since10, AccessDecision.source != "simulation"))
    if n and n >= 20:
        create_alert(db, "abnormal_access_frequency", user=user, ip=ip, evidence={"evaluations": n}, fmt={"count": n})
