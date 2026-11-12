from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.request_ctx import ClientInfo, client_info
from app.core.security import decode_token
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Device, User, UserSession
from app.services import audit
from app.services.org import get_org
from app.services.sessions import revoke_session, touch

bearer = HTTPBearer(auto_error=False)


def _unauth(code: str, message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail={"code": code, "message": message}, headers={"WWW-Authenticate": "Bearer"}
    )


@dataclass
class AuthContext:
    user: User
    session: UserSession
    client: ClientInfo

    @property
    def device(self) -> Device | None:
        return self.session.device

    def has(self, perm: str) -> bool:
        return perm in self.user.permission_codes


def authenticate_token(db: Session, token: str) -> tuple[User, UserSession]:
    try:
        payload = decode_token(token, "access")
    except jwt.ExpiredSignatureError as exc:
        raise _unauth("token_expired", "Access token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauth("invalid_token", "Invalid access token") from exc
    try:
        sid = uuid.UUID(payload["sid"])
        uid = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise _unauth("invalid_token", "Malformed token") from exc
    s = db.get(UserSession, sid)
    if s is None or s.user_id != uid:
        raise _unauth("session_invalid", "Session not found")
    if s.revoked_at is not None:
        code = "session_expired" if s.revoked_reason in ("expired", "idle_timeout") else "session_revoked"
        raise _unauth(code, f"Session {s.revoked_reason or 'revoked'}")
    now = utcnow()
    org = get_org(db)
    if s.expires_at <= now or s.last_activity_at <= now - timedelta(minutes=org.idle_timeout_minutes):
        revoke_session(db, s, "expired" if s.expires_at <= now else "idle_timeout")
        db.commit()
        raise _unauth("session_expired", "Session expired")
    user = s.user
    if user.status != "active":
        revoke_session(db, s, f"account_{user.status}")
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "account_inactive", "message": f"Account {user.status}"})
    return user, s


def get_auth(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AuthContext:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauth("not_authenticated", "Authentication required")
    user, s = authenticate_token(db, creds.credentials)
    touch(db, s)
    db.commit()
    return AuthContext(user=user, session=s, client=client_info(request))


def require(*permissions: str):
    def dep(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> AuthContext:
        missing = [p for p in permissions if p not in auth.user.permission_codes]
        if missing:
            audit.record(
                db, "authz.denied", "authorization", actor=auth.user, severity="low", outcome="failure",
                ip=auth.client.ip, details={"missing_permissions": missing},
            )
            db.commit()
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={"code": "forbidden", "message": "You do not have permission to perform this action",
                        "missing": missing},
            )
        return auth

    return dep
