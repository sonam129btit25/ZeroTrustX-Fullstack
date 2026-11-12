from sqlalchemy.orm import Session

from app.models import OrganizationSettings

DEFAULT_RISK_WEIGHTS = {
    "failed_login": 4,  # per failed login in the last 24h (capped)
    "failed_login_cap": 30,
    "access_denied": 3,  # per denial in last 24h (capped)
    "access_denied_cap": 20,
    "untrusted_device": 15,  # last login from non-trusted device
    "no_mfa": 10,  # MFA not enrolled
    "open_alert_high": 20,  # per open high/critical alert
    "open_alert_medium": 8,
    "off_hours_login": 5,
    "new_ip": 5,
}

DEFAULT_NOTIFICATIONS = {
    "notify_admins_on_high_alerts": True,
    "notify_user_on_request_decision": True,
    "notify_user_on_new_device": True,
    "notify_admins_on_pending_requests": True,
}


def get_org(db: Session) -> OrganizationSettings:
    org = db.get(OrganizationSettings, 1)
    if org is None:
        org = OrganizationSettings(
            id=1,
            risk_weights=dict(DEFAULT_RISK_WEIGHTS),
            notification_settings=dict(DEFAULT_NOTIFICATIONS),
            mfa_required_roles=["super_admin", "security_admin"],
        )
        db.add(org)
        db.flush()
    return org


def risk_weights(org: OrganizationSettings) -> dict[str, int]:
    return {**DEFAULT_RISK_WEIGHTS, **(org.risk_weights or {})}
