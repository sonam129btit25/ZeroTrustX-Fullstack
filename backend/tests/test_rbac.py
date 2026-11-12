from sqlalchemy import select

from app.models import AuditLog, Role

API = "/api/v1"


def test_employee_cannot_access_admin_endpoints(client, make_user, login, db):
    u = make_user("employee")
    h = login(u)
    for path in ("/users", "/devices", "/policies", "/audit-logs", "/sessions", "/threats", "/dashboard/overview",
                 "/settings/organization"):
        r = client.get(API + path, headers=h)
        assert r.status_code == 403, path
        assert r.json()["detail"]["code"] == "forbidden"
    assert db.execute(select(AuditLog).where(AuditLog.action == "authz.denied", AuditLog.actor_id == u.id)).first()


def test_guest_permissions(client, make_user, login):
    h = login(make_user("guest"))
    assert client.get(f"{API}/resources", headers=h).status_code == 200
    assert client.post(f"{API}/resources", headers=h, json={"name": "x" * 5}).status_code == 403


def test_analyst_read_but_not_write(client, make_user, login):
    h = login(make_user("analyst"))
    assert client.get(f"{API}/users", headers=h).status_code == 200
    assert client.get(f"{API}/audit-logs", headers=h).status_code == 200
    r = client.post(f"{API}/users", headers=h, json={"email": "a@b.dev", "full_name": "A B", "password": "Xx!12345678901"})
    assert r.status_code == 403
    assert client.post(f"{API}/policies", headers=h, json={"name": "abc", "action": "DENY"}).status_code == 403


def test_security_admin_cannot_escalate_to_super_admin(client, make_user, login, db):
    sec = make_user("security_admin")
    target = make_user("employee")
    h = login(sec)
    super_role = db.execute(select(Role).where(Role.name == "super_admin")).scalar_one()
    r = client.put(f"{API}/users/{target.id}/roles", headers=h, json={"role_ids": [str(super_role.id)]})
    assert r.status_code == 403
    assert "escalation" in r.json()["detail"]["message"]


def test_cannot_change_own_roles(client, make_user, login, db):
    admin = make_user("super_admin")
    h = login(admin)
    emp = db.execute(select(Role).where(Role.name == "employee")).scalar_one()
    r = client.put(f"{API}/users/{admin.id}/roles", headers=h, json={"role_ids": [str(emp.id)]})
    assert r.status_code == 403


def test_security_admin_cannot_manage_peer(client, make_user, login):
    a, b = make_user("security_admin"), make_user("security_admin")
    h = login(a)
    assert client.post(f"{API}/users/{b.id}/suspend", headers=h, json={}).status_code == 403


def test_role_change_revokes_target_sessions(client, make_user, login, db):
    admin = make_user("super_admin")
    target = make_user("employee")
    th = login(target)
    h = login(admin)
    analyst = db.execute(select(Role).where(Role.name == "analyst")).scalar_one()
    r = client.put(f"{API}/users/{target.id}/roles", headers=h, json={"role_ids": [str(analyst.id)]})
    assert r.status_code == 200 and [x["name"] for x in r.json()["roles"]] == ["analyst"]
    assert client.get(f"{API}/auth/me", headers=th).status_code == 401
    log = db.execute(select(AuditLog).where(AuditLog.action == "user.roles_changed", AuditLog.target_id == str(target.id))).scalar_one()
    assert log.details["before"] == ["employee"] and log.details["after"] == ["analyst"]


def test_admin_user_crud_and_suspend(client, make_user, login):
    admin = make_user("super_admin")
    h = login(admin)
    r = client.post(f"{API}/users", headers=h, json={"email": "crud-user@test.dev", "full_name": "Crud User",
                                                     "password": "Crud!Password2026", "department": "QA"})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    assert client.post(f"{API}/users", headers=h, json={"email": "crud-user@test.dev", "full_name": "Crud User",
                                                        "password": "Crud!Password2026"}).status_code == 409
    assert client.patch(f"{API}/users/{uid}", headers=h, json={"job_title": "Tester"}).json()["job_title"] == "Tester"
    assert client.post(f"{API}/users/{uid}/suspend", headers=h, json={"reason": "test"}).json()["status"] == "suspended"
    assert client.post(f"{API}/users/{uid}/activate", headers=h, json={}).json()["status"] == "active"
    assert client.get(f"{API}/users/{uid}", headers=h).status_code == 200
    page = client.get(f"{API}/users?q=crud-user&page_size=5", headers=h).json()
    assert page["total"] == 1 and page["items"][0]["email"] == "crud-user@test.dev"


def test_suspension_kills_active_sessions(client, make_user, login):
    admin, target = make_user("super_admin"), make_user("employee")
    th = login(target)
    client.post(f"{API}/users/{target.id}/suspend", headers=login(admin), json={})
    r = client.get(f"{API}/auth/me", headers=th)
    assert r.status_code == 401


def test_role_permissions_immutable_for_super_admin(client, make_user, login, db):
    h = login(make_user("super_admin"))
    sr = db.execute(select(Role).where(Role.name == "super_admin")).scalar_one()
    assert client.put(f"{API}/roles/{sr.id}/permissions", headers=h, json={"permission_ids": []}).status_code == 403


def test_pagination_validation(client, make_user, login):
    h = login(make_user("super_admin"))
    assert client.get(f"{API}/users?page_size=1000", headers=h).status_code == 422
    assert client.get(f"{API}/users?page=0", headers=h).status_code == 422
    assert client.get(f"{API}/users?status=bogus", headers=h).status_code == 422
