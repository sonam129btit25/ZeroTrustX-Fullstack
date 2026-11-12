"""Seed the database.

    python -m app.db.seed            # bootstrap RBAC + org settings + demo data (development)
    python -m app.db.seed --no-demo  # bootstrap only (production-safe)

All demo records are flagged ``is_demo=True`` so they are distinguishable from runtime events.
Demo data is refused when APP_ENV=production.
"""
from __future__ import annotations

import argparse
import random

import pyotp
from datetime import timedelta

from sqlalchemy import select

from app.core.config import settings
from app.core.security import encrypt_secret, generate_recovery_codes, hash_password, hash_token
from app.db.base import utcnow
from app.db.bootstrap import bootstrap
from app.db.session import SessionLocal
from app.models import (
    AccessDecision,
    AccessDecisionPolicy,
    AccessRequest,
    Device,
    DeviceTrustHistory,
    Incident,
    IncidentNote,
    MFAConfig,
    Notification,
    Policy,
    PolicyCondition,
    ProtectedResource,
    RecoveryCode,
    Role,
    SecurityEvent,
    ThreatAlert,
    User,
    UserSession,
)
from app.policy_engine.engine import EvaluationContext
from app.services import audit
from app.services.access import build_engine, resource_dict

DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP"  # well-known example secret; development only

DEMO_ACCOUNTS = [
    # email, name, password, role, dept, title
    ("admin@zerotrustx.dev", "Avery Morgan", "SuperAdmin!2026", "super_admin", "Security", "Chief Information Security Officer"),
    ("secadmin@zerotrustx.dev", "Jordan Lee", "SecAdmin!2026", "security_admin", "Security", "Security Administrator"),
    ("analyst@zerotrustx.dev", "Priya Natarajan", "Analyst!2026x", "analyst", "Security Operations", "SOC Analyst"),
    ("employee@zerotrustx.dev", "Marcus Chen", "Employee!2026", "employee", "Engineering", "Software Engineer"),
    ("guest@zerotrustx.dev", "Sam Rivera", "GuestUser!2026", "guest", "External", "Contractor"),
    ("mfa@zerotrustx.dev", "Elena Petrova", "MfaDemo!2026x", "security_admin", "Security", "Identity Engineer"),
]
OTHER_PASSWORD = "ZeroTrust!Demo1"
SEC_ADMINS = [("Noah Williams", "Security"), ("Fatima Al-Sayed", "Security"), ("Liam O'Connor", "Security Operations")]
ANALYSTS = [("Hannah Becker", "Security Operations")]
EMPLOYEES = [
    ("Olivia Martinez", "Finance", "Financial Analyst"), ("Ethan Brooks", "Finance", "Controller"),
    ("Mia Thompson", "Human Resources", "HR Business Partner"), ("Lucas Silva", "Engineering", "Platform Engineer"),
    ("Chloe Dubois", "Research", "Research Scientist"), ("Daniel Kim", "Engineering", "Site Reliability Engineer"),
    ("Grace Okafor", "Research", "Data Scientist"), ("Henry Walker", "Sales", "Account Executive"),
    ("Isabella Rossi", "Marketing", "Marketing Manager"), ("Jack Nguyen", "Engineering", "Frontend Engineer"),
    ("Zoe Adams", "Legal", "Counsel"), ("Ryan Patel", "Operations", "Operations Lead"),
    ("Ava Johansson", "Human Resources", "Recruiter"), ("Leo Fischer", "Finance", "Accountant"),
]
LOCATIONS = [("New York, US", "US"), ("London, GB", "GB"), ("Berlin, DE", "DE"), ("Toronto, CA", "CA"),
             ("Singapore, SG", "SG"), ("Sydney, AU", "AU"), ("São Paulo, BR", "BR"), ("Mumbai, IN", "IN")]


def email_for(name: str) -> str:
    return name.lower().replace("'", "").replace(" ", ".").replace("-", "") + "@zerotrustx.dev"


