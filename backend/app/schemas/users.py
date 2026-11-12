from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORM


class RoleBrief(ORM):
    id: uuid.UUID
    name: str
    display_name: str
    level: int


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    status: str
    department: str | None
    job_title: str | None
    phone: str | None
    risk_score: int
    risk_level: str
    mfa_enabled: bool
    roles: list[RoleBrief]
    last_login_at: datetime | None
    last_login_ip: str | None
    failed_login_count: int
    locked_until: datetime | None
    created_at: datetime
    is_demo: bool
    active_sessions: int = 0


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=150)
    password: str = Field(min_length=1, max_length=128)
    department: str | None = Field(None, max_length=100)
    job_title: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=40)
    role_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)


class UserUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=150)
    department: str | None = Field(None, max_length=100)
    job_title: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=40)


class RolesUpdate(BaseModel):
    role_ids: list[uuid.UUID] = Field(min_length=1, max_length=5)


class StatusChange(BaseModel):
    reason: str | None = Field(None, max_length=500)


class ResetAccessIn(BaseModel):
    revoke_sessions: bool = True
    reset_mfa: bool = False
    revoke_grants: bool = False
    force_password_reset: bool = False
    reason: str | None = Field(None, max_length=500)


class RolePermissionsUpdate(BaseModel):
    permission_ids: list[uuid.UUID] = Field(max_length=200)
