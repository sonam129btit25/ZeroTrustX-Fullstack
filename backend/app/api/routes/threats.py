"""Threat detection (rule-based) and incident investigation workflow."""
from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import severity_rank, bad_request, not_found, paginate
from app.core.deps import AuthContext, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Incident, IncidentNote, SecurityEvent, ThreatAlert, User
from app.schemas.common import PageParams
from app.services import audit, risk, threats
from app.services.notify import notify_user, users_with_permission
from app.ws.manager import SECURITY, queue_event

router = APIRouter(tags=["Threat Detection & Incidents"])
SEV = "^(critical|high|medium|low|informational)$"


def alert_out(a: ThreatAlert) -> dict:
    return {
        "id": str(a.id), "rule_key": a.rule_key, "title": a.title, "description": a.description, "category": a.category,
        "severity": a.severity, "status": a.status, "ip_address": a.ip_address, "risk_score": a.risk_score,
        "recommended_action": a.recommended_action, "evidence": a.evidence, "detected_at": a.detected_at,
        "updated_at": a.updated_at, "incident_id": str(a.incident_id) if a.incident_id else None, "is_demo": a.is_demo,
        "user": {"id": str(a.user.id), "email": a.user.email, "full_name": a.user.full_name, "risk_score": a.user.risk_score} if a.user else None,
        "device": {"id": str(a.device.id), "name": a.device.name, "trust_status": a.device.trust_status} if a.device else None,
    }


class AlertStatusIn(BaseModel):
    status: str = Field(pattern="^(open|investigating|resolved|dismissed)$")
    note: str | None = Field(None, max_length=1000)


class EscalateIn(BaseModel):
    title: str | None = Field(None, max_length=200)
    assignee_id: uuid.UUID | None = None


@router.get("/threats/rules")
def rules(auth: AuthContext = Depends(require("threats:read"))) -> list[dict]:
    return [{"key": k, "title": v["title"], "category": v["category"], "severity": v["severity"],
             "description": v["description"], "recommended_action": v["action"], "risk": v["risk"]}
            for k, v in threats.RULES.items()]


@router.get("/threats")
def list_alerts(
    params: PageParams = Depends(),
    severity: str | None = Query(None, pattern=SEV),
    status: str | None = Query(None, pattern="^(open|investigating|resolved|dismissed|active)$"),
    category: str | None = Query(None, max_length=50),
    user_id: uuid.UUID | None = None,
    auth: AuthContext = Depends(require("threats:read")),
    db: Session = Depends(get_db),
) -> dict:
    q = select(ThreatAlert).outerjoin(User, User.id == ThreatAlert.user_id)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(ThreatAlert.title).like(like), func.lower(User.email).like(like),
                        ThreatAlert.ip_address.like(like)))
    if severity:
        q = q.where(ThreatAlert.severity == severity)
    if status == "active":
        q = q.where(ThreatAlert.status.in_(["open", "investigating"]))
    elif status:
        q = q.where(ThreatAlert.status == status)
    if category:
        q = q.where(ThreatAlert.category == category)
    if user_id:
        q = q.where(ThreatAlert.user_id == user_id)
    sortable = {"detected_at": ThreatAlert.detected_at, "risk_score": ThreatAlert.risk_score, "severity": severity_rank(ThreatAlert.severity)}
    return paginate(db, q, params, sortable, "detected_at", mapper=alert_out)


@router.get("/threats/summary")
def alert_summary(auth: AuthContext = Depends(require("threats:read")), db: Session = Depends(get_db)) -> dict:
    active = ThreatAlert.status.in_(["open", "investigating"])
    by_sev = dict(db.execute(select(ThreatAlert.severity, func.count()).where(active).group_by(ThreatAlert.severity)).all())
    by_status = dict(db.execute(select(ThreatAlert.status, func.count()).group_by(ThreatAlert.status)).all())
    by_cat = dict(db.execute(select(ThreatAlert.category, func.count()).where(active).group_by(ThreatAlert.category)).all())
    return {"by_severity": by_sev, "by_status": by_status, "by_category": by_cat, "active": sum(by_sev.values())}


