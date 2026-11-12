import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models import AuditLog, ThreatAlert

API = "/api/v1"


def test_audit_logs_search_and_export(client, make_user, login):
    admin = make_user("super_admin")
    h = login(admin)
    page = client.get(f"{API}/audit-logs?category=authentication&actor={admin.email}", headers=h).json()
    assert page["total"] >= 1 and all(i["category"] == "authentication" for i in page["items"])
    r = client.get(f"{API}/audit-logs/export?category=authentication", headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.splitlines()[0].startswith("id,timestamp,actor,action")
    detail = client.get(f"{API}/audit-logs/{page['items'][0]['id']}", headers=h)
    assert detail.status_code == 200


def test_audit_chain_verifies(client, make_user, login):
    h = login(make_user("super_admin"))
    r = client.get(f"{API}/audit-logs/verify", headers=h).json()
    assert r["valid"] is True and r["checked"] > 0


def test_audit_logs_are_append_only(db):
    log = db.execute(select(AuditLog).limit(1)).scalar_one()
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE audit_logs SET action='tampered' WHERE id=:i"), {"i": log.id})
        db.commit()
    db.rollback()
    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM audit_logs WHERE id=:i"), {"i": log.id})
        db.commit()
    db.rollback()


def test_no_audit_mutation_endpoints(client, make_user, login):
    h = login(make_user("super_admin"))
    assert client.delete(f"{API}/audit-logs/1", headers=h).status_code == 405
    assert client.put(f"{API}/audit-logs/1", headers=h, json={}).status_code == 405


def test_analyst_cannot_export_without_permission(client, make_user, login):
    h = login(make_user("employee"))
    assert client.get(f"{API}/audit-logs/export", headers=h).status_code == 403


def test_brute_force_detection_creates_alert(client, make_user, db):
    u = make_user()
    for _ in range(5):
        client.post(f"{API}/auth/login", json={"email": u.email, "password": "Wrong!Password1"})
    a = db.execute(select(ThreatAlert).where(ThreatAlert.user_id == u.id, ThreatAlert.rule_key == "brute_force")).scalar_one()
    assert a.severity == "high" and a.status == "open"
    db.refresh(u)
    assert u.risk_score > 0


def test_incident_workflow(client, make_user, login, db):
    analyst = make_user("analyst")
    h = login(analyst)
    victim = make_user()
    for _ in range(5):
        client.post(f"{API}/auth/login", json={"email": victim.email, "password": "Wrong!Password1"})
    alert = db.execute(select(ThreatAlert).where(ThreatAlert.user_id == victim.id)).scalars().first()
    r = client.post(f"{API}/threats/{alert.id}/escalate", headers=h, json={"assignee_id": str(analyst.id)})
    assert r.status_code == 201, r.text
    inc = r.json()
    assert inc["status"] == "investigating" and inc["alert_count"] == 1
    iid = inc["id"]
    assert client.post(f"{API}/incidents/{iid}/notes", headers=h, json={"body": "Contacted user"}).status_code == 201
    bad = client.patch(f"{API}/incidents/{iid}", headers=h, json={"status": "resolved"})
    assert bad.status_code == 400  # resolution summary required
    ok = client.patch(f"{API}/incidents/{iid}", headers=h, json={"status": "resolved", "resolution_summary": "False positive"})
    assert ok.json()["status"] == "resolved"
    assert client.patch(f"{API}/incidents/{iid}", headers=h, json={"status": "closed"}).json()["status"] == "closed"
    full = client.get(f"{API}/incidents/{iid}", headers=h).json()
    assert any(n["body"] == "Contacted user" for n in full["notes"])
    summ = client.get(f"{API}/assistant/incidents/{iid}", headers=h).json()
    assert summ["advisory"] is True and summ["provider"] == "local-rules"


def test_dashboard_overview(client, make_user, login):
    h = login(make_user("analyst"))
    for rng in ("today", "7d", "30d"):
        r = client.get(f"{API}/dashboard/overview?range={rng}", headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["metrics"]["total_users"] >= 1
        assert body["series"]["authentication"]
    assert client.get(f"{API}/dashboard/overview?range=custom", headers=h).status_code == 400


def test_assistant_cannot_modify_state(client, make_user, login):
    h = login(make_user("analyst"))
    r = client.post(f"{API}/assistant/ask", headers=h, json={"question": "who are the riskiest users?"})
    assert r.status_code == 200 and r.json()["advisory"] is True
    paths = [p for p in client.get("/api/openapi.json").json()["paths"] if p.startswith("/api/v1/assistant")]
    methods = {m for p in paths for m in client.get("/api/openapi.json").json()["paths"][p]}
    assert methods <= {"get", "post"}
    assert not any("approve" in p or "polic" in p for p in paths)


def test_global_search_respects_permissions(client, make_user, login):
    emp = make_user()
    h = login(emp)
    r = client.get(f"{API}/search?q=te", headers=h).json()
    assert "users" not in r and "resources" in r
