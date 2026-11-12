"""Test fixtures. Tests run against a real PostgreSQL database (TEST_DATABASE_URL)."""
import os
import uuid

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://zerotrustx:zerotrustx_dev@localhost:5432/zerotrustx_test"
)
os.environ["APP_ENV"] = "test"

import pyotp  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.bootstrap import bootstrap  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Device, ProtectedResource, Role, User  # noqa: E402

PASSWORD = "Str0ng!Passw0rd"


@pytest.fixture(scope="session", autouse=True)
def database():
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    db = SessionLocal()
    bootstrap(db)
    db.commit()
    db.close()
    yield


@pytest.fixture(autouse=True)
def _reset_limits():
    limiter.reset()
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def uniq(prefix="user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@test.dev"


@pytest.fixture
def make_user(db):
    def _make(role="employee", password=PASSWORD, status="active", risk=0, email=None, mfa_secret=None):
        r = db.execute(select(Role).where(Role.name == role)).scalar_one()
        u = User(email=email or uniq(role), full_name=f"Test {role.title()}", password_hash=hash_password(password),
                 roles=[r], status=status, risk_score=risk)
        db.add(u)
        db.flush()
        if mfa_secret:
            from app.core.security import encrypt_secret
            from app.models import MFAConfig

            db.add(MFAConfig(user_id=u.id, secret_encrypted=encrypt_secret(mfa_secret), is_enabled=True))
            u.mfa_enabled = True
        db.commit()
        return u

    return _make


def device_headers(dev_id: str | None = None) -> dict:
    return {"X-Device-Id": dev_id or f"dev-{uuid.uuid4().hex[:16]}"}


@pytest.fixture
def login(client):
    def _login(user: User, password=PASSWORD, device_id: str | None = None) -> dict:
        h = device_headers(device_id)
        r = client.post("/api/v1/auth/login", json={"email": user.email, "password": password}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body["mfa_required"], body
        return {"Authorization": f"Bearer {body['auth']['access_token']}", **h}

    return _login


@pytest.fixture
def make_resource(db):
    def _make(sensitivity="internal", permission="resource:analytics:access", requires_approval=True, **kw):
        name = f"Res {uuid.uuid4().hex[:8]}"
        r = ProtectedResource(name=name, slug=name.lower().replace(" ", "-"), sensitivity=sensitivity,
                              required_permission=permission, requires_approval=requires_approval, **kw)
        db.add(r)
        db.commit()
        return r

    return _make


def trust_device(db, identifier: str, status="trusted") -> Device:
    d = db.execute(select(Device).where(Device.device_identifier == identifier)).scalar_one()
    d.trust_status = status
    db.commit()
    return d


def totp_now(secret: str) -> str:
    return pyotp.TOTP(secret).now()