@router.get("/threats/{alert_id}")
def get_alert(alert_id: uuid.UUID, auth: AuthContext = Depends(require("threats:read")), db: Session = Depends(get_db)) -> dict:
    a = db.get(ThreatAlert, alert_id)
    if not a:
        raise not_found("Alert")
    related = []
    if a.user_id:
        rows = db.execute(select(SecurityEvent).where(SecurityEvent.user_id == a.user_id,
                                                      SecurityEvent.created_at >= a.detected_at - timedelta(hours=6))
                          .order_by(SecurityEvent.created_at.desc()).limit(25)).scalars()
        related = [{"id": str(e.id), "event_type": e.event_type, "ip_address": e.ip_address, "created_at": e.created_at,
                    "severity": e.severity} for e in rows]
    return {**alert_out(a), "related_events": related}


@router.patch("/threats/{alert_id}")
def update_alert(alert_id: uuid.UUID, body: AlertStatusIn, auth: AuthContext = Depends(require("threats:write")),
                 db: Session = Depends(get_db)) -> dict:
    a = db.get(ThreatAlert, alert_id)
    if not a:
        raise not_found("Alert")
    prev = a.status
    a.status = body.status
    if body.note:
        ev = dict(a.evidence or {})
        notes = list(ev.get("analyst_notes", []))
        notes.append({"by": auth.user.email, "at": utcnow().isoformat(), "status": body.status, "note": body.note})
        ev.update(analyst_note=body.note, analyst_notes=notes[-20:])
        a.evidence = ev
    if a.user:
        risk.recompute_user_risk(db, a.user)
    audit.record(db, "threat.status_changed", "threat", actor=auth.user, ip=auth.client.ip, target_type="threat_alert",
                 target_id=a.id, target_label=a.title, details={"from": prev, "to": body.status, "note": body.note})
    queue_event(db, "threat.updated", {"id": str(a.id), "status": a.status}, SECURITY)
    db.commit()
    return alert_out(a)


@router.post("/threats/scan")
def scan(auth: AuthContext = Depends(require("threats:write")), db: Session = Depends(get_db)) -> dict:
    """Re-run detection rules over the last 30 minutes of telemetry and recompute user risk."""
    since = utcnow() - timedelta(minutes=30)
    before = db.scalar(select(func.count()).select_from(ThreatAlert)) or 0
    failures = db.execute(select(SecurityEvent.user_id, SecurityEvent.ip_address, SecurityEvent.email_attempted)
                          .where(SecurityEvent.event_type == "login_failure", SecurityEvent.created_at >= since).distinct()).all()
    for uid, ip, email in failures:
        threats.on_login_failure(db, db.get(User, uid) if uid else None, email or "", ip)
    users = db.execute(select(User).where(User.status == "active")).scalars().all()
    for u in users:
        risk.recompute_user_risk(db, u)
    after = db.scalar(select(func.count()).select_from(ThreatAlert)) or 0
    audit.record(db, "threat.scan", "threat", actor=auth.user, ip=auth.client.ip,
                 details={"new_alerts": after - before, "users_rescored": len(users)})
    db.commit()
    return {"new_alerts": after - before, "users_rescored": len(users)}


# ------------------------------------------------------------------ incidents
class IncidentIn(BaseModel):
    title: str = Field(min_length=5, max_length=200)
    description: str = Field("", max_length=5000)
    severity: str = Field(pattern=SEV)
    assignee_id: uuid.UUID | None = None
    alert_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class IncidentUpdate(BaseModel):
    status: str | None = Field(None, pattern="^(open|investigating|contained|resolved|closed)$")
    severity: str | None = Field(None, pattern=SEV)
    assignee_id: uuid.UUID | None = None
    unassign: bool = False
    resolution_summary: str | None = Field(None, max_length=5000)


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


def incident_out(i: Incident, full: bool = False) -> dict:
    out = {
        "id": str(i.id), "reference": i.reference, "title": i.title, "description": i.description, "severity": i.severity,
        "status": i.status, "created_at": i.created_at, "updated_at": i.updated_at, "resolved_at": i.resolved_at,
        "closed_at": i.closed_at, "resolution_summary": i.resolution_summary, "is_demo": i.is_demo,
        "assignee": {"id": str(i.assignee.id), "email": i.assignee.email, "full_name": i.assignee.full_name} if i.assignee else None,
        "created_by": {"id": str(i.created_by.id), "email": i.created_by.email} if i.created_by else None,
        "alert_count": len(i.alerts), "note_count": len(i.notes),
    }
    if full:
        out["notes"] = [{"id": str(n.id), "note_type": n.note_type, "body": n.body, "created_at": n.created_at,
                         "author": {"email": n.author.email, "full_name": n.author.full_name} if n.author else None}
                        for n in i.notes]
        out["alerts"] = [alert_out(a) for a in i.alerts]
    return out


