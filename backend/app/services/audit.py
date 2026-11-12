"""Tamper-evident audit logging (hash chain + append-only enforcement)."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import AuditLog, User
from app.ws.manager import ADMINS, queue_event

AUDIT_LOCK_KEY = 7_420_001


def _digest(prev: str | None, row: dict[str, Any]) -> str:
    payload = json.dumps(row, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(((prev or "") + payload).encode()).hexdigest()


def _ts(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")


def _canonical(log: AuditLog) -> dict[str, Any]:
    return {
        "created_at": _ts(log.created_at),
        "actor_id": str(log.actor_id) if log.actor_id else None,
        "action": log.action,
        "category": log.category,
        "severity": log.severity,
        "outcome": log.outcome,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "ip_address": log.ip_address,
        "details": log.details,
        "is_demo": log.is_demo,
    }


def record(
    db: Session,
    action: str,
    category: str,
    *,
    actor: User | None = None,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    severity: str = "informational",
    outcome: str = "success",
    target_type: str | None = None,
    target_id: Any = None,
    target_label: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
    is_demo: bool = False,
    created_at=None,
) -> AuditLog:
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": AUDIT_LOCK_KEY})
    prev = db.execute(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1)).scalar()
    log = AuditLog(
        created_at=created_at or utcnow(),
        actor_id=actor.id if actor else actor_id,
        actor_email=actor.email if actor else actor_email,
        action=action,
        category=category,
        severity=severity,
        outcome=outcome,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        target_label=target_label,
        ip_address=ip,
        user_agent=user_agent,
        details=details or {},
        is_demo=is_demo,
        prev_hash=prev,
    )
    log.hash = _digest(prev, _canonical(log))
    db.add(log)
    db.flush()
    if not is_demo:
        queue_event(
            db,
            "audit.created",
            {"id": log.id, "action": action, "category": category, "severity": severity, "actor_email": log.actor_email},
            ADMINS,
        )
    return log


def verify_chain(db: Session, limit: int | None = None) -> dict[str, Any]:
    q = select(AuditLog).order_by(AuditLog.id.asc())
    prev: str | None = None
    checked = 0
    for log in db.execute(q).scalars():
        if log.prev_hash != prev or _digest(prev, _canonical(log)) != log.hash:
            return {"valid": False, "checked": checked, "broken_at_id": log.id}
        prev = log.hash
        checked += 1
        if limit and checked >= limit:
            break
    return {"valid": True, "checked": checked, "broken_at_id": None}
