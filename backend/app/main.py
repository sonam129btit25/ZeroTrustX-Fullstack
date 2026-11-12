"""ZeroTrustX API application factory."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.routes import (
    access_requests,
    assistant,
    audit,
    auth,
    dashboard,
    devices,
    mfa,
    misc,
    policies,
    resources,
    sessions,
    threats,
    users,
)
from app.core.config import settings
from app.db.session import SessionLocal
from app.ws import routes as ws_routes
from app.ws.manager import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("zerotrustx")


def run_sweeps() -> None:
    from app.api.routes.access_requests import expire_requests
    from app.services.sessions import expire_stale_sessions

    db = SessionLocal()
    try:
        expire_stale_sessions(db)
        expire_requests(db)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("Background sweep failed")
    finally:
        db.close()


async def sweeper() -> None:
    while True:
        await asyncio.sleep(60)
        await run_in_threadpool(run_sweeps)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_production_safe()
    manager.loop = asyncio.get_running_loop()
    task = asyncio.create_task(sweeper()) if settings.APP_ENV != "test" else None
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ZeroTrustX API",
        description="Never Trust. Always Verify. - Zero Trust Network Access & Identity Security Platform API.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.state.trust_proxy = False
    app.state.allowed_origins = set(settings.cors_origin_list)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Id", "X-Device-Name"],
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith(settings.API_PREFIX):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
        msg = errors[0]["message"].removeprefix("Value error, ") if errors else "Invalid request"
        return JSONResponse(status_code=422, content={"detail": {"code": "validation_error", "message": msg, "errors": errors}})

    for r in (auth, mfa, users, devices, sessions, policies, resources, access_requests, threats, audit, dashboard, misc, assistant):
        app.include_router(r.router, prefix=settings.API_PREFIX)
    app.include_router(ws_routes.router)

    @app.get("/api/health", tags=["Platform"])
    def health() -> dict:
        from sqlalchemy import text

        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "ok"}
        finally:
            db.close()

    return app


app = create_app()
