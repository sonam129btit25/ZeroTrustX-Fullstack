"""Access request workflow: submit -> policy engine evaluation -> (auto|manual) decision -> grant lifecycle."""
from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import bad_request, conflict, forbidden, not_found, paginate
from app.core.deps import AuthContext, get_auth, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import AccessRequest, AuditLog, ProtectedResource, User
from app.schemas.common import PageParams
from app.services import audit
from app.services.access import evaluate_access
from app.services.notify import notify_permission, notify_user
from app.ws.manager import ADMINS, queue_event

router = APIRouter(prefix="/access-requests", tags=["Access Requests"])
STATUS = "^(pending|approved|rejected|expired|revoked)$"


class RequestIn(BaseModel):
    resource_id: uuid.UUID
    justification: str = Field(min_length=20, max_length=2000)
    duration_hours: int = Field(8, ge=1, le=720)

    @field_validator("justification")
    @classmethod
    def clean(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 20:
            raise ValueError("Provide a business justification of at least 20 characters")
        return v


class ReviewIn(BaseModel):
    comment: str | None = Field(None, max_length=2000)
    duration_hours: int | None = Field(None, ge=1, le=720)


class RejectIn(BaseModel):
    comment: str = Field(min_length=5, max_length=2000)


def request_out(r: AccessRequest, include_decision: bool = False) -> dict:
    out = {
        "id": str(r.id), "status": r.status, "engine_decision": r.engine_decision, "justification": r.justification,
        "requested_duration_hours": r.requested_duration_hours, "created_at": r.created_at, "updated_at": r.updated_at,
        "reviewed_at": r.reviewed_at, "review_comment": r.review_comment, "expires_at": r.expires_at,
        "revoked_at": r.revoked_at, "is_demo": r.is_demo,
        "requester": {"id": str(r.requester.id), "email": r.requester.email, "full_name": r.requester.full_name,
                      "risk_score": r.requester.risk_score},
        "resource": {"id": str(r.resource.id), "name": r.resource.name, "sensitivity": r.resource.sensitivity,
                     "requires_approval": r.resource.requires_approval},
        "reviewer": {"id": str(r.reviewer.id), "email": r.reviewer.email} if r.reviewer else None,
        "decision_id": str(r.decision_id) if r.decision_id else None,
    }
    if include_decision and r.decision:
        out["decision"] = {"decision": r.decision.decision, "reasons": r.decision.reasons, "trace": r.decision.trace,
                           "context": r.decision.context, "evaluated_at": r.decision.evaluated_at,
                           "matched_policies": [{"policy_id": str(m.policy_id), "name": m.policy.name, "action": m.action,
                                                 "deciding": m.was_deciding} for m in r.decision.matched_policies]}
    return out


def _get(db: Session, rid: uuid.UUID) -> AccessRequest:
    r = db.get(AccessRequest, rid)
    if not r:
        raise not_found("Access request")
    return r


@router.post("", status_code=201)
def submit(body: RequestIn, auth: AuthContext = Depends(require("access_requests:create")), db: Session = Depends(get_db)) -> dict:
    res = db.get(ProtectedResource, body.resource_id)
    if not res or not res.is_active:
        raise not_found("Resource")
    if db.execute(select(AccessRequest.id).where(AccessRequest.requester_id == auth.user.id,
                                                 AccessRequest.resource_id == res.id,
                                                 AccessRequest.status == "pending")).first():
        raise conflict("You already have a pending request for this resource")
    req = AccessRequest(requester_id=auth.user.id, resource_id=res.id, justification=body.justification,
                        requested_duration_hours=body.duration_hours, status="pending")
    db.add(req)
    db.flush()
    decision, result = evaluate_access(db, auth.user, res, auth.session, auth.session.device, auth.client.ip,
                                       source="access_request", access_request_id=req.id, assume_entitled=True)
    req.decision_id, req.engine_decision = decision.id, result.decision
    now = utcnow()
    if result.decision == "DENY":
        req.status, req.reviewed_at = "rejected", now
        req.review_comment = "Automatically rejected by the Zero Trust policy engine: " + "; ".join(result.reasons[:2])
    elif result.decision == "ALLOW" and not res.requires_approval:
        hours = min(body.duration_hours, res.max_grant_hours)
        req.status, req.reviewed_at, req.expires_at = "approved", now, now + timedelta(hours=hours)
        req.review_comment = f"Automatically approved by policy (no manual approval required); valid {hours}h"
    audit.record(db, "access_request.submitted", "access", actor=auth.user, ip=auth.client.ip, target_type="access_request",
                 target_id=req.id, target_label=res.name,
                 details={"engine_decision": result.decision, "status": req.status, "duration_hours": body.duration_hours})
    if req.status != "pending":
        audit.record(db, f"access_request.auto_{req.status}", "access", actor_email="policy-engine",
                     severity="medium" if req.status == "rejected" else "informational", target_type="access_request",
                     target_id=req.id, target_label=res.name, details={"reasons": result.reasons[:3]})
        notify_user(db, auth.user.id, f"Access request {req.status}: {res.name}", req.review_comment or "",
                    category="access", severity="medium" if req.status == "rejected" else "informational",
                    link=f"/access-requests?id={req.id}", preference="notify_access_decisions")
    else:
        notify_permission(db, "access_requests:review", f"Access request awaiting review: {res.name}",
                          f"{auth.user.full_name} requested {res.sensitivity} access. Engine: {result.decision}.",
                          category="access", severity="low", link=f"/access-requests?id={req.id}", preference="notify_access_decisions")
    queue_event(db, "access_request.updated", {"id": str(req.id), "status": req.status, "resource": res.name,
                                               "user": auth.user.email}, ADMINS)
    db.commit()
    db.refresh(req)
    return request_out(req, include_decision=True)


@router.get("")
def list_requests(
    params: PageParams = Depends(),
    scope: str = Query("mine", pattern="^(mine|all)$"),
    status: str | None = Query(None, pattern=STATUS),
    resource_id: uuid.UUID | None = None,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict:
    q = select(AccessRequest).join(User, User.id == AccessRequest.requester_id).join(
        ProtectedResource, ProtectedResource.id == AccessRequest.resource_id)
    if scope == "all":
        if not auth.has("access_requests:read_all"):
            raise forbidden("You can only view your own access requests")
    else:
        q = q.where(AccessRequest.requester_id == auth.user.id)
    if status:
        q = q.where(AccessRequest.status == status)
    if resource_id:
        q = q.where(AccessRequest.resource_id == resource_id)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(User.email).like(like), func.lower(ProtectedResource.name).like(like),
                        func.lower(AccessRequest.justification).like(like)))
    sortable = {"created_at": AccessRequest.created_at, "status": AccessRequest.status, "updated_at": AccessRequest.updated_at}
    return paginate(db, q, params, sortable, "created_at", mapper=request_out)


