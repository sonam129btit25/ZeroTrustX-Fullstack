import pyotp
from sqlalchemy import select

from app.models import MFAConfig, RecoveryCode
from tests.conftest import PASSWORD, device_headers, totp_now

API = "/api/v1"


def _enroll(client, h):
    setup = client.post(f"{API}/mfa/setup", headers=h)
    assert setup.status_code == 200
    data = setup.json()
    assert data["qr_svg_data_url"].startswith("data:image/svg+xml;base64,")
    secret = data["secret"]
    r = client.post(f"{API}/mfa/enable", headers=h, json={"code": totp_now(secret)})
    assert r.status_code == 200, r.text
    return secret, r.json()["recovery_codes"]


def test_mfa_enrolment_secret_encrypted(client, make_user, login, db):
    u = make_user()
    h = login(u)
    secret, codes = _enroll(client, h)
    assert len(codes) == 10
    cfg = db.execute(select(MFAConfig).where(MFAConfig.user_id == u.id)).scalar_one()
    assert secret not in cfg.secret_encrypted  # encrypted at rest
    stored = db.execute(select(RecoveryCode.code_hash).where(RecoveryCode.user_id == u.id)).scalars().all()
    assert codes[0] not in stored  # hashed at rest
    status = client.get(f"{API}/mfa/status", headers=h).json()
    assert status["enabled"] and status["recovery_codes_remaining"] == 10


def test_login_requires_mfa_and_verifies(client, make_user):
    secret = pyotp.random_base32()
    u = make_user(mfa_secret=secret)
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD}, headers=device_headers())
    assert r.status_code == 200 and r.json()["mfa_required"] and r.json()["auth"] is None
    token = r.json()["mfa_token"]
    bad = client.post(f"{API}/auth/mfa/verify", json={"mfa_token": token, "code": "000000"})
    assert bad.status_code == 401
    code = totp_now(secret)
    ok = client.post(f"{API}/auth/mfa/verify", json={"mfa_token": token, "code": code})
    assert ok.status_code == 200
    assert ok.json()["user"]["session"]["mfa_verified"] is True
    # replay of the same code is rejected
    r2 = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    replay = client.post(f"{API}/auth/mfa/verify", json={"mfa_token": r2.json()["mfa_token"], "code": code})
    assert replay.status_code == 401


def test_mfa_token_cannot_be_used_as_access_token(client, make_user):
    u = make_user(mfa_secret=pyotp.random_base32())
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {r.json()['mfa_token']}"})
    assert me.status_code == 401


def test_recovery_code_login_single_use(client, make_user, login):
    u = make_user()
    h = login(u)
    _, codes = _enroll(client, h)
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    ok = client.post(f"{API}/auth/mfa/verify", json={"mfa_token": r.json()["mfa_token"], "recovery_code": codes[0]})
    assert ok.status_code == 200
    r = client.post(f"{API}/auth/login", json={"email": u.email, "password": PASSWORD})
    again = client.post(f"{API}/auth/mfa/verify", json={"mfa_token": r.json()["mfa_token"], "recovery_code": codes[0]})
    assert again.status_code == 401


def test_disable_mfa_requires_password_and_code(client, make_user, login):
    u = make_user()
    h = login(u)
    secret, codes = _enroll(client, h)
    assert client.post(f"{API}/mfa/disable", headers=h, json={"password": "Wrong!Password1", "code": codes[1]}).status_code == 400
    assert client.post(f"{API}/mfa/disable", headers=h, json={"password": PASSWORD, "code": "123456"}).status_code == 400
    assert client.post(f"{API}/mfa/disable", headers=h, json={"password": PASSWORD, "code": codes[1]}).status_code == 200
    assert client.get(f"{API}/mfa/status", headers=h).json()["enabled"] is False


def test_step_up_marks_session_verified(client, make_user, login, db):
    from app.models import UserSession

    u = make_user()
    h = login(u)
    secret, _ = _enroll(client, h)
    s = db.execute(select(UserSession).where(UserSession.user_id == u.id)).scalar_one()
    s.mfa_verified = False
    db.commit()
    assert client.post(f"{API}/auth/step-up", headers=h, json={"code": "000000"}).status_code == 401
    import time

    time.sleep(max(0, 30 - time.time() % 30) + 0.5)  # next TOTP window (enable consumed the current step)
    r = client.post(f"{API}/auth/step-up", headers=h, json={"code": totp_now(secret)})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["session"]["mfa_verified"] is True
