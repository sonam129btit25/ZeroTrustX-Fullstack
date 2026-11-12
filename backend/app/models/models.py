"""SQLAlchemy ORM models for ZeroTrustX."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk, utcnow

BigIntPk = BigInteger().with_variant(Integer, "sqlite")


# ---------------------------------------------------------------- RBAC
class RolePermission(Base):
    __tablename__ = "role_permissions"
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    assigned_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Role(UUIDPk, Timestamps, Base):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # privilege level for escalation checks
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)

    permissions: Mapped[list[Permission]] = relationship(secondary="role_permissions", lazy="selectin")


class Permission(UUIDPk, Base):
    __tablename__ = "permissions"
    code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(50), default="general")


# ---------------------------------------------------------------- Users
class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, index=True)
    department: Mapped[str | None] = mapped_column(String(100))
    job_title: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(40))
    risk_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_ip: Mapped[str | None] = mapped_column(String(64))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    roles: Mapped[list[Role]] = relationship(
        secondary="user_roles",
        primaryjoin="User.id == UserRole.user_id",
        secondaryjoin="Role.id == UserRole.role_id",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="risk_range"),
        CheckConstraint("status IN ('active','suspended','deactivated','locked')", name="status_valid"),
    )

    @property
    def role_names(self) -> list[str]:
        return [r.name for r in self.roles]

    @property
    def permission_codes(self) -> set[str]:
        return {p.code for r in self.roles for p in r.permissions}

    @property
    def max_role_level(self) -> int:
        return max((r.level for r in self.roles), default=0)


class PasswordResetToken(UUIDPk, Base):
    __tablename__ = "password_reset_tokens"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- MFA
class MFAConfig(UUIDPk, Timestamps, Base):
    __tablename__ = "mfa_configs"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    secret_encrypted: Mapped[str] = mapped_column(String(512), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_step: Mapped[int | None] = mapped_column(BigInteger)  # replay protection


class RecoveryCode(UUIDPk, Base):
    __tablename__ = "recovery_codes"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------- Devices
class Device(UUIDPk, Timestamps, Base):
    __tablename__ = "devices"
    device_identifier: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    device_type: Mapped[str] = mapped_column(String(30), default="browser")
    os: Mapped[str | None] = mapped_column(String(60))
    os_version: Mapped[str | None] = mapped_column(String(60))
    browser: Mapped[str | None] = mapped_column(String(60))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trust_status: Mapped[str] = mapped_column(String(30), default="pending_verification", index=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    registered_via: Mapped[str] = mapped_column(String(20), default="login")  # login | manual
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User | None] = relationship(foreign_keys=[user_id], lazy="joined")

    __table_args__ = (
        CheckConstraint(
            "trust_status IN ('trusted','untrusted','suspicious','blocked','pending_verification')",
            name="trust_valid",
        ),
    )


class DeviceTrustHistory(UUIDPk, Base):
    __tablename__ = "device_trust_history"
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30), nullable=False)
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    changed_by: Mapped[User | None] = relationship(lazy="joined")


# ---------------------------------------------------------------- Sessions
class UserSession(UUIDPk, Base):
    __tablename__ = "sessions"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    location: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(255))
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    mfa_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    refresh_token_hash: Mapped[str | None] = mapped_column(String(128), index=True)
    previous_refresh_hash: Mapped[str | None] = mapped_column(String(128), index=True)
    refresh_count: Mapped[int] = mapped_column(Integer, default=0)
    refresh_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="joined")
    device: Mapped[Device | None] = relationship(lazy="joined")


class SecurityEvent(UUIDPk, Base):
    """Authentication/security telemetry used for login history and anomaly detection."""

    __tablename__ = "security_events"
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    email_attempted: Mapped[str | None] = mapped_column(String(255))
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    location: Mapped[str | None] = mapped_column(String(120))
    country_code: Mapped[str | None] = mapped_column(String(2))
    severity: Mapped[str] = mapped_column(String(20), default="informational")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped[User | None] = relationship(lazy="joined")


# ---------------------------------------------------------------- Resources & policies
class ProtectedResource(UUIDPk, Timestamps, Base):
    __tablename__ = "protected_resources"
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    resource_type: Mapped[str] = mapped_column(String(30), default="application")
    sensitivity: Mapped[str] = mapped_column(String(20), default="internal", index=True)
    required_permission: Mapped[str | None] = mapped_column(String(100))
    url: Mapped[str | None] = mapped_column(String(500))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    max_grant_hours: Mapped[int] = mapped_column(Integer, default=72)
    allowed_ip_ranges: Mapped[list[str]] = mapped_column(JSON, default=list)
    access_hours_start: Mapped[int | None] = mapped_column(Integer)
    access_hours_end: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    owner: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("sensitivity IN ('public','internal','confidential','restricted')", name="sens_valid"),
    )


class Policy(UUIDPk, Timestamps, Base):
    __tablename__ = "policies"
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    match_mode: Mapped[str] = mapped_column(String(5), default="all")  # all | any
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    conditions: Mapped[list[PolicyCondition]] = relationship(
        back_populates="policy",
        cascade="all, delete-orphan",
        order_by="PolicyCondition.position",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint(
            "action IN ('ALLOW','DENY','REQUIRE_MFA','REQUIRE_DEVICE_VERIFICATION','RESTRICTED_ACCESS')",
            name="action_valid",
        ),
        CheckConstraint("match_mode IN ('all','any')", name="match_mode_valid"),
    )


class PolicyCondition(UUIDPk, Base):
    __tablename__ = "policy_conditions"
    policy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("policies.id", ondelete="CASCADE"), index=True)
    field: Mapped[str] = mapped_column(String(60), nullable=False)
    operator: Mapped[str] = mapped_column(String(20), nullable=False)
    value: Mapped[Any] = mapped_column(JSON)
    position: Mapped[int] = mapped_column(Integer, default=0)

    policy: Mapped[Policy] = relationship(back_populates="conditions")


class AccessDecision(UUIDPk, Base):
    __tablename__ = "access_decisions"
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("protected_resources.id", ondelete="SET NULL"), index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    access_request_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    decision: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    trace: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(30), default="gateway")
    duration_ms: Mapped[float] = mapped_column(default=0.0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped[User | None] = relationship(lazy="joined")
    resource: Mapped[ProtectedResource | None] = relationship(lazy="joined")
    matched_policies: Mapped[list[AccessDecisionPolicy]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class AccessDecisionPolicy(Base):
    """Normalized link between a decision and every policy that matched (execution history)."""

    __tablename__ = "access_decision_policies"
    decision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("access_decisions.id", ondelete="CASCADE"), primary_key=True
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("policies.id", ondelete="CASCADE"), primary_key=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    was_deciding: Mapped[bool] = mapped_column(Boolean, default=False)

    policy: Mapped[Policy] = relationship(lazy="joined")


class AccessRequest(UUIDPk, Timestamps, Base):
    __tablename__ = "access_requests"
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("protected_resources.id", ondelete="CASCADE"), index=True
    )
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    requested_duration_hours: Mapped[int] = mapped_column(Integer, default=8)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    engine_decision: Mapped[str | None] = mapped_column(String(40))
    decision_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("access_decisions.id", ondelete="SET NULL"))
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_comment: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id], lazy="joined")
    reviewer: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id], lazy="joined")
    resource: Mapped[ProtectedResource] = relationship(lazy="joined")
    decision: Mapped[AccessDecision | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("status IN ('pending','approved','rejected','expired','revoked')", name="status_valid"),
        CheckConstraint("requested_duration_hours > 0 AND requested_duration_hours <= 720", name="duration"),
    )


# ---------------------------------------------------------------- Threats & incidents
class ThreatAlert(UUIDPk, Timestamps, Base):
    __tablename__ = "threat_alerts"
    rule_key: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    recommended_action: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User | None] = relationship(lazy="joined")
    device: Mapped[Device | None] = relationship(lazy="joined")


class Incident(UUIDPk, Timestamps, Base):
    __tablename__ = "incidents"
    reference: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolution_summary: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id], lazy="joined")
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id], lazy="joined")
    notes: Mapped[list[IncidentNote]] = relationship(
        cascade="all, delete-orphan", order_by="IncidentNote.created_at", lazy="selectin"
    )
    alerts: Mapped[list[ThreatAlert]] = relationship(lazy="selectin", foreign_keys=[ThreatAlert.incident_id])


class IncidentNote(UUIDPk, Base):
    __tablename__ = "incident_notes"
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note_type: Mapped[str] = mapped_column(String(20), default="note")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    author: Mapped[User | None] = relationship(lazy="joined")


# ---------------------------------------------------------------- Audit & notifications
class AuditLog(Base):
    """Append-only, hash-chained audit trail. UPDATE/DELETE are blocked by a DB trigger (PostgreSQL)."""

    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    actor_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), default="informational", index=True)
    outcome: Mapped[str] = mapped_column(String(20), default="success")
    target_type: Mapped[str | None] = mapped_column(String(50))
    target_id: Mapped[str | None] = mapped_column(String(64))
    target_label: Mapped[str | None] = mapped_column(String(255))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), nullable=False)


class Notification(UUIDPk, Base):
    __tablename__ = "notifications"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), default="system")
    severity: Mapped[str] = mapped_column(String(20), default="informational")
    link: Mapped[str | None] = mapped_column(String(255))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class OrganizationSettings(Base):
    __tablename__ = "organization_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    org_name: Mapped[str] = mapped_column(String(150), default="Acme Corporation")
    domain: Mapped[str | None] = mapped_column(String(150))
    timezone: Mapped[str] = mapped_column(String(60), default="UTC")
    session_timeout_minutes: Mapped[int] = mapped_column(Integer, default=480)
    idle_timeout_minutes: Mapped[int] = mapped_column(Integer, default=60)
    password_min_length: Mapped[int] = mapped_column(Integer, default=12)
    password_require_upper: Mapped[bool] = mapped_column(Boolean, default=True)
    password_require_lower: Mapped[bool] = mapped_column(Boolean, default=True)
    password_require_digit: Mapped[bool] = mapped_column(Boolean, default=True)
    password_require_symbol: Mapped[bool] = mapped_column(Boolean, default=True)
    max_failed_logins: Mapped[int] = mapped_column(Integer, default=5)
    lockout_minutes: Mapped[int] = mapped_column(Integer, default=15)
    mfa_required_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    risk_block_threshold: Mapped[int] = mapped_column(Integer, default=80)
    risk_mfa_threshold: Mapped[int] = mapped_column(Integer, default=50)
    default_policy_action: Mapped[str] = mapped_column(String(40), default="DENY")
    business_hours_start: Mapped[int] = mapped_column(Integer, default=7)
    business_hours_end: Mapped[int] = mapped_column(Integer, default=20)
    risk_weights: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    notification_settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    allow_self_registration: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("risk_block_threshold BETWEEN 1 AND 100", name="block_thr"),
        CheckConstraint("risk_mfa_threshold BETWEEN 0 AND 100", name="mfa_thr"),
    )


Index("ix_audit_actor_created", AuditLog.actor_id, AuditLog.created_at)
Index("ix_secev_user_type_created", SecurityEvent.user_id, SecurityEvent.event_type, SecurityEvent.created_at)
Index("ix_sessions_user_active", UserSession.user_id, UserSession.revoked_at)
