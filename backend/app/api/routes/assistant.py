import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.utils import not_found
from app.assistant.provider import get_assistant
from app.core.deps import AuthContext, require
from app.db.session import get_db
from app.models import AccessDecision, AuditLog, Incident, User
from app.services import risk

router = APIRouter(prefix="/assistant", tags=["Security Assistant (advisory)"])


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)


@router.get("/decisions/{decision_id}")
def explain_decision(decision_id: uuid.UUID, auth: AuthContext = Depends(require("assistant:use")), db: Session = Depends(get_db)) -> dict:
    d = db.get(AccessDecision, decision_id)
    if not d:
        raise not_found("Decision")
    return get_assistant().explain_decision(d)


@router.get("/incidents/{incident_id}")
def summarize_incident(incident_id: uuid.UUID, auth: AuthContext = Depends(require("assistant:use", "incidents:read")),
                       db: Session = Depends(get_db)) -> dict:
    i = db.get(Incident, incident_id)
    if not i:
        raise not_found("Incident")
    return get_assistant().summarize_incident(i)


@router.get("/audit/{log_id}")
def explain_audit(log_id: int, auth: AuthContext = Depends(require("assistant:use", "audit:read")), db: Session = Depends(get_db)) -> dict:
    a = db.get(AuditLog, log_id)
    if not a:
        raise not_found("Audit log")
    return get_assistant().explain_audit(a)


@router.get("/users/{user_id}/risk")
def interpret_risk(user_id: uuid.UUID, auth: AuthContext = Depends(require("assistant:use", "users:read")),
                   db: Session = Depends(get_db)) -> dict:
    u = db.get(User, user_id)
    if not u:
        raise not_found("User")
    score, factors = risk.compute_user_risk(db, u)
    return get_assistant().interpret_risk(u, score, factors)


@router.get("/activity")
def review_activity(hours: int = Query(24, ge=1, le=720), auth: AuthContext = Depends(require("assistant:use")),
                    db: Session = Depends(get_db)) -> dict:
    return get_assistant().review_activity(db, hours)


@router.post("/ask")
def ask(body: AskIn, auth: AuthContext = Depends(require("assistant:use")), db: Session = Depends(get_db)) -> dict:
    return get_assistant().ask(db, body.question, auth.user)
