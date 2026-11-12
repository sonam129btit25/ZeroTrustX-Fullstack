"""Enumerations shared by models, schemas and the policy engine."""
from enum import StrEnum


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"
    LOCKED = "locked"


class TrustStatus(StrEnum):
    TRUSTED = "trusted"
    UNTRUSTED = "untrusted"
    SUSPICIOUS = "suspicious"
    BLOCKED = "blocked"
    PENDING = "pending_verification"


class Sensitivity(StrEnum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


SENSITIVITY_RANK = {Sensitivity.PUBLIC: 0, Sensitivity.INTERNAL: 1, Sensitivity.CONFIDENTIAL: 2, Sensitivity.RESTRICTED: 3}


class Decision(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    REQUIRE_MFA = "REQUIRE_MFA"
    REQUIRE_DEVICE_VERIFICATION = "REQUIRE_DEVICE_VERIFICATION"
    RESTRICTED_ACCESS = "RESTRICTED_ACCESS"


# Higher value == more restrictive. Used for deny-overrides combination.
DECISION_SEVERITY = {
    Decision.ALLOW: 0,
    Decision.RESTRICTED_ACCESS: 1,
    Decision.REQUIRE_MFA: 2,
    Decision.REQUIRE_DEVICE_VERIFICATION: 3,
    Decision.DENY: 4,
}


class RequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    REVOKED = "revoked"


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "informational"


SEVERITY_RANK = {Severity.INFO: 0, Severity.LOW: 1, Severity.MEDIUM: 2, Severity.HIGH: 3, Severity.CRITICAL: 4}


class AlertStatus(StrEnum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class IncidentStatus(StrEnum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    CONTAINED = "contained"
    RESOLVED = "resolved"
    CLOSED = "closed"


class RoleName(StrEnum):
    SUPER_ADMIN = "super_admin"
    SECURITY_ADMIN = "security_admin"
    ANALYST = "analyst"
    EMPLOYEE = "employee"
    GUEST = "guest"
