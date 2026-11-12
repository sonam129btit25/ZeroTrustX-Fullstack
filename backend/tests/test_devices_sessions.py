import uuid

from sqlalchemy import select

from app.models import Device, DeviceTrustHistory, UserSession

API = "/api/v1"


def test_login_registers_pending_device(client, make_user, login, db):
    u = make_user()
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    login(u, device_id=dev)
    d = db.execute(select(Device).where(Device.device_identifier == dev)).scalar_one()
    assert d.trust_status == "pending_verification" and d.user_id == u.id


def test_admin_device_trust_lifecycle(client, make_user, login, db):
    u = make_user()
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    uh = login(u, device_id=dev)
    d = db.execute(select(Device).where(Device.device_identifier == dev)).scalar_one()
    ah = login(make_user("security_admin"))
    r = client.post(f"{API}/devices/{d.id}/trust", headers=ah, json={"status": "trusted", "reason": "Verified asset"})
    assert r.status_code == 200 and r.json()["trust_status"] == "trusted"
    assert client.post(f"{API}/devices/{d.id}/trust", headers=ah, json={"status": "bogus"}).status_code == 422
    r = client.post(f"{API}/devices/{d.id}/trust", headers=ah, json={"status": "blocked", "reason": "Lost laptop"})
    assert r.json()["trust_status"] == "blocked"
    hist = db.execute(select(DeviceTrustHistory).where(DeviceTrustHistory.device_id == d.id)).scalars().all()
    assert [h.to_status for h in sorted(hist, key=lambda h: h.created_at)][-2:] == ["trusted", "blocked"]
    # blocking the device revokes its sessions
    assert client.get(f"{API}/auth/me", headers=uh).status_code == 401
    detail = client.get(f"{API}/devices/{d.id}", headers=ah).json()
    assert "No endpoint agent" in detail["posture_note"]


def test_employee_sees_only_own_devices(client, make_user, login):
    h = login(make_user())
    assert client.get(f"{API}/devices", headers=h).status_code == 403
    mine = client.get(f"{API}/devices/mine", headers=h).json()
    assert len(mine) == 1 and mine[0]["is_current"]


def test_manual_device_registration(client, make_user, login):
    ah = login(make_user("security_admin"))
    r = client.post(f"{API}/devices", headers=ah, json={"name": "Lab Server 7", "device_type": "server", "os": "Linux",
                                                        "trust_status": "trusted"})
    assert r.status_code == 201 and r.json()["trust_status"] == "trusted" and r.json()["registered_via"] == "manual"


def test_admin_terminates_session(client, make_user, login, db):
    u = make_user()
    uh = login(u)
    ah = login(make_user("security_admin"))
    s = db.execute(select(UserSession).where(UserSession.user_id == u.id)).scalar_one()
    listing = client.get(f"{API}/sessions?status=active&q={u.email}", headers=ah).json()
    assert listing["total"] == 1
    r = client.post(f"{API}/sessions/{s.id}/terminate", headers=ah, json={"reason": "suspicious"})
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert client.get(f"{API}/auth/me", headers=uh).json()["detail"]["code"] == "session_revoked"


def test_user_cannot_terminate_others_session(client, make_user, login, db):
    a, b = make_user(), make_user()
    ah = login(a)
    login(b)
    s = db.execute(select(UserSession).where(UserSession.user_id == b.id)).scalar_one()
    assert client.post(f"{API}/sessions/{s.id}/terminate", headers=ah, json={}).status_code == 403
    mine = client.get(f"{API}/sessions/mine", headers=ah).json()
    assert len(mine) == 1 and mine[0]["is_current"]


def test_session_stats(client, make_user, login):
    ah = login(make_user("analyst"))
    r = client.get(f"{API}/sessions/stats", headers=ah)
    assert r.status_code == 200 and r.json()["active"] >= 1