def _next_ref(db: Session) -> str:
    n = (db.scalar(select(func.count()).select_from(Incident)) or 0) + 1
    while db.execute(select(Incident.id).where(Incident.reference == f"INC-{n:04d}")).first():
        n += 1
    return f"INC-{n:04d}"


def _check_assignee(db: Session, uid: uuid.UUID) -> User:
    u = db.get(User, uid)
    if not u or uid not in users_with_permission(db, "incidents:write"):
        raise bad_request("Assignee must be an active user with incident investigation permission")
    return u


def _note(db: Session, inc: Incident, author: User | None, body: str, kind: str = "note") -> None:
    db.add(IncidentNote(incident_id=inc.id, author_id=author.id if author else None, body=body, note_type=kind))


@router.get("/incidents/assignees")
def assignees(auth: AuthContext = Depends(require("incidents:read")), db: Session = Depends(get_db)) -> list[dict]:
    ids = users_with_permission(db, "incidents:write")
    users = db.execute(select(User).where(User.id.in_(ids)).order_by(User.full_name)).scalars()
    return [{"id": str(u.id), "email": u.email, "full_name": u.full_name} for u in users]


@router.get("/incidents")
def list_incidents(
    params: PageParams = Depends(),
    status: str | None = Query(None, pattern="^(open|investigating|contained|resolved|closed|active)$"),
    severity: str | None = Query(None, pattern=SEV),
    assignee_id: uuid.UUID | None = None,
    auth: AuthContext = Depends(require("incidents:read")),
    db: Session = Depends(get_db),
) -> dict:
    q = select(Incident)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(Incident.title).like(like), func.lower(Incident.reference).like(like)))
    if status == "active":
        q = q.where(Incident.status.in_(["open", "investigating", "contained"]))
    elif status:
        q = q.where(Incident.status == status)
    if severity:
        q = q.where(Incident.severity == severity)
    if assignee_id:
        q = q.where(Incident.assignee_id == assignee_id)
    sortable = {"created_at": Incident.created_at, "updated_at": Incident.updated_at, "severity": severity_rank(Incident.severity)}
    return paginate(db, q, params, sortable, "created_at", mapper=incident_out)


@router.post("/incidents", status_code=201)
def create_incident(body: IncidentIn, auth: AuthContext = Depends(require("incidents:write")), db: Session = Depends(get_db)) -> dict:
    if body.assignee_id:
        _check_assignee(db, body.assignee_id)
    inc = Incident(reference=_next_ref(db), title=body.title, description=body.description, severity=body.severity,
                   assignee_id=body.assignee_id, created_by_id=auth.user.id,
                   status="investigating" if body.assignee_id else "open")
    db.add(inc)
    db.flush()
    for aid in body.alert_ids:
        a = db.get(ThreatAlert, aid)
        if a:
            a.incident_id, a.status = inc.id, "investigating"
    _note(db, inc, auth.user, f"Incident opened by {auth.user.full_name}", "status_change")
    audit.record(db, "incident.created", "incident", actor=auth.user, ip=auth.client.ip, severity=body.severity,
                 target_type="incident", target_id=inc.id, target_label=inc.reference, details={"title": body.title})
    if body.assignee_id and body.assignee_id != auth.user.id:
        notify_user(db, body.assignee_id, f"Incident assigned: {inc.reference}", inc.title, category="incident",
                    severity=inc.severity, link=f"/incidents/{inc.id}")
    queue_event(db, "incident.updated", {"id": str(inc.id), "reference": inc.reference, "status": inc.status}, SECURITY)
    db.commit()
    db.refresh(inc)
    return incident_out(inc, full=True)


@router.post("/threats/{alert_id}/escalate", status_code=201)
def escalate(alert_id: uuid.UUID, body: EscalateIn, auth: AuthContext = Depends(require("incidents:write")),
             db: Session = Depends(get_db)) -> dict:
    a = db.get(ThreatAlert, alert_id)
    if not a:
        raise not_found("Alert")
    if a.incident_id:
        raise bad_request("Alert is already linked to an incident")
    desc = f"Escalated from alert '{a.title}'.\n\n{a.description}\n\nRecommended action: {a.recommended_action}"
    return create_incident(IncidentIn(title=body.title or a.title, description=desc, severity=a.severity,
                                      assignee_id=body.assignee_id, alert_ids=[a.id]), auth, db)


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: uuid.UUID, auth: AuthContext = Depends(require("incidents:read")), db: Session = Depends(get_db)) -> dict:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise not_found("Incident")
    return incident_out(inc, full=True)


