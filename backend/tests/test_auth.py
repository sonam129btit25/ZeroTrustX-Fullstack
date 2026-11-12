from datetime import timedelta

from sqlalchemy import select

from app.core.config import settings
from app.db.base import utcnow
from app.models import AuditLog, SecurityEvent, User, UserSession
from tests.conftest import PASSWORD, device_headers, uniq

API = "/api/v1"


def test_register_and_login(client, db):
    email = uniq("reg")
    r = client.post(f"{API}/auth/register", json={"email": email, "full_name": "New Person", "password": PASSWORD})
    assert r.status_code == 201, r.text
    u = db.execute(select(User).where(User.email == email)).scalar_one()
    assert u.password_hash.startswith("$argon2id$") and PASSWORD not in u.password_hash
    assert u.role_names == ["guest"]
    r = client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, headers=device_headers())
    assert r.status_code == 200
    body = r.json()["auth"]
    assert body["user"]["email"] == email
    assert "refresh" not in body  # refresh token never in JSON body
    assert "ztx_refresh" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]
    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == email


def test_register_weak_password_rejected(client):
    r = client.post(f"{API}/auth/register", json={"email": uniq(), "full_name": "Weak", "password": "password"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "weak_password"


def test_register_duplicate_email(client, make_user):
    u = make_user()
    r = client.post(f"{API}/auth/register", json={"email": u.email, "full_name": "Dup", "password": PASSWORD})
    assert r.status_code == 409


def test_register_invalid_email(client):
    r = client.post(f"{API}/auth/register", json={"email": "nope", "full_name": "X Y", "password": PASSWORD})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "validation_error"


def test_invalid_credentials(client, make_user, db):
    u = make_user()
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": "Wrong!Password1"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "invalid_credentials"
    r2 = client.post(f"{API}/auth/login", json={"email": uniq("ghost"), "password": "Wrong!Password1"})
    assert r2.status_code == 401 and r2.json()["detail"] == r.json()["detail"]  # no user enumeration
    ev = db.execute(select(SecurityEvent).where(SecurityEvent.user_id == u.id, SecurityEvent.event_type == "login_failure")).scalars().all()
    assert len(ev) == 1
    assert db.execute(select(AuditLog).where(AuditLog.action == "auth.login_failed", AuditLog.actor_id == u.id)).first()


def test_account_lockout_after_failed_attempts(client, make_user, db):
    u = make_user()
    for _ in range(5):
        client.post(f"{API}/auth/login", json={"email": u.email, "password": "Wrong!Password1"})
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    assert r.status_code == 423
    db.refresh(u)
    assert u.locked_until is not None


def test_suspended_user_cannot_login(client, make_user):
    u = make_user(status="suspended")
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "account_inactive"


def test_unauthenticated_requests_rejected(client):
    assert client.get(f"{API}/auth/me").status_code == 401
    assert client.get(f"{API}/users").status_code == 401
    r = client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_token"


def test_refresh_rotation_and_reuse_detection(client, make_user, db):
    u = make_user()
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD}, headers=device_headers())
    old_cookie = client.cookies.get("ztx_refresh")
    r1 = client.post(f"{API}/auth/refresh")
    assert r1.status_code == 200
    new_cookie = client.cookies.get("ztx_refresh")
    assert new_cookie and new_cookie != old_cookie
    # Simulate an attacker replaying the old token after the grace window
    s = db.execute(select(UserSession).where(UserSession.user_id == u.id)).scalar_one()
    s.refresh_rotated_at = utcnow() - timedelta(minutes=5)
    db.commit()
    client.cookies.clear()
    client.cookies.set("ztx_refresh", old_cookie, path="/api/v1/auth")
    r2 = client.post(f"{API}/auth/refresh")
    assert r2.status_code == 401
    db.refresh(s)
    assert s.revoked_at is not None and s.revoked_reason == "refresh_token_reuse"


def test_logout_revokes_session(client, make_user, login):
    u = make_user()
    h = login(u)
    assert client.post(f"{API}/auth/logout", headers=h).status_code == 200
    r = client.get(f"{API}/auth/me", headers=h)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "session_revoked"


def test_logout_all_devices(client, make_user, login):
    u = make_user()
    h1, h2 = login(u), login(u)
    r = client.post(f"{API}/auth/logout-all", headers=h1)
    assert r.status_code == 200
    assert client.get(f"{API}/auth/me", headers=h1).status_code == 401
    assert client.get(f"{API}/auth/me", headers=h2).status_code == 401


def test_password_reset_flow(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "EXPOSE_DEV_RESET_TOKENS", True)
    u = make_user()
    r = client.post(f"{API}/auth/forgot-password", json={"email": u.email})
    assert r.status_code == 202
    token = r.json()["dev_reset_url"].split("token=")[1]
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": "short"}).status_code == 422
    new = "N3w!Secure-Password"
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": new}).status_code == 200
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": new}).status_code == 400  # single use
    assert client.post(f"{API}/auth/login", json={"email": u.email, "password": new}).status_code == 200


def test_forgot_password_does_not_leak_existence(client, monkeypatch):
    monkeypatch.setattr(settings, "EXPOSE_DEV_RESET_TOKENS", False)
    r = client.post(f"{API}/auth/forgot-password", json={"email": uniq("nobody")})
    assert r.status_code == 202 and "dev_reset_url" not in r.json()


def test_change_password_revokes_other_sessions(client, make_user, login):
    u = make_user()
    h1, h2 = login(u), login(u)
    r = client.post(f"{API}/auth/change-password", headers=h1,
                    json={"current_password": PASSWORD, "new_password": "Another!Pass2026"})
    assert r.status_code == 200
    assert client.get(f"{API}/auth/me", headers=h1).status_code == 200
    assert client.get(f"{API}/auth/me", headers=h2).status_code == 401


def test_login_rate_limited(client, make_user):
    u = make_user()
    codes = [client.post(f"{API}/auth/login", json={"email": u.email, "password": "x"}).status_code for _ in range(12)]
    assert 429 in codes


def test_refresh_grace_window_tolerates_interrupted_rotation(client, make_user, db):
    """A reload that aborts a refresh leaves the browser with the previous cookie; within the grace window
    it must re-rotate instead of being treated as token theft."""
    u = make_user()
    client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD}, headers=device_headers())
    old_cookie = client.cookies.get("ztx_refresh")
    assert client.post(f"{API}/auth/refresh").status_code == 200
    client.cookies.clear()
    client.cookies.set("ztx_refresh", old_cookie, path="/api/v1/auth")
    r = client.post(f"{API}/auth/refresh")
    assert r.status_code == 200
    s = db.execute(select(UserSession).where(UserSession.user_id == u.id)).scalar_one()
    db.refresh(s)
    assert s.revoked_at is None
