from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, Permission, Role, RolePermission, User, UserRole
from app.ws.manager import queue_event


def notify_user(
    db: Session, user_id: uuid.UUID, title: str, body: str = "", *, category: str = "system",
    severity: str = "informational", link: str | None = None, preference: str | None = None,
) -> Notification | None:
    if preference:
        u = db.get(User, user_id)
        if u is not None and (u.preferences or {}).get(preference) is False:
            return None
    n = Notification(user_id=user_id, title=title, body=body, category=category, severity=severity, link=link)
    db.add(n)
    db.flush()
    queue_event(
        db,
        "notification.created",
        {"id": str(n.id), "title": title, "body": body, "severity": severity, "link": link, "category": category},
        {"users": [str(user_id)]},
    )
    return n


def users_with_permission(db: Session, code: str) -> list[uuid.UUID]:
    q = (
        select(User.id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(Permission.code == code, User.status == "active")
        .distinct()
    )
    return list(db.execute(q).scalars())


def notify_permission(db: Session, code: str, title: str, body: str = "", **kw) -> None:
    for uid in users_with_permission(db, code):
        notify_user(db, uid, title, body, **kw)
