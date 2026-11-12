import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.core.deps import authenticate_token
from app.db.session import SessionLocal
from app.ws.manager import Client, manager

log = logging.getLogger("zerotrustx.ws")
router = APIRouter()


def _auth(token: str):
    db = SessionLocal()
    try:
        user, s = authenticate_token(db, token)
        return str(user.id), str(s.id), set(user.permission_codes)
    finally:
        db.close()


def _still_valid(session_id: str) -> bool:
    import uuid

    from app.db.base import utcnow
    from app.models import UserSession

    db = SessionLocal()
    try:
        s = db.get(UserSession, uuid.UUID(session_id))
        return bool(s and s.revoked_at is None and s.expires_at > utcnow() and s.user.status == "active")
    finally:
        db.close()


@router.websocket("/api/v1/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """Authenticated real-time channel. The first frame must be {"type":"auth","token":"<access token>"}.

    Tokens are deliberately not accepted in the URL to keep them out of proxy/access logs.
    """
    origin = ws.headers.get("origin")
    if origin and origin not in ws.app.state.allowed_origins:
        await ws.close(code=4003)
        return
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        msg = json.loads(raw)
        if msg.get("type") != "auth" or not isinstance(msg.get("token"), str):
            raise ValueError("auth frame required")
        uid, sid, perms = await run_in_threadpool(_auth, msg["token"])
    except (asyncio.TimeoutError, ValueError, json.JSONDecodeError, HTTPException, WebSocketDisconnect):
        try:
            await ws.send_text(json.dumps({"type": "error", "data": {"code": "unauthorized"}}))
            await ws.close(code=4001)
        except Exception:  # noqa: BLE001
            pass
        return
    client = Client(ws=ws, user_id=uid, session_id=sid, permissions=perms)
    manager.add(client)
    await ws.send_text(json.dumps({"type": "ready", "data": {"user_id": uid}}))
    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=60)
            except asyncio.TimeoutError:
                if not await run_in_threadpool(_still_valid, sid):
                    await ws.send_text(json.dumps({"type": "session.revoked", "data": {"reason": "expired"}}))
                    await ws.close(code=4001)
                    break
                continue
            try:
                m = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if m.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(client)
