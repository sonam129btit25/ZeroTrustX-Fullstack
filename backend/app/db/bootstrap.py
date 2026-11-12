"""Idempotent bootstrap of RBAC catalogue and organisation settings (safe for every environment)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Permission, Role, RolePermission
from app.services.org import get_org

PERMISSIONS: dict[str, tuple[str, str]] = {
    "dashboard:read": ("View security dashboard", "dashboard"),
    "users:read": ("View users and identity details", "identity"),
    "users:write": ("Create, update, suspend and reset users", "identity"),
    "users:manage_roles": ("Assign roles to users", "identity"),
    "roles:read": ("View roles and permissions", "identity"),
    "roles:write": ("Modify role permissions", "identity"),
    "devices:read": ("View registered devices", "devices"),
    "devices:write": ("Register devices and change trust", "devices"),
    "policies:read": ("View Zero Trust policies", "policies"),
    "policies:write": ("Create, edit, delete and reorder policies", "policies"),
    "policies:simulate": ("Run the policy simulator", "policies"),
    "access_requests:create": ("Submit access requests", "access"),
    "access_requests:read_all": ("View all access requests", "access"),
    "access_requests:review": ("Approve, reject and revoke access requests", "access"),
    "sessions:read_all": ("Monitor all sessions (real-time)", "sessions"),
    "sessions:terminate": ("Terminate other users' sessions", "sessions"),
    "threats:read": ("View threat alerts", "threats"),
    "threats:write": ("Triage alerts and run detection scans", "threats"),
    "incidents:read": ("View incidents", "incidents"),
    "incidents:write": ("Open, assign, update and resolve incidents", "incidents"),
    "audit:read": ("Search audit logs", "audit"),
    "audit:export": ("Export audit logs", "audit"),
    "resources:read": ("View protected resource catalogue", "resources"),
    "resources:write": ("Manage protected resources", "resources"),
    "settings:read": ("View organisation settings", "settings"),
    "settings:write": ("Change organisation security settings", "settings"),
    "assistant:use": ("Use the advisory Security Assistant", "assistant"),
    # resource entitlements
    "resource:analytics:access": ("Access the internal analytics dashboard", "entitlements"),
    "resource:finance:access": ("Access financial records", "entitlements"),
    "resource:hr:access": ("Access the employee database", "entitlements"),
    "resource:admin-console:access": ("Access the administrative console", "entitlements"),
    "resource:research:access": ("Access research documents", "entitlements"),
}

ALL = set(PERMISSIONS)
ANALYST = {
    "dashboard:read", "users:read", "roles:read", "devices:read", "policies:read", "policies:simulate",
    "access_requests:create", "access_requests:read_all", "sessions:read_all", "threats:read", "threats:write",
    "incidents:read", "incidents:write", "audit:read", "audit:export", "resources:read", "assistant:use",
    "resource:analytics:access",
}
SEC_ADMIN = ALL - {"roles:write", "settings:write", "resource:finance:access", "resource:hr:access", "resource:research:access"}
EMPLOYEE = {"access_requests:create", "resources:read", "resource:analytics:access"}
GUEST = {"access_requests:create", "resources:read"}

ROLES = [
    ("super_admin", "Super Admin", "Unrestricted platform administration", 100, ALL),
    ("security_admin", "Security Administrator", "Manages identities, devices, policies and response", 80, SEC_ADMIN),
    ("analyst", "Security Analyst", "Investigates threats, incidents and audit activity", 50, ANALYST),
    ("employee", "Employee", "Standard workforce identity", 20, EMPLOYEE),
    ("guest", "Guest", "Limited external or new identity", 5, GUEST),
]


def bootstrap(db: Session) -> None:
    existing = {p.code: p for p in db.execute(select(Permission)).scalars()}
    for code, (desc, cat) in PERMISSIONS.items():
        if code not in existing:
            existing[code] = Permission(code=code, description=desc, category=cat)
            db.add(existing[code])
    db.flush()
    for name, display, desc, level, perms in ROLES:
        role = db.execute(select(Role).where(Role.name == name)).scalar()
        if role is None:
            role = Role(name=name, display_name=display, description=desc, level=level, is_system=True)
            db.add(role)
            db.flush()
            for code in perms:
                db.add(RolePermission(role_id=role.id, permission_id=existing[code].id))
        elif name == "super_admin":
            have = {p.code for p in role.permissions}
            for code in ALL - have:
                db.add(RolePermission(role_id=role.id, permission_id=existing[code].id))
    get_org(db)
    db.flush()
