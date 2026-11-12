"""Protected resource catalogue and the access gateway (policy enforcement point)."""
from __future__ import annotations

import ipaddress
import re
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import conflict, not_found, paginate
from app.core.deps import AuthContext, get_auth, require
from app.db.session import get_db
from app.models import AccessDecision, AccessRequest, ProtectedResource, User
from app.schemas.common import PageParams
from app.services import audit
from app.services.access import evaluate_access, has_active_grant

router = APIRouter(prefix="/resources", tags=["Protected Resources"])
SENS = "^(public|internal|confidential|restricted)$"


class ResourceIn(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    description: str = Field("", max_length=2000)
    resource_type: str = Field("application", pattern="^(application|database|dashboard|document|console|api)$")
    sensitivity: str = Field("internal", pattern=SENS)
    required_permission: str | None = Field(None, max_length=100, pattern=r"^[a-z0-9:_\-]+$")
    url: str | None = Field(None, max_length=500)
    owner_id: uuid.UUID | None = None
    requires_approval: bool = True
    max_grant_hours: int = Field(72, ge=1, le=720)
    allowed_ip_ranges: list[str] = Field(default_factory=list, max_length=20)
    access_hours_start: int | None = Field(None, ge=0, le=23)
    access_hours_end: int | None = Field(None, ge=1, le=24)
    is_active: bool = True

    @field_validator("allowed_ip_ranges")
    @classmethod
    def valid_cidrs(cls, v: list[str]) -> list[str]:
        for n in v:
            ipaddress.ip_network(n, strict=False)
        return v

    @model_validator(mode="after")
    def sensitive_needs_permission(self):
        if self.sensitivity in ("confidential", "restricted") and not self.required_permission:
            raise ValueError("Confidential and restricted resources must declare a required permission")
        if (self.access_hours_start is None) != (self.access_hours_end is None):
            raise ValueError("Set both access window hours or neither")
        return self

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str | None) -> str | None:
        if v and not re.match(r"^(https?://|/)", v):
            raise ValueError("URL must start with http(s):// or /")
        return v


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:150]


def resource_out(r: ProtectedResource, auth: AuthContext | None = None, db: Session | None = None) -> dict:
    out = {
        "id": str(r.id), "name": r.name, "slug": r.slug, "description": r.description, "resource_type": r.resource_type,
        "sensitivity": r.sensitivity, "required_permission": r.required_permission, "url": r.url,
        "requires_approval": r.requires_approval, "max_grant_hours": r.max_grant_hours,
        "allowed_ip_ranges": r.allowed_ip_ranges or [], "access_hours_start": r.access_hours_start,
        "access_hours_end": r.access_hours_end, "is_active": r.is_active, "created_at": r.created_at,
        "updated_at": r.updated_at, "is_demo": r.is_demo,
        "owner": {"id": str(r.owner.id), "email": r.owner.email, "full_name": r.owner.full_name} if r.owner else None,
    }
    if auth and db:
        perm = bool(r.required_permission and r.required_permission in auth.user.permission_codes)
        out["entitlement"] = {
            "has_permission": perm or r.sensitivity == "public",
            "has_active_grant": has_active_grant(db, auth.user.id, r.id),
        }
    return out


@router.get("")
def list_resources(
    params: PageParams = Depends(),
    sensitivity: str | None = Query(None, pattern=SENS),
    auth: AuthContext = Depends(require("resources:read")),
    db: Session = Depends(get_db),
) -> dict:
    q = select(ProtectedResource)
    if not auth.has("resources:write"):
        q = q.where(ProtectedResource.is_active.is_(True))
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(ProtectedResource.name).like(like), func.lower(ProtectedResource.description).like(like)))
    if sensitivity:
        q = q.where(ProtectedResource.sensitivity == sensitivity)
    sortable = {"name": ProtectedResource.name, "sensitivity": ProtectedResource.sensitivity,
                "created_at": ProtectedResource.created_at}
    return paginate(db, q, params, sortable, "name", mapper=lambda r: resource_out(r, auth, db))