@router.get("/summary")
def summary(scope: str = Query("mine", pattern="^(mine|all)$"), auth: AuthContext = Depends(get_auth),
            db: Session = Depends(get_db)) -> dict:
    q = select(AccessRequest.status, func.count()).group_by(AccessRequest.status)
    if scope == "all" and auth.has("access_requests:read_all"):
        pass
    else:
        q = q.where(AccessRequest.requester_id == auth.user.id)
    rows = dict(db.execute(q).all())
    return {s: rows.get(s, 0) for s in ("pending", "approved", "rejected", "expired", "revoked")}


@router.get("/{request_id}")
def get_request(request_id: uuid.UUID, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    r = _get(db, request_id)
    if r.requester_id != auth.user.id and not auth.has("access_requests:read_all"):
        raise not_found("Access request")
    trail = db.execute(select(AuditLog).where(AuditLog.target_type == "access_request", AuditLog.target_id == str(r.id))
                       .order_by(AuditLog.id.asc())).scalars()
    return {**request_out(r, include_decision=True),
            "audit_trail": [{"id": a.id, "action": a.action, "actor": a.actor_email, "created_at": a.created_at,
                             "details": a.details, "outcome": a.outcome} for a in trail]}


@router.post("/{request_id}/approve")
def approve(request_id: uuid.UUID, body: ReviewIn, auth: AuthContext = Depends(require("access_requests:review")),
            db: Session = Depends(get_db)) -> dict:
    r = _get(db, request_id)
    if r.requester_id == auth.user.id:
        raise forbidden("Separation of duties: you cannot approve your own request")
    if r.status != "pending":
        raise bad_request(f"Only pending requests can be approved (current: {r.status})")
    if r.requester.status != "active":
        raise bad_request("The requester's account is not active")
    if r.engine_decision == "DENY":
        raise bad_request("The policy engine denied this request; it cannot be manually approved")
    hours = min(body.duration_hours or r.requested_duration_hours, r.resource.max_grant_hours)
    now = utcnow()
    r.status, r.reviewed_by_id, r.reviewed_at = "approved", auth.user.id, now
    r.expires_at, r.review_comment = now + timedelta(hours=hours), body.comment
    audit.record(db, "access_request.approved", "access", actor=auth.user, ip=auth.client.ip, target_type="access_request",
                 target_id=r.id, target_label=r.resource.name,
                 details={"requester": r.requester.email, "hours": hours, "comment": body.comment,
                          "engine_decision": r.engine_decision})
    notify_user(db, r.requester_id, f"Access approved: {r.resource.name}",
                f"Approved by {auth.user.full_name} for {hours}h." + (f" Note: {body.comment}" if body.comment else ""),
                category="access", link=f"/access-requests?id={r.id}", preference="notify_access_decisions")
    queue_event(db, "access_request.updated", {"id": str(r.id), "status": r.status}, ADMINS)
    queue_event(db, "access_request.updated", {"id": str(r.id), "status": r.status}, {"users": [str(r.requester_id)]})
    db.commit()
    return request_out(r, include_decision=True)


@router.post("/{request_id}/reject")
def reject(request_id: uuid.UUID, body: RejectIn, auth: AuthContext = Depends(require("access_requests:review")),
           db: Session = Depends(get_db)) -> dict:
    r = _get(db, request_id)
    if r.status != "pending":
        raise bad_request(f"Only pending requests can be rejected (current: {r.status})")
    r.status, r.reviewed_by_id, r.reviewed_at, r.review_comment = "rejected", auth.user.id, utcnow(), body.comment
    audit.record(db, "access_request.rejected", "access", actor=auth.user, ip=auth.client.ip, target_type="access_request",
                 target_id=r.id, target_label=r.resource.name, details={"requester": r.requester.email, "comment": body.comment})
    notify_user(db, r.requester_id, f"Access rejected: {r.resource.name}", body.comment, category="access",
                severity="medium", link=f"/access-requests?id={r.id}", preference="notify_access_decisions")
    queue_event(db, "access_request.updated", {"id": str(r.id), "status": r.status}, ADMINS)
    queue_event(db, "access_request.updated", {"id": str(r.id), "status": r.status}, {"users": [str(r.requester_id)]})
    db.commit()
    return request_out(r, include_decision=True)


@router.post("/{request_id}/revoke")
def revoke(request_id: uuid.UUID, body: ReviewIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    """Admins revoke approved grants; requesters may withdraw their own pending/approved requests."""
    r = _get(db, request_id)
    own = r.requester_id == auth.user.id
    if not own and not auth.has("access_requests:review"):
        raise not_found("Access request")
    if r.status not in ("pending", "approved"):
        raise bad_request(f"Request cannot be revoked (current: {r.status})")
    r.status, r.revoked_at, r.revoked_by_id = "revoked", utcnow(), auth.user.id
    r.review_comment = body.comment or ("Withdrawn by requester" if own else "Revoked by administrator")
    audit.record(db, "access_request.revoked", "access", actor=auth.user, ip=auth.client.ip, severity="low",
                 target_type="access_request", target_id=r.id, target_label=r.resource.name,
                 details={"by_requester": own, "comment": body.comment})
    if not own:
        notify_user(db, r.requester_id, f"Access revoked: {r.resource.name}", r.review_comment, category="access",
                    severity="medium", link=f"/access-requests?id={r.id}", preference="notify_access_decisions")
    queue_event(db, "access_request.updated", {"id": str(r.id), "status": r.status}, ADMINS)
    db.commit()
    return request_out(r, include_decision=True)


def expire_requests(db: Session) -> int:
    now = utcnow()
    n = 0
    for r in db.execute(select(AccessRequest).where(AccessRequest.status == "approved", AccessRequest.expires_at <= now)).scalars():
        r.status = "expired"
        audit.record(db, "access_request.expired", "access", actor_email="system", target_type="access_request",
                     target_id=r.id, target_label=r.resource.name, details={"reason": "grant_expired"})
        n += 1
    stale = now - timedelta(days=7)
    for r in db.execute(select(AccessRequest).where(AccessRequest.status == "pending", AccessRequest.created_at <= stale)).scalars():
        r.status, r.review_comment = "expired", "Not reviewed within 7 days"
        audit.record(db, "access_request.expired", "access", actor_email="system", target_type="access_request",
                     target_id=r.id, target_label=r.resource.name, details={"reason": "review_timeout"})
        n += 1
    return n
