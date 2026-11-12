import uuid

from sqlalchemy import select

from app.models import AccessDecision, Policy, PolicyCondition
from tests.conftest import trust_device

API = "/api/v1"


def _ensure_policies(db):
    if db.execute(select(Policy).where(Policy.name == "T allow trusted")).first():
        return
    db.add(Policy(name="T allow trusted", priority=90, action="ALLOW",
                  conditions=[PolicyCondition(field="device.trust_status", operator="eq", value="trusted")]))
    db.add(Policy(name="T mfa sensitive", priority=30, action="REQUIRE_MFA", conditions=[
        PolicyCondition(field="session.mfa_verified", operator="is_false", value=None, position=0),
        PolicyCondition(field="resource.sensitivity", operator="in", value=["confidential", "restricted"], position=1)]))
    db.add(Policy(name="T verify device restricted", priority=20, action="REQUIRE_DEVICE_VERIFICATION", conditions=[
        PolicyCondition(field="device.trust_status", operator="neq", value="trusted", position=0),
        PolicyCondition(field="resource.sensitivity", operator="eq", value="restricted", position=1)]))
    db.commit()


def test_gateway_allows_entitled_user_on_trusted_device(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("employee")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    h = login(u, device_id=dev)
    trust_device(db, dev)
    res = make_resource("internal", "resource:analytics:access")
    r = client.post(f"{API}/resources/{res.id}/access", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "ALLOW" and body["granted"] and body["trace"]
    d = db.get(AccessDecision, uuid.UUID(body["decision_id"]))
    assert d is not None and d.decision == "ALLOW" and d.matched_policies


def test_gateway_untrusted_device_denied_by_default(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("employee")
    h = login(u)  # device auto-registered as pending_verification
    res = make_resource("internal", "resource:analytics:access")
    body = client.post(f"{API}/resources/{res.id}/access", headers=h).json()
    assert body["decision"] == "DENY" and not body["granted"]
    assert body["resource"]["url"] is None


def test_gateway_requires_mfa_for_confidential(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("super_admin")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    h = login(u, device_id=dev)
    trust_device(db, dev)
    res = make_resource("confidential", "resource:finance:access")
    body = client.post(f"{API}/resources/{res.id}/access", headers=h).json()
    assert body["decision"] == "REQUIRE_MFA"
    assert body["required_actions"]


def test_device_verification_required_for_restricted(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("super_admin")
    h = login(u)
    res = make_resource("restricted", "resource:hr:access")
    assert client.post(f"{API}/resources/{res.id}/access", headers=h).json()["decision"] == "REQUIRE_DEVICE_VERIFICATION"


def test_not_entitled_user_denied(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("guest")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    h = login(u, device_id=dev)
    trust_device(db, dev)
    res = make_resource("internal", "resource:analytics:access")
    body = client.post(f"{API}/resources/{res.id}/access", headers=h).json()
    assert body["decision"] == "DENY" and "not entitled" in body["reasons"][0]


def test_access_request_approval_grants_access(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    guest = make_user("guest")
    approver = make_user("security_admin")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    gh = login(guest, device_id=dev)
    trust_device(db, dev)
    res = make_resource("internal", "resource:analytics:access", requires_approval=True)
    r = client.post(f"{API}/access-requests", headers=gh, json={"resource_id": str(res.id), "duration_hours": 4,
                                                               "justification": "Need dashboard access for onboarding work"})
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["status"] == "pending" and req["engine_decision"] == "ALLOW"
    assert req["decision"]["trace"]
    # duplicate pending request blocked
    dup = client.post(f"{API}/access-requests", headers=gh, json={"resource_id": str(res.id),
                                                                 "justification": "Need dashboard access for onboarding work"})
    assert dup.status_code == 409
    # requester cannot approve (no permission) and approver approves
    assert client.post(f"{API}/access-requests/{req['id']}/approve", headers=gh, json={}).status_code == 403
    ah = login(approver)
    ok = client.post(f"{API}/access-requests/{req['id']}/approve", headers=ah, json={"comment": "ok"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved" and ok.json()["expires_at"]
    # access now granted through the gateway thanks to the active grant
    body = client.post(f"{API}/resources/{res.id}/access", headers=gh).json()
    assert body["decision"] == "ALLOW"
    detail = client.get(f"{API}/access-requests/{req['id']}", headers=gh).json()
    actions = [a["action"] for a in detail["audit_trail"]]
    assert "access_request.submitted" in actions and "access_request.approved" in actions
    # revoke -> gateway denies again
    assert client.post(f"{API}/access-requests/{req['id']}/revoke", headers=ah, json={}).json()["status"] == "revoked"
    assert client.post(f"{API}/resources/{res.id}/access", headers=gh).json()["decision"] == "DENY"


def test_self_approval_forbidden(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    admin = make_user("security_admin")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    h = login(admin, device_id=dev)
    trust_device(db, dev)
    res = make_resource("internal", "resource:research:access")
    req = client.post(f"{API}/access-requests", headers=h, json={"resource_id": str(res.id),
                                                                "justification": "Research review for upcoming audit cycle"}).json()
    r = client.post(f"{API}/access-requests/{req['id']}/approve", headers=h, json={})
    assert r.status_code == 403 and "Separation of duties" in r.json()["detail"]["message"]


def test_request_auto_rejected_when_engine_denies(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("employee")
    h = login(u)  # pending device -> no ALLOW policy matches -> default deny
    res = make_resource("internal", "resource:research:access")
    r = client.post(f"{API}/access-requests", headers=h, json={"resource_id": str(res.id),
                                                              "justification": "Research review for upcoming audit cycle"})
    assert r.json()["status"] == "rejected" and r.json()["engine_decision"] == "DENY"
    assert "Automatically rejected" in r.json()["review_comment"]


def test_reject_requires_comment_and_validation(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    u = make_user("employee")
    dev = f"dev-{uuid.uuid4().hex[:12]}"
    h = login(u, device_id=dev)
    trust_device(db, dev)
    res = make_resource("internal", "resource:research:access")
    assert client.post(f"{API}/access-requests", headers=h, json={"resource_id": str(res.id), "justification": "short"}).status_code == 422
    req = client.post(f"{API}/access-requests", headers=h, json={"resource_id": str(res.id),
                                                                "justification": "Valid business justification text"}).json()
    ah = login(make_user("security_admin"))
    assert client.post(f"{API}/access-requests/{req['id']}/reject", headers=ah, json={"comment": ""}).status_code == 422
    r = client.post(f"{API}/access-requests/{req['id']}/reject", headers=ah, json={"comment": "Not needed for role"})
    assert r.json()["status"] == "rejected"
    # cannot approve after rejection
    assert client.post(f"{API}/access-requests/{req['id']}/approve", headers=ah, json={}).status_code == 400


def test_employee_cannot_list_all_requests(client, make_user, login):
    h = login(make_user("employee"))
    assert client.get(f"{API}/access-requests?scope=all", headers=h).status_code == 403
    assert client.get(f"{API}/access-requests?scope=mine", headers=h).status_code == 200


def test_policy_crud_and_simulator(client, make_user, login, make_resource, db):
    _ensure_policies(db)
    h = login(make_user("super_admin"))
    bad = client.post(f"{API}/policies", headers=h, json={"name": "Bad", "action": "DENY",
                                                          "conditions": [{"field": "user.risk_score", "operator": "contains", "value": [1]}]})
    assert bad.status_code == 422
    r = client.post(f"{API}/policies", headers=h, json={
        "name": f"Block night {uuid.uuid4().hex[:4]}", "action": "DENY", "priority": 5,
        "conditions": [{"field": "request.hour", "operator": "between", "value": [0, 5]}]})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    res = make_resource("internal", "resource:analytics:access")
    sim = client.post(f"{API}/policies/simulate", headers=h, json={"resource_id": str(res.id), "roles": ["employee"],
                                                                   "has_entitlement": True, "hour": 3, "device_trust_status": "trusted"})
    assert sim.status_code == 200 and sim.json()["decision"] == "DENY"
    assert any(m["policy_id"] == pid and m["deciding"] for m in sim.json()["matched_policies"])
    sim2 = client.post(f"{API}/policies/simulate", headers=h, json={"resource_id": str(res.id), "roles": ["employee"],
                                                                    "has_entitlement": True, "hour": 10, "device_trust_status": "trusted"})
    assert sim2.json()["decision"] == "ALLOW"
    assert client.post(f"{API}/policies/{pid}/toggle", headers=h).json()["is_enabled"] is False
    sim3 = client.post(f"{API}/policies/simulate", headers=h, json={"resource_id": str(res.id), "roles": ["employee"],
                                                                    "has_entitlement": True, "hour": 3, "device_trust_status": "trusted"})
    assert sim3.json()["decision"] == "ALLOW"
    detail = client.get(f"{API}/policies/{pid}", headers=h).json()
    assert {c["action"] for c in detail["change_history"]} >= {"policy.created", "policy.disabled"}
    assert client.delete(f"{API}/policies/{pid}", headers=h).status_code == 204
