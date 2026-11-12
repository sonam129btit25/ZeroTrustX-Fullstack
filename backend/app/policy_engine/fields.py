"""Catalogue of attributes and operators available to policy conditions."""
from typing import Any

OPERATORS: dict[str, str] = {
    "eq": "equals",
    "neq": "does not equal",
    "in": "is one of",
    "not_in": "is not one of",
    "gt": "is greater than",
    "gte": "is at least",
    "lt": "is less than",
    "lte": "is at most",
    "between": "is between (inclusive)",
    "contains": "contains any of",
    "not_contains": "contains none of",
    "in_cidr": "is inside network",
    "not_in_cidr": "is outside network",
    "is_true": "is true",
    "is_false": "is false",
}

_STR = ["eq", "neq", "in", "not_in"]
_NUM = ["eq", "neq", "gt", "gte", "lt", "lte", "between"]
_BOOL = ["is_true", "is_false"]

FIELDS: dict[str, dict[str, Any]] = {
    "user.role": {
        "label": "User role",
        "type": "list",
        "operators": ["contains", "not_contains"],
        "options": ["super_admin", "security_admin", "analyst", "employee", "guest"],
    },
    "user.risk_score": {"label": "User risk score", "type": "number", "operators": _NUM},
    "user.department": {"label": "User department", "type": "string", "operators": _STR},
    "user.mfa_enabled": {"label": "User has MFA enrolled", "type": "boolean", "operators": _BOOL},
    "session.mfa_verified": {"label": "Session MFA verified", "type": "boolean", "operators": _BOOL},
    "session.age_minutes": {"label": "Session age (minutes)", "type": "number", "operators": _NUM},
    "device.trust_status": {
        "label": "Device trust status",
        "type": "string",
        "operators": _STR,
        "options": ["trusted", "untrusted", "suspicious", "blocked", "pending_verification", "unknown"],
    },
    "device.risk_score": {"label": "Device risk score", "type": "number", "operators": _NUM},
    "request.ip": {"label": "Source IP address", "type": "ip", "operators": ["eq", "neq", "in_cidr", "not_in_cidr"]},
    "request.hour": {"label": "Hour of day (org timezone)", "type": "number", "operators": _NUM},
    "request.weekday": {
        "label": "Weekday (0=Mon..6=Sun)",
        "type": "number",
        "operators": ["in", "not_in", "eq", "neq"],
    },
    "request.is_business_hours": {"label": "Within business hours", "type": "boolean", "operators": _BOOL},
    "resource.sensitivity": {
        "label": "Resource sensitivity",
        "type": "string",
        "operators": _STR,
        "options": ["public", "internal", "confidential", "restricted"],
    },
    "resource.slug": {"label": "Resource", "type": "string", "operators": _STR},
    "resource.type": {
        "label": "Resource type",
        "type": "string",
        "operators": _STR,
        "options": ["application", "database", "dashboard", "document", "console", "api"],
    },
}


def validate_condition(field: str, operator: str, value: Any) -> str | None:
    """Return an error message, or None when the condition is well-formed."""
    meta = FIELDS.get(field)
    if not meta:
        return f"Unknown field '{field}'"
    if operator not in meta["operators"]:
        return f"Operator '{operator}' is not valid for field '{field}'"
    if operator in ("is_true", "is_false"):
        return None
    if operator in ("in", "not_in", "contains", "not_contains"):
        if not isinstance(value, list) or not value:
            return f"'{field}' {operator} requires a non-empty list"
    elif operator == "between":
        if not (isinstance(value, list) and len(value) == 2 and all(isinstance(v, (int, float)) for v in value)):
            return "'between' requires [min, max]"
    elif operator in ("in_cidr", "not_in_cidr"):
        import ipaddress

        vals = value if isinstance(value, list) else [value]
        try:
            for v in vals:
                ipaddress.ip_network(str(v), strict=False)
        except ValueError:
            return f"Invalid network in '{field}'"
    elif meta["type"] == "number" and operator in ("gt", "gte", "lt", "lte", "eq", "neq"):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return f"'{field}' requires a numeric value"
    elif value is None or value == "":
        return f"'{field}' requires a value"
    return None
