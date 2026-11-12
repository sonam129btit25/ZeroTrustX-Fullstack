from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ORM


class RegisterIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=150)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Name is too short")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class MfaVerifyIn(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=2048)
    code: str | None = Field(None, max_length=10)
    recovery_code: str | None = Field(None, max_length=20)


class StepUpIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class RoleOut(ORM):
    id: uuid.UUID
    name: str
    display_name: str
    level: int


class MeOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    department: str | None
    job_title: str | None
    phone: str | None
    status: str
    risk_score: int
    mfa_enabled: bool
    roles: list[RoleOut]
    permissions: list[str]
    preferences: dict[str, Any]
    last_login_at: datetime | None
    created_at: datetime
    session: dict[str, Any]
    mfa_required_by_policy: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


class LoginOut(BaseModel):
    mfa_required: bool
    mfa_token: str | None = None
    auth: TokenOut | None = None


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    new_password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=150)
    phone: str | None = Field(None, max_length=40)
    job_title: str | None = Field(None, max_length=100)
    preferences: dict[str, Any] | None = None

    @field_validator("preferences")
    @classmethod
    def limit_prefs(cls, v):
        if v is not None:
            import json

            if len(json.dumps(v)) > 8000:
                raise ValueError("Preferences payload too large")
        return v


class MfaSetupOut(BaseModel):
    otpauth_uri: str
    secret: str
    qr_svg_data_url: str


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class MfaDisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=20)


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class MfaStatusOut(BaseModel):
    enabled: bool
    enabled_at: datetime | None
    last_used_at: datetime | None
    recovery_codes_remaining: int
    pending_setup: bool
    required_by_policy: bool
    session_mfa_verified: bool
