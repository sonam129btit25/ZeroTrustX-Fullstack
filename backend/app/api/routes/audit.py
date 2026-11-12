"""Audit log search, export and integrity verification (read-only API; no update/delete endpoints)."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import severity_rank, not_found, paginate
from app.core.deps import AuthContext, require
from app.db.session import get_db
from app.models import AuditLog
from app.schemas.common import PageParams
from app.services import audit

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


class AuditFilters:
    def __init__(
        self,
        category: str | None = Query(None, max_length=40),
        action: str | None = Query(None, max_length=80),
        severity: str | None = Query(None, pattern="^(critical|high|medium|low|informational)$"),
        outcome: str | None = Query(None, pattern="^(success|failure)$"),
        actor: str | None = Query(None, max_length=255),
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        include_demo: bool = True,
    ):
        self.category, self.action, self.severity, self.outcome = category, action, severity, outcome
        self.actor, self.date_from, self.date_to, self.include_demo = actor, date_from, date_to, include_demo

    def apply(self, q, text: str | None = None):
        if self.category:
            q = q.where(AuditLog.category == self.category)
        if self.action:
            q = q.where(AuditLog.action == self.action)
        if self.severity:
            q = q.where(AuditLog.severity == self.severity)
        if self.outcome:
            q = q.where(AuditLog.outcome == self.outcome)
        if self.actor:
            q = q.where(func.lower(AuditLog.actor_email).like(f"%{self.actor.lower()}%"))
        if self.date_from:
            q = q.where(AuditLog.created_at >= self.date_from)
        if self.date_to:
            q = q.where(AuditLog.created_at <= self.date_to)
        if not self.include_demo:
            q = q.where(AuditLog.is_demo.is_(False))
        if text:
            like = f"%{text.lower()}%"
            q = q.where(or_(func.lower(AuditLog.action).like(like), func.lower(AuditLog.actor_email).like(like),
                            func.lower(AuditLog.target_label).like(like), AuditLog.ip_address.like(like)))
        return q


def log_out(a: AuditLog) -> dict:
    return {"id": a.id, "created_at": a.created_at, "actor_id": str(a.actor_id) if a.actor_id else None,
            "actor_email": a.actor_email, "action": a.action, "category": a.category, "severity": a.severity,
            "outcome": a.outcome, "target_type": a.target_type, "target_id": a.target_id, "target_label": a.target_label,
            "ip_address": a.ip_address, "user_agent": a.user_agent, "details": a.details, "is_demo": a.is_demo,
            "hash": a.hash, "prev_hash": a.prev_hash}


@router.get("")
def list_logs(params: PageParams = Depends(), f: AuditFilters = Depends(), auth: AuthContext = Depends(require("audit:read")),
              db: Session = Depends(get_db)) -> dict:
    q = f.apply(select(AuditLog), params.q)
    return paginate(db, q, params, {"created_at": AuditLog.created_at, "id": AuditLog.id, "severity": severity_rank(AuditLog.severity), "action": AuditLog.action},
                    "created_at", mapper=log_out)


@router.get("/facets")
def facets(auth: AuthContext = Depends(require("audit:read")), db: Session = Depends(get_db)) -> dict:
    return {
        "categories": sorted(db.execute(select(distinct(AuditLog.category))).scalars()),
        "actions": sorted(db.execute(select(distinct(AuditLog.action))).scalars()),
    }


@router.get("/verify")
def verify(auth: AuthContext = Depends(require("audit:read")), db: Session = Depends(get_db)) -> dict:
    return audit.verify_chain(db)


@router.get("/export")
def export(params: PageParams = Depends(), f: AuditFilters = Depends(), auth: AuthContext = Depends(require("audit:export")),
           db: Session = Depends(get_db)) -> StreamingResponse:
    q = f.apply(select(AuditLog), params.q).order_by(AuditLog.created_at.desc()).limit(10000)
    rows = db.execute(q).scalars().all()
    audit.record(db, "audit.exported", "audit", actor=auth.user, ip=auth.client.ip, severity="low",
                 details={"rows": len(rows), "filters": {k: str(v) for k, v in vars(f).items() if v not in (None, True)}})
    db.commit()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "timestamp", "actor", "action", "category", "severity", "outcome", "target_type", "target",
                "ip_address", "details", "demo", "hash"])

    def safe(v):  # neutralise spreadsheet formula injection
        s = "" if v is None else str(v)
        return "'" + s if s[:1] in ("=", "+", "-", "@") else s

    for a in rows:
        w.writerow([a.id, a.created_at.isoformat(), safe(a.actor_email), a.action, a.category, a.severity, a.outcome,
                    a.target_type, safe(a.target_label or a.target_id), a.ip_address, safe(json.dumps(a.details)),
                    a.is_demo, a.hash])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=zerotrustx-audit.csv"})


@router.get("/{log_id}")
def get_log(log_id: int, auth: AuthContext = Depends(require("audit:read")), db: Session = Depends(get_db)) -> dict:
    a = db.get(AuditLog, log_id)
    if not a:
        raise not_found("Audit log")
    return log_out(a)