TRANSITIONS = {
    "open": {"investigating", "contained", "resolved", "closed"},
    "investigating": {"contained", "resolved", "open"},
    "contained": {"investigating", "resolved"},
    "resolved": {"closed", "investigating"},
    "closed": {"investigating"},
}


@router.patch("/incidents/{incident_id}")
def update_incident(incident_id: uuid.UUID, body: IncidentUpdate, auth: AuthContext = Depends(require("incidents:write")),
                    db: Session = Depends(get_db)) -> dict:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise not_found("Incident")
    changes: dict = {}
    if body.status and body.status != inc.status:
        if body.status not in TRANSITIONS[inc.status]:
            raise bad_request(f"Cannot move incident from {inc.status} to {body.status}")
        if body.status == "resolved" and not (body.resolution_summary or inc.resolution_summary):
            raise bad_request("A resolution summary is required to resolve an incident")
        changes["status"] = [inc.status, body.status]
        _note(db, inc, auth.user, f"Status changed from {inc.status} to {body.status}", "status_change")
        inc.status = body.status
        if body.status == "resolved":
            inc.resolved_at = utcnow()
            for a in inc.alerts:
                a.status = "resolved"
                queue_event(db, "threat.updated", {"id": str(a.id), "status": a.status}, SECURITY)
            for u in {a.user for a in inc.alerts if a.user}:
                risk.recompute_user_risk(db, u)
        if body.status == "closed":
            inc.closed_at = utcnow()
    if body.resolution_summary:
        inc.resolution_summary = body.resolution_summary
        changes["resolution_summary"] = True
    if body.severity and body.severity != inc.severity:
        changes["severity"] = [inc.severity, body.severity]
        _note(db, inc, auth.user, f"Severity changed from {inc.severity} to {body.severity}", "status_change")
        inc.severity = body.severity
    if body.unassign and inc.assignee_id:
        changes["assignee"] = [str(inc.assignee_id), None]
        _note(db, inc, auth.user, "Investigator unassigned", "assignment")
        inc.assignee_id = None
    elif body.assignee_id and body.assignee_id != inc.assignee_id:
        u = _check_assignee(db, body.assignee_id)
        changes["assignee"] = [str(inc.assignee_id) if inc.assignee_id else None, str(u.id)]
        _note(db, inc, auth.user, f"Assigned to {u.full_name}", "assignment")
        inc.assignee_id = u.id
        if inc.status == "open":
            inc.status = "investigating"
        if u.id != auth.user.id:
            notify_user(db, u.id, f"Incident assigned: {inc.reference}", inc.title, category="incident",
                        severity=inc.severity, link=f"/incidents/{inc.id}")
    if not changes:
        return incident_out(inc, full=True)
    audit.record(db, "incident.updated", "incident", actor=auth.user, ip=auth.client.ip, target_type="incident",
                 target_id=inc.id, target_label=inc.reference, details=changes)
    queue_event(db, "incident.updated", {"id": str(inc.id), "reference": inc.reference, "status": inc.status}, SECURITY)
    db.commit()
    db.expire(inc)
    return incident_out(db.get(Incident, incident_id), full=True)


@router.post("/incidents/{incident_id}/notes", status_code=201)
def add_note(incident_id: uuid.UUID, body: NoteIn, auth: AuthContext = Depends(require("incidents:write")),
             db: Session = Depends(get_db)) -> dict:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise not_found("Incident")
    _note(db, inc, auth.user, body.body)
    inc.updated_at = utcnow()
    audit.record(db, "incident.note_added", "incident", actor=auth.user, ip=auth.client.ip, target_type="incident",
                 target_id=inc.id, target_label=inc.reference)
    queue_event(db, "incident.updated", {"id": str(inc.id), "reference": inc.reference, "status": inc.status}, SECURITY)
    db.commit()
    db.expire(inc)
    return incident_out(db.get(Incident, incident_id), full=True)