def seed_demo(db) -> None:
    rnd = random.Random(42)
    now = utcnow()
    roles = {r.name: r for r in db.execute(select(Role)).scalars()}
    demo_hash = hash_password(OTHER_PASSWORD)

    # ---------------------------------------------------------------- users
    users: dict[str, User] = {}
    for email, name, pw, role, dept, title in DEMO_ACCOUNTS:
        users[email] = User(email=email, full_name=name, password_hash=hash_password(pw), department=dept,
                            job_title=title, roles=[roles[role]], is_demo=True, password_changed_at=now - timedelta(days=40),
                            created_at=now - timedelta(days=120))
    for name, dept in SEC_ADMINS:
        users[email_for(name)] = User(email=email_for(name), full_name=name, password_hash=demo_hash, department=dept,
                                      job_title="Security Administrator", roles=[roles["security_admin"]], is_demo=True,
                                      created_at=now - timedelta(days=rnd.randint(60, 200)))
    for name, dept in ANALYSTS:
        users[email_for(name)] = User(email=email_for(name), full_name=name, password_hash=demo_hash, department=dept,
                                      job_title="Threat Analyst", roles=[roles["analyst"]], is_demo=True,
                                      created_at=now - timedelta(days=rnd.randint(60, 200)))
    for name, dept, title in EMPLOYEES:
        users[email_for(name)] = User(email=email_for(name), full_name=name, password_hash=demo_hash, department=dept,
                                      job_title=title, roles=[roles["employee"]], is_demo=True,
                                      created_at=now - timedelta(days=rnd.randint(20, 300)))
    for u in users.values():
        db.add(u)
    db.flush()
    U = users
    # role-specific entitlements via extra employee roles are modeled through access grants below
    U["leo.fischer@zerotrustx.dev"].status = "suspended"
    U["zoe.adams@zerotrustx.dev"].status = "deactivated"

    # MFA for selected accounts
    mfa_users = ["mfa@zerotrustx.dev", "noah.williams@zerotrustx.dev", "fatima.alsayed@zerotrustx.dev",
                 "hannah.becker@zerotrustx.dev", "olivia.martinez@zerotrustx.dev", "chloe.dubois@zerotrustx.dev",
                 "daniel.kim@zerotrustx.dev"]
    for e in mfa_users:
        secret = DEMO_TOTP_SECRET if e == "mfa@zerotrustx.dev" else pyotp.random_base32()
        db.add(MFAConfig(user_id=U[e].id, secret_encrypted=encrypt_secret(secret), is_enabled=True,
                         enabled_at=now - timedelta(days=30)))
        for c in generate_recovery_codes():
            db.add(RecoveryCode(user_id=U[e].id, code_hash=hash_token(c)))
        U[e].mfa_enabled = True

    risk_seed = {"ethan.brooks@zerotrustx.dev": 72, "henry.walker@zerotrustx.dev": 64, "jack.nguyen@zerotrustx.dev": 48,
                 "guest@zerotrustx.dev": 38, "isabella.rossi@zerotrustx.dev": 31, "ryan.patel@zerotrustx.dev": 22,
                 "employee@zerotrustx.dev": 12, "leo.fischer@zerotrustx.dev": 85, "lucas.silva@zerotrustx.dev": 18}
    for e, s in risk_seed.items():
        U[e].risk_score = s
    for u in U.values():
        u.last_login_at = now - timedelta(hours=rnd.randint(1, 72))
        u.last_login_ip = f"10.20.{rnd.randint(1, 30)}.{rnd.randint(2, 250)}"

    # ---------------------------------------------------------------- devices (10)
    dev_specs = [
        ("AM-MBP-Secure", "laptop", "macOS", "15.1", "admin@zerotrustx.dev", "trusted", 5),
        ("JL-ThinkPad-X1", "laptop", "Windows", "11 23H2", "secadmin@zerotrustx.dev", "trusted", 8),
        ("PN-SOC-Workstation", "desktop", "Linux", "Ubuntu 24.04", "analyst@zerotrustx.dev", "trusted", 6),
        ("MC-Dev-Laptop", "laptop", "macOS", "14.6", "employee@zerotrustx.dev", "trusted", 12),
        ("SR-Personal-Laptop", "laptop", "Windows", "10 22H2", "guest@zerotrustx.dev", "untrusted", 55),
        ("EB-iPhone", "mobile", "iOS", "18.0", "ethan.brooks@zerotrustx.dev", "suspicious", 78),
        ("HW-Galaxy-S23", "mobile", "Android", "14", "henry.walker@zerotrustx.dev", "pending_verification", 35),
        ("Unknown-Kali-VM", "desktop", "Linux", "Kali 2024.3", None, "blocked", 98),
        ("OM-Finance-Laptop", "laptop", "Windows", "11 23H2", "olivia.martinez@zerotrustx.dev", "trusted", 9),
        ("CD-Research-iPad", "tablet", "iPadOS", "17.5", "chloe.dubois@zerotrustx.dev", "pending_verification", 28),
    ]
    devices: dict[str, Device] = {}
    for name, dtype, os_, ver, owner, trust, risk_ in dev_specs:
        d = Device(device_identifier=f"demo-{name.lower()}", name=name, device_type=dtype, os=os_, os_version=ver,
                   browser="Chrome 130" if dtype in ("laptop", "desktop") else "Safari 18", trust_status=trust,
                   risk_score=risk_, user_id=U[owner].id if owner else None, registered_via="manual" if trust == "trusted" else "login",
                   ip_address=f"10.20.{rnd.randint(1, 30)}.{rnd.randint(2, 250)}" if trust != "blocked" else "185.220.101.47",
                   last_seen_at=now - timedelta(hours=rnd.randint(0, 48)), is_demo=True,
                   approved_by_id=U["secadmin@zerotrustx.dev"].id if trust == "trusted" else None,
                   approved_at=now - timedelta(days=20) if trust == "trusted" else None,
                   created_at=now - timedelta(days=rnd.randint(5, 90)))
        db.add(d)
        db.flush()
        db.add(DeviceTrustHistory(device_id=d.id, from_status=None, to_status="pending_verification",
                                  reason="Registered", created_at=d.created_at))
        if trust != "pending_verification":
            db.add(DeviceTrustHistory(device_id=d.id, from_status="pending_verification", to_status=trust,
                                      changed_by_id=U["secadmin@zerotrustx.dev"].id,
                                      reason={"trusted": "Verified corporate asset", "untrusted": "Personal device, not managed",
                                              "suspicious": "Login from anomalous location", "blocked": "Associated with password spraying"}[trust],
                                      created_at=d.created_at + timedelta(days=1)))
        devices[name] = d

    # ---------------------------------------------------------------- resources
    res_specs = [
        ("Company Handbook", "Policies, benefits and onboarding guides", "document", "public", None, False, None),
        ("Internal Analytics Dashboard", "Business KPIs and product analytics", "dashboard", "internal",
         "resource:analytics:access", False, "secadmin@zerotrustx.dev"),
        ("Financial Records", "General ledger, forecasts and payroll summaries", "database", "confidential",
         "resource:finance:access", True, "ethan.brooks@zerotrustx.dev"),
        ("Employee Database", "HRIS employee records including PII", "database", "restricted", "resource:hr:access",
         True, "mia.thompson@zerotrustx.dev"),
        ("Administrative Console", "Infrastructure and identity administration console", "console", "restricted",
         "resource:admin-console:access", True, "admin@zerotrustx.dev"),
        ("Research Documents", "Unpublished R&D papers and datasets", "document", "confidential", "resource:research:access",
         True, "chloe.dubois@zerotrustx.dev"),
    ]
    resources: dict[str, ProtectedResource] = {}
    for name, desc, rtype, sens, perm, approval, owner in res_specs:
        slug = {"Administrative Console": "admin-console"}.get(name, name.lower().replace(" ", "-"))
        r = ProtectedResource(name=name, slug=slug, description=desc, resource_type=rtype, sensitivity=sens,
                              required_permission=perm, requires_approval=approval, owner_id=U[owner].id if owner else None,
                              url=f"https://{slug}.internal.zerotrustx.dev", max_grant_hours=168 if sens != "restricted" else 24,
                              is_demo=True, created_at=now - timedelta(days=100))
        if name == "Administrative Console":
            r.allowed_ip_ranges = ["10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
        db.add(r)
        resources[name] = r
    db.flush()

    # ---------------------------------------------------------------- policies (8)
    pol_specs = [
        (10, "Deny suspicious devices on sensitive data", "Suspicious devices may not reach confidential or restricted data.",
         "DENY", "all", [("device.trust_status", "eq", "suspicious"), ("resource.sensitivity", "in", ["confidential", "restricted"])]),
        (20, "Restricted data requires a trusted device", "Restricted resources demand an administrator-verified device.",
         "REQUIRE_DEVICE_VERIFICATION", "all", [("device.trust_status", "neq", "trusted"), ("resource.sensitivity", "eq", "restricted")]),
        (30, "MFA for confidential and restricted data", "Sessions must be MFA-verified for sensitive data.",
         "REQUIRE_MFA", "all", [("session.mfa_verified", "is_false", None), ("resource.sensitivity", "in", ["confidential", "restricted"])]),
        (40, "Admin console limited to administrators", "Only Super Admins and Security Administrators may use the console.",
         "DENY", "all", [("resource.slug", "eq", "admin-console"), ("user.role", "not_contains", ["super_admin", "security_admin"])]),
        (50, "Off-hours sensitive access is read-only", "Outside business hours, restricted data is read-only.",
         "RESTRICTED_ACCESS", "all", [("request.is_business_hours", "is_false", None), ("resource.sensitivity", "eq", "restricted")]),
        (60, "High-risk devices get read-only access", "Devices with elevated risk receive restricted access.",
         "RESTRICTED_ACCESS", "all", [("device.risk_score", "gte", 60)]),
        (90, "Allow verified access from trusted devices", "Baseline allow for trusted devices once all controls pass.",
         "ALLOW", "all", [("device.trust_status", "eq", "trusted")]),
        (100, "Allow internal resources from known devices", "Public/internal resources from trusted or pending devices.",
         "ALLOW", "all", [("resource.sensitivity", "in", ["public", "internal"]),
                          ("device.trust_status", "in", ["trusted", "pending_verification"])]),
    ]
    policies = []
    for prio, name, desc, action, mode, conds in pol_specs:
        p = Policy(name=name, description=desc, priority=prio, action=action, match_mode=mode, is_demo=True,
                   created_by_id=U["admin@zerotrustx.dev"].id, created_at=now - timedelta(days=60),
                   conditions=[PolicyCondition(field=f, operator=o, value=v, position=i) for i, (f, o, v) in enumerate(conds)])
        db.add(p)
        policies.append(p)
    db.flush()

    # ---------------------------------------------------------------- sessions
    def make_session(u: User, dev: Device | None, created, active=True, mfa=None, ip=None, reason=None):
        s = UserSession(user_id=u.id, device_id=dev.id if dev else None, ip_address=ip or (dev.ip_address if dev else "10.20.4.18"),
                        user_agent="Mozilla/5.0 (demo seed)", location=rnd.choice(LOCATIONS)[0], created_at=created,
                        last_activity_at=created + timedelta(minutes=rnd.randint(1, 50)) if not active else now - timedelta(minutes=rnd.randint(0, 25)),
                        expires_at=created + timedelta(hours=8) if not active else now + timedelta(hours=rnd.randint(2, 7)),
                        mfa_verified=u.mfa_enabled if mfa is None else mfa, risk_score=u.risk_score, is_demo=True,
                        revoked_at=None if active else created + timedelta(hours=rnd.randint(1, 7)),
                        revoked_reason=None if active else (reason or rnd.choice(["logout", "expired", "idle_timeout"])))
        db.add(s)
        return s

    active_pairs = [("admin@zerotrustx.dev", "AM-MBP-Secure"), ("secadmin@zerotrustx.dev", "JL-ThinkPad-X1"),
                    ("analyst@zerotrustx.dev", "PN-SOC-Workstation"), ("employee@zerotrustx.dev", "MC-Dev-Laptop"),
                    ("guest@zerotrustx.dev", "SR-Personal-Laptop"), ("ethan.brooks@zerotrustx.dev", "EB-iPhone"),
                    ("henry.walker@zerotrustx.dev", "HW-Galaxy-S23"), ("olivia.martinez@zerotrustx.dev", "OM-Finance-Laptop"),
                    ("chloe.dubois@zerotrustx.dev", "CD-Research-iPad"), ("ethan.brooks@zerotrustx.dev", None)]
    sessions = {}
    for e, dn in active_pairs:
        s = make_session(U[e], devices.get(dn) if dn else None, now - timedelta(hours=rnd.randint(1, 6)),
                         ip="203.0.113.77" if dn is None else None)
        sessions.setdefault(e, s)
    for _ in range(14):
        e = rnd.choice(list(U))
        make_session(U[e], None, now - timedelta(days=rnd.randint(1, 25), hours=rnd.randint(0, 23)), active=False)
    make_session(U["henry.walker@zerotrustx.dev"], devices["HW-Galaxy-S23"], now - timedelta(days=2), active=False,
                 reason="terminated_by_admin")
    db.flush()

    # ---------------------------------------------------------------- security events (logins)
    active_users = [u for u in U.values() if u.status == "active"]
    for _ in range(260):
        u = rnd.choice(active_users)
        ts = now - timedelta(days=rnd.uniform(0, 30))
        loc, cc = rnd.choice(LOCATIONS[:5]) if rnd.random() < 0.85 else rnd.choice(LOCATIONS)
        ok = rnd.random() < 0.86
        db.add(SecurityEvent(event_type="login_success" if ok else "login_failure", user_id=u.id, email_attempted=u.email,
                             ip_address=f"10.20.{rnd.randint(1, 30)}.{rnd.randint(2, 250)}" if ok else f"198.51.100.{rnd.randint(2, 250)}",
                             location=loc, country_code=cc, severity="informational" if ok else "low",
                             details={"method": "password+totp" if u.mfa_enabled else "password", "demo": True},
                             created_at=ts, is_demo=True, user_agent="Mozilla/5.0 (demo seed)"))
    for i in range(9):  # brute force burst against Ethan
        db.add(SecurityEvent(event_type="login_failure", user_id=U["ethan.brooks@zerotrustx.dev"].id,
                             email_attempted="ethan.brooks@zerotrustx.dev", ip_address="185.220.101.47",
                             location="Unknown (Tor exit)", country_code=None, severity="medium",
                             details={"reason": "bad_password", "demo": True}, is_demo=True,
                             created_at=now - timedelta(hours=5, minutes=i)))
    for i in range(4):
        db.add(SecurityEvent(event_type="mfa_failure", user_id=U["olivia.martinez@zerotrustx.dev"].id,
                             ip_address="203.0.113.77", location="Lagos, NG", country_code="NG", severity="medium",
                             details={"method": "totp", "demo": True}, is_demo=True, created_at=now - timedelta(hours=26, minutes=i)))

    # ---------------------------------------------------------------- access decisions via the real engine
    engine = build_engine(db)

    def run_engine(u: User, r: ProtectedResource, dev: Device | None, ts, mfa: bool, source: str, assume=False, req_id=None):
        perms = u.permission_codes
        local_hour = ts.hour
        ctx = EvaluationContext(
            user={"id": str(u.id), "email": u.email, "status": u.status, "roles": u.role_names, "permissions": sorted(perms),
                  "risk_score": u.risk_score, "mfa_enabled": u.mfa_enabled, "department": u.department},
            session={"id": None, "valid": True, "mfa_verified": mfa, "age_minutes": rnd.randint(1, 300)},
            device={"id": str(dev.id), "name": dev.name, "trust_status": dev.trust_status, "risk_score": dev.risk_score} if dev else None,
            request={"ip": dev.ip_address if dev else "203.0.113.77", "hour": local_hour, "weekday": ts.weekday(),
                     "is_business_hours": 7 <= local_hour < 20 and ts.weekday() < 5, "timezone": "UTC"},
            resource=resource_dict(r),
            entitlement={"has_permission": bool(r.required_permission and r.required_permission in perms),
                         "has_active_grant": False, "assumed_for_request": assume},
        )
        res = engine.evaluate(ctx)
        d = AccessDecision(user_id=u.id, resource_id=r.id, device_id=dev.id if dev else None, decision=res.decision,
                           reasons=res.reasons, trace=res.trace, ip_address=ctx.request["ip"], source=source,
                           duration_ms=res.duration_ms, is_demo=True, evaluated_at=ts, access_request_id=req_id,
                           context={"user": {k: ctx.user[k] for k in ("email", "status", "roles", "risk_score", "mfa_enabled", "department")},
                                    "session": ctx.session, "device": ctx.device, "request": ctx.request,
                                    "resource": {k: ctx.resource[k] for k in ("slug", "name", "sensitivity", "type", "required_permission")},
                                    "entitlement": ctx.entitlement, "required_actions": res.required_actions})
        for m in res.matched_policies:
            d.matched_policies.append(AccessDecisionPolicy(policy_id=m["policy_id"], action=m["action"], was_deciding=m.get("deciding", False)))
        db.add(d)
        return d, res

    user_dev = {d.user_id: d for d in devices.values() if d.user_id}
    res_list = list(resources.values())
    for _ in range(170):
        owners = [u for u in active_users if u.id in user_dev]
        u = rnd.choice(owners) if rnd.random() < 0.75 else rnd.choice(active_users)
        entitled = [r for r in res_list if r.sensitivity == "public" or r.required_permission in u.permission_codes]
        r = rnd.choice(entitled) if rnd.random() < 0.8 else rnd.choice(res_list)
        dev = user_dev.get(u.id) if rnd.random() < 0.85 else None
        ts = now - timedelta(days=rnd.uniform(0, 30))
        run_engine(u, r, dev, ts, mfa=u.mfa_enabled and rnd.random() < 0.9, source="gateway")
    db.flush()

    # ---------------------------------------------------------------- access requests (20)
    req_specs = [
        ("employee@zerotrustx.dev", "Financial Records", "Need Q3 budget actuals to prepare engineering headcount forecast.", "pending", 8),
        ("lucas.silva@zerotrustx.dev", "Administrative Console", "Rotate expiring TLS certificates on the edge proxies during maintenance.", "rejected", 4),
        ("olivia.martinez@zerotrustx.dev", "Financial Records", "Month-end close reconciliation for October ledger entries.", "approved", 72),
        ("chloe.dubois@zerotrustx.dev", "Research Documents", "Continue drafting the protein-folding paper for submission.", "approved", 168),
        ("grace.okafor@zerotrustx.dev", "Research Documents", "Train baseline model on the internal benchmark dataset.", "pending", 48),
        ("mia.thompson@zerotrustx.dev", "Employee Database", "Process annual compensation review letters for the HR cycle.", "approved", 24),
        ("ava.johansson@zerotrustx.dev", "Employee Database", "Verify start dates for new hires joining next Monday.", "pending", 8),
        ("henry.walker@zerotrustx.dev", "Financial Records", "Check commission payouts for my Q3 closed deals please.", "rejected", 8),
        ("guest@zerotrustx.dev", "Internal Analytics Dashboard", "Contractor onboarding requires read access to usage metrics.", "pending", 24),
        ("jack.nguyen@zerotrustx.dev", "Research Documents", "Prototype UI for the research portal needs sample documents.", "expired", 24),
        ("daniel.kim@zerotrustx.dev", "Administrative Console", "Investigate failing health checks on production cluster nodes.", "approved", 4),
        ("isabella.rossi@zerotrustx.dev", "Financial Records", "Campaign ROI analysis requires marketing spend ledger data.", "revoked", 48),
        ("ryan.patel@zerotrustx.dev", "Employee Database", "Update on-call roster contact details for operations team.", "rejected", 8),
        ("ethan.brooks@zerotrustx.dev", "Employee Database", "Cross-check payroll headcount against HR records urgently.", "rejected", 8),
        ("lucas.silva@zerotrustx.dev", "Financial Records", "Cloud cost allocation report for platform team chargeback.", "pending", 24),
        ("grace.okafor@zerotrustx.dev", "Financial Records", "Grant budget reconciliation for the research program.", "expired", 24),
        ("marcus.chen@zerotrustx.dev" if False else "employee@zerotrustx.dev", "Research Documents", "Integrate research search API with the analytics dashboard.", "approved", 48),
        ("chloe.dubois@zerotrustx.dev", "Employee Database", "Look up collaborator contact for co-authorship paperwork.", "pending", 4),
        ("daniel.kim@zerotrustx.dev", "Financial Records", "Validate infrastructure spend before vendor renewal meeting.", "revoked", 24),
        ("henry.walker@zerotrustx.dev", "Research Documents", "Customer asked about upcoming product capabilities roadmap.", "pending", 8),
    ]
    reviewer = U["secadmin@zerotrustx.dev"]
    for i, (e, rn, just, status, hours) in enumerate(req_specs):
        u, r = U[e], resources[rn]
        created = now - timedelta(days=rnd.uniform(0.2, 12), hours=i)
        req = AccessRequest(requester_id=u.id, resource_id=r.id, justification=just, requested_duration_hours=hours,
                            status=status, created_at=created, is_demo=True)
        db.add(req)
        db.flush()
        dev = user_dev.get(u.id)
        d, res = run_engine(u, r, dev, created, mfa=u.mfa_enabled, source="access_request", assume=True, req_id=req.id)
        req.decision_id, req.engine_decision = d.id, res.decision
        if res.decision == "DENY":
            status = req.status = "rejected"
        if status != "pending":
            req.reviewed_at = created + timedelta(hours=rnd.randint(1, 20))
            req.reviewed_by_id = reviewer.id if status in ("approved", "rejected", "revoked") else None
        if status == "approved":
            req.expires_at = now + timedelta(hours=hours)
            req.review_comment = "Approved - business need verified with manager."
        elif status == "rejected":
            req.review_comment = ("Automatically rejected by the Zero Trust policy engine: " + "; ".join(res.reasons[:1])
                                  if res.decision == "DENY" else "Not aligned with role responsibilities; request via manager.")
        elif status == "expired":
            req.expires_at = created + timedelta(hours=hours)
            req.review_comment = "Grant expired"
        elif status == "revoked":
            req.revoked_at = created + timedelta(days=1)
            req.revoked_by_id = reviewer.id
            req.review_comment = "Revoked: access no longer required after project completion."
    db.flush()

    # ---------------------------------------------------------------- threat alerts (10) + incidents (3)
    alert_specs = [
        ("brute_force", "Repeated failed login attempts", "Credential Attack", "high", "ethan.brooks@zerotrustx.dev", None,
         "185.220.101.47", 70, "9 failed logins for ethan.brooks@zerotrustx.dev within 15 minutes.", 5, "investigating"),
        ("password_spray", "Password spraying from single IP", "Credential Attack", "critical", None, "Unknown-Kali-VM",
         "185.220.101.47", 92, "34 failed logins across 11 accounts from 185.220.101.47 within 15 minutes.", 6, "investigating"),
        ("mfa_failures", "Repeated MFA failures", "Credential Attack", "high", "olivia.martinez@zerotrustx.dev", None,
         "203.0.113.77", 70, "4 failed MFA verifications for olivia.martinez@zerotrustx.dev within 15 minutes after a correct password.", 26, "open"),
        ("untrusted_device_login", "Sign-in from untrusted or suspicious device", "Device Trust", "medium",
         "ethan.brooks@zerotrustx.dev", "EB-iPhone", "203.0.113.77", 45, "ethan.brooks@zerotrustx.dev signed in from device 'EB-iPhone' with trust status 'suspicious'.", 4, "open"),
        ("access_denials", "Multiple access denials", "Access Anomaly", "medium", "henry.walker@zerotrustx.dev", None,
         "10.20.7.41", 45, "5 access requests by henry.walker@zerotrustx.dev were denied within 30 minutes.", 30, "open"),
        ("unusual_login_time", "Login outside business hours", "Behavioural Anomaly", "low", "jack.nguyen@zerotrustx.dev", None,
         "10.20.3.9", 20, "jack.nguyen@zerotrustx.dev signed in at 03:00 (UTC), outside business hours 07:00-20:00.", 50, "resolved"),
        ("new_device", "Sign-in from unrecognised device", "Device Trust", "low", "henry.walker@zerotrustx.dev", "HW-Galaxy-S23",
         "10.20.11.6", 25, "henry.walker@zerotrustx.dev signed in from a new device 'HW-Galaxy-S23' that is pending verification.", 70, "open"),
        ("ip_change", "Unexpected IP address change", "Behavioural Anomaly", "low", "isabella.rossi@zerotrustx.dev", None,
         "198.51.100.23", 20, "isabella.rossi@zerotrustx.dev signed in from 198.51.100.23; previous sign-in was from 10.20.5.17.", 100, "dismissed"),
        ("session_ip_change", "Session token used from a different IP", "Session Anomaly", "medium", "ethan.brooks@zerotrustx.dev",
         None, "203.0.113.77", 55, "Session for ethan.brooks@zerotrustx.dev was refreshed from 203.0.113.77 but started from 10.20.8.14.", 3, "open"),
        ("abnormal_access_frequency", "Abnormal access frequency", "Access Anomaly", "medium", "jack.nguyen@zerotrustx.dev", None,
         "10.20.3.9", 50, "jack.nguyen@zerotrustx.dev made 42 resource access evaluations within 10 minutes.", 140, "resolved"),
    ]
    from app.services.threats import RULES

    alerts = []
    for key, title, cat, sev, e, dn, ip, rs, desc, hours_ago, st in alert_specs:
        a = ThreatAlert(rule_key=key, title=title, category=cat, severity=sev, user_id=U[e].id if e else None,
                        device_id=devices[dn].id if dn else None, ip_address=ip, risk_score=rs, description=desc,
                        recommended_action=RULES[key]["action"], status=st, evidence={"occurrences": 1, "demo": True},
                        detected_at=now - timedelta(hours=hours_ago), created_at=now - timedelta(hours=hours_ago), is_demo=True)
        db.add(a)
        alerts.append(a)
    db.flush()

    inc_specs = [
        ("INC-0001", "Credential stuffing campaign from Tor exit node", "critical", "investigating", "analyst@zerotrustx.dev",
         [0, 1], ["Correlated 34 failures across 11 accounts from 185.220.101.47 (Tor exit).",
                  "Blocked device 'Unknown-Kali-VM'. Requested perimeter block of the source IP.",
                  "Ethan Brooks' account locked; awaiting user confirmation of identity."], None),
        ("INC-0002", "Possible MFA fatigue / credential compromise - Finance", "high", "contained", "secadmin@zerotrustx.dev",
         [2], ["User confirmed they did not initiate the sign-in attempts from Lagos.",
               "Password reset forced and all sessions revoked."], None),
        ("INC-0003", "Off-hours bulk access by engineering account", "medium", "resolved", "hannah.becker@zerotrustx.dev",
         [5, 9], ["Spike traced to a misconfigured integration test script using Jack's session."],
         "Integration test used a personal session token. Script moved to a service account; user coached."),
    ]
    for ref, title, sev, st, assignee, idxs, notes, resolution in inc_specs:
        created = now - timedelta(hours=max(alert_specs[i][9] for i in idxs) - 1)
        inc = Incident(reference=ref, title=title, severity=sev, status=st, assignee_id=U[assignee].id,
                       created_by_id=U["secadmin@zerotrustx.dev"].id, description=f"Opened from {len(idxs)} correlated alert(s).",
                       created_at=created, is_demo=True, resolution_summary=resolution,
                       resolved_at=created + timedelta(hours=20) if st == "resolved" else None)
        db.add(inc)
        db.flush()
        for i in idxs:
            alerts[i].incident_id = inc.id
        db.add(IncidentNote(incident_id=inc.id, author_id=U["secadmin@zerotrustx.dev"].id, note_type="status_change",
                            body="Incident opened", created_at=created))
        for j, body in enumerate(notes):
            db.add(IncidentNote(incident_id=inc.id, author_id=U[assignee].id, body=body, note_type="note",
                                created_at=created + timedelta(hours=j + 1)))

    # ---------------------------------------------------------------- notifications
    for e in ("admin@zerotrustx.dev", "secadmin@zerotrustx.dev", "analyst@zerotrustx.dev"):
        db.add(Notification(user_id=U[e].id, title="Critical alert: Password spraying from single IP",
                            body=alert_specs[1][8], category="threat", severity="critical", link="/threats",
                            created_at=now - timedelta(hours=6)))
        db.add(Notification(user_id=U[e].id, title="Access request awaiting review: Financial Records",
                            body="Marcus Chen requested confidential access.", category="access", severity="low",
                            link="/access-requests", created_at=now - timedelta(hours=2)))
    db.add(Notification(user_id=U["employee@zerotrustx.dev"].id, title="Access approved: Research Documents",
                        body="Approved by Jordan Lee for 48h.", category="access", link="/access-requests",
                        created_at=now - timedelta(hours=3)))

    # ---------------------------------------------------------------- audit trail (chronological)
    audit_specs = []
    def A(hours_ago, action, cat, actor, sev="informational", outcome="success", ttype=None, label=None, details=None):
        audit_specs.append((now - timedelta(hours=hours_ago), action, cat, actor, sev, outcome, ttype, label, details or {}))

    A(700, "settings.updated", "system", "admin@zerotrustx.dev", "high", details={"changed": {"risk_block_threshold": [90, 80]}})
    A(690, "policy.created", "policy", "admin@zerotrustx.dev", "medium", ttype="policy", label=pol_specs[0][1])
    A(689, "policy.created", "policy", "admin@zerotrustx.dev", "medium", ttype="policy", label=pol_specs[2][1])
    A(600, "user.created", "user_management", "secadmin@zerotrustx.dev", ttype="user", label="guest@zerotrustx.dev", details={"roles": ["guest"]})
    A(560, "user.roles_changed", "user_management", "admin@zerotrustx.dev", "medium", ttype="user", label="mfa@zerotrustx.dev",
      details={"before": ["employee"], "after": ["security_admin"]})
    A(480, "device.trust_changed", "device", "secadmin@zerotrustx.dev", ttype="device", label="MC-Dev-Laptop",
      details={"from": "pending_verification", "to": "trusted"})
    A(470, "device.trust_changed", "device", "secadmin@zerotrustx.dev", "medium", ttype="device", label="SR-Personal-Laptop",
      details={"from": "pending_verification", "to": "untrusted"})
    A(400, "mfa.enabled", "mfa", "olivia.martinez@zerotrustx.dev", "low")
    A(300, "policy.updated", "policy", "secadmin@zerotrustx.dev", "medium", ttype="policy", label=pol_specs[4][1],
      details={"version": 2})
    A(240, "access_request.approved", "access", "secadmin@zerotrustx.dev", ttype="access_request", label="Employee Database",
      details={"requester": "mia.thompson@zerotrustx.dev", "hours": 24})
    A(160, "auth.login", "authentication", "jack.nguyen@zerotrustx.dev")
    A(140, "threat.detected", "threat", "system", "medium", ttype="threat_alert", label="Abnormal access frequency")
    A(120, "user.suspended", "user_management", "secadmin@zerotrustx.dev", "medium", ttype="user", label="leo.fischer@zerotrustx.dev",
      details={"reason": "Pending HR investigation"})
    A(100, "threat.status_changed", "threat", "analyst@zerotrustx.dev", ttype="threat_alert", label="Unexpected IP address change",
      details={"from": "open", "to": "dismissed", "note": "Employee travelling, confirmed by manager"})
    A(96, "user.deactivated", "user_management", "admin@zerotrustx.dev", "medium", ttype="user", label="zoe.adams@zerotrustx.dev",
      details={"reason": "Offboarded"})
    A(72, "auth.login_failed", "authentication", "henry.walker@zerotrustx.dev", "low", "failure")
    A(70, "device.registered", "device", "henry.walker@zerotrustx.dev", ttype="device", label="HW-Galaxy-S23")
    A(48, "session.terminated", "session", "secadmin@zerotrustx.dev", "medium", ttype="session", label="henry.walker@zerotrustx.dev")
    A(30, "access.decision", "access", "henry.walker@zerotrustx.dev", "medium", "failure", "resource", "Financial Records",
      details={"decision": "DENY"})
    A(26, "auth.mfa_failed", "mfa", "olivia.martinez@zerotrustx.dev", "medium", "failure")
    A(25, "threat.detected", "threat", "system", "high", ttype="threat_alert", label="Repeated MFA failures")
    A(24, "user.access_reset", "user_management", "secadmin@zerotrustx.dev", "high", ttype="user", label="olivia.martinez@zerotrustx.dev",
      details={"sessions_revoked": 2, "password_reset_issued": True})
    A(20, "incident.updated", "incident", "secadmin@zerotrustx.dev", ttype="incident", label="INC-0002",
      details={"status": ["investigating", "contained"]})
    A(8, "auth.account_locked", "authentication", "ethan.brooks@zerotrustx.dev", "high", "failure", details={"failed_attempts": 9})
    A(6, "threat.detected", "threat", "system", "critical", ttype="threat_alert", label="Password spraying from single IP")
    A(6, "device.trust_changed", "device", "secadmin@zerotrustx.dev", "high", ttype="device", label="Unknown-Kali-VM",
      details={"from": "suspicious", "to": "blocked"})
    A(5, "incident.created", "incident", "secadmin@zerotrustx.dev", "critical", ttype="incident", label="INC-0001")
    A(4, "access_request.submitted", "access", "employee@zerotrustx.dev", ttype="access_request", label="Financial Records")
    A(3, "auth.login", "authentication", "admin@zerotrustx.dev")
    A(2, "policy.simulated", "policy", "analyst@zerotrustx.dev", ttype="resource", label="Employee Database", details={"decision": "REQUIRE_MFA"})
    A(1, "audit.exported", "audit", "analyst@zerotrustx.dev", "low", details={"rows": 250})
    A(0.5, "auth.login", "authentication", "secadmin@zerotrustx.dev")
    for ts, action, cat, actor, sev, outcome, ttype, label, details in sorted(audit_specs, key=lambda x: x[0]):
        u = U.get(actor)
        audit.record(db, action, cat, actor=u, actor_email=actor if not u else None, severity=sev, outcome=outcome,
                     target_type=ttype, target_label=label, details={**details, "demo": True}, is_demo=True,
                     created_at=ts, ip="10.20.1.10")
    db.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ZeroTrustX")
    parser.add_argument("--no-demo", action="store_true", help="Only bootstrap roles, permissions and settings")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        bootstrap(db)
        db.commit()
        print("✓ RBAC catalogue and organisation settings bootstrapped")
        if args.no_demo:
            return
        if settings.APP_ENV == "production":
            raise SystemExit("Refusing to load demo data with APP_ENV=production")
        if db.execute(select(User.id).where(User.is_demo.is_(True)).limit(1)).first():
            print("• Demo data already present - skipping (run `alembic downgrade base && alembic upgrade head` to reset)")
            return
        seed_demo(db)
        db.commit()
        print("✓ Demo data loaded (all records flagged is_demo=true)")
        for email, _, pw, role, *_ in DEMO_ACCOUNTS:
            print(f"   {role:<15} {email:<28} {pw}")
        print(f"   (other demo users)          *@zerotrustx.dev      {OTHER_PASSWORD}")
        print(f"   TOTP secret for mfa@zerotrustx.dev: {DEMO_TOTP_SECRET}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