@router.post("", status_code=201)
def create_resource(body: ResourceIn, auth: AuthContext = Depends(require("resources:write")), db: Session = Depends(get_db)) -> dict:
    slug = slugify(body.name)
    if db.execute(select(ProtectedResource.id).where(or_(ProtectedResource.name == body.name, ProtectedResource.slug == slug))).first():
        raise conflict("A resource with this name already exists")
    if body.owner_id and not db.get(User, body.owner_id):
        raise not_found("Owner")
    r = ProtectedResource(slug=slug, **body.model_dump())
    db.add(r)
    db.flush()
    audit.record(db, "resource.created", "resource", actor=auth.user, ip=auth.client.ip, target_type="resource",
                 target_id=r.id, target_label=r.name, details={"sensitivity": r.sensitivity})
    db.commit()
    db.refresh(r)
    return resource_out(r, auth, db)


@router.get("/{resource_id}")
def get_resource(resource_id: uuid.UUID, auth: AuthContext = Depends(require("resources:read")), db: Session = Depends(get_db)) -> dict:
    r = db.get(ProtectedResource, resource_id)
    if not r or (not r.is_active and not auth.has("resources:write")):
        raise not_found("Resource")
    out = resource_out(r, auth, db)
    if auth.has("resources:write") or auth.has("audit:read"):
        rows = db.execute(select(AccessDecision).where(AccessDecision.resource_id == r.id)
                          .order_by(AccessDecision.evaluated_at.desc()).limit(50)).scalars()
        out["access_history"] = [{"id": str(d.id), "decision": d.decision, "user": d.user.email if d.user else None,
                                  "source": d.source, "ip_address": d.ip_address, "evaluated_at": d.evaluated_at,
                                  "reasons": d.reasons} for d in rows]
        grants = db.execute(select(AccessRequest).where(AccessRequest.resource_id == r.id, AccessRequest.status == "approved")).scalars()
        out["active_grants"] = [{"id": str(g.id), "user": g.requester.email, "expires_at": g.expires_at} for g in grants]
    return out


@router.put("/{resource_id}")
def update_resource(resource_id: uuid.UUID, body: ResourceIn, auth: AuthContext = Depends(require("resources:write")),
                    db: Session = Depends(get_db)) -> dict:
    r = db.get(ProtectedResource, resource_id)
    if not r:
        raise not_found("Resource")
    if db.execute(select(ProtectedResource.id).where(ProtectedResource.name == body.name, ProtectedResource.id != r.id)).first():
        raise conflict("A resource with this name already exists")
    before = {"sensitivity": r.sensitivity, "required_permission": r.required_permission, "is_active": r.is_active}
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    audit.record(db, "resource.updated", "resource", actor=auth.user, ip=auth.client.ip, severity="low",
                 target_type="resource", target_id=r.id, target_label=r.name,
                 details={"before": before, "after": {k: getattr(r, k) for k in before}})
    db.commit()
    db.refresh(r)
    return resource_out(r, auth, db)


@router.delete("/{resource_id}", status_code=204)
def delete_resource(resource_id: uuid.UUID, auth: AuthContext = Depends(require("resources:write")), db: Session = Depends(get_db)) -> None:
    r = db.get(ProtectedResource, resource_id)
    if not r:
        raise not_found("Resource")
    audit.record(db, "resource.deleted", "resource", actor=auth.user, ip=auth.client.ip, severity="medium",
                 target_type="resource", target_id=r.id, target_label=r.name)
    db.delete(r)
    db.commit()


@router.post("/{resource_id}/access")
def access_resource(resource_id: uuid.UUID, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    """Policy Enforcement Point: every access attempt is evaluated by the Zero Trust engine and recorded."""
    r = db.get(ProtectedResource, resource_id)
    if not r:
        raise not_found("Resource")
    d, result = evaluate_access(db, auth.user, r, auth.session, auth.session.device, auth.client.ip, "gateway")
    db.commit()
    granted = result.decision in ("ALLOW", "RESTRICTED_ACCESS")
    return {
        "decision_id": str(d.id), "granted": granted, "access_mode": "read_only" if result.decision == "RESTRICTED_ACCESS" else
        ("full" if granted else None), "resource": {"id": str(r.id), "name": r.name, "url": r.url if granted else None},
        **result.to_dict(),
    }
