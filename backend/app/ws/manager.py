"""Authenticated WebSocket connection manager and a commit-aware event bus.

Events are queued on the SQLAlchemy session (``queue_event``) and only broadcast after the
transaction commits, so clients never receive notifications about rolled-back changes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger("zerotrustx.ws")


@dataclass(eq=False)
class Client:
    ws: WebSocket
    user_id: str
    session_id: str
    permissions: set[str] = field(default_factory=set)


class ConnectionManager:
    def __init__(self) -> None:
        self.clients: set[Client] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    @property
    def count(self) -> int:
        return len(self.clients)

    def add(self, c: Client) -> None:
        self.clients.add(c)

    def remove(self, c: Client) -> None:
        self.clients.discard(c)

    def _audience_ok(self, c: Client, audience: dict[str, Any]) -> bool:
        users = audience.get("users")
        perm = audience.get("permission")
        if users and c.user_id in users:
            return True
        if perm and perm in c.permissions:
            return True
        return not users and not perm and audience.get("all", False)

    async def _send(self, message: dict[str, Any], audience: dict[str, Any]) -> None:
        data = json.dumps(message, default=str)
        dead = []
        for c in list(self.clients):
            if self._audience_ok(c, audience):
                try:
                    await c.ws.send_text(data)
                except Exception:  # noqa: BLE001
                    dead.append(c)
        for c in dead:
            self.remove(c)

    async def close_session(self, session_id: str, reason: str) -> None:
        for c in list(self.clients):
            if c.session_id == session_id:
                try:
                    await c.ws.send_text(json.dumps({"type": "session.revoked", "data": {"reason": reason}}))
                    await c.ws.close(code=4001)
                except Exception:  # noqa: BLE001
                    pass
                self.remove(c)

    def dispatch(self, message: dict[str, Any], audience: dict[str, Any]) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(self._send(message, audience))
        else:
            asyncio.run_coroutine_threadsafe(self._send(message, audience), loop)

    def dispatch_session_close(self, session_id: str, reason: str) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self.close_session(session_id, reason), loop)


manager = ConnectionManager()

# Audiences
ADMINS = {"permission": "sessions:read_all"}
SECURITY = {"permission": "threats:read"}


def queue_event(db: Session, event_type: str, data: dict[str, Any], audience: dict[str, Any]) -> None:
    db.info.setdefault("ws_events", []).append(
        (
            {
                "type": event_type,
                "id": uuid.uuid4().hex,
                "ts": datetime.now(timezone.utc).isoformat(),
                "data": data,
            },
            audience,
        )
    )


def queue_session_close(db: Session, session_id: uuid.UUID, reason: str) -> None:
    db.info.setdefault("ws_close", []).append((str(session_id), reason))


@event.listens_for(Session, "after_commit")
def _flush_events(session: Session) -> None:
    events = session.info.pop("ws_events", [])
    closes = session.info.pop("ws_close", [])
    for msg, aud in events:
        manager.dispatch(msg, aud)
    for sid, reason in closes:
        manager.dispatch_session_close(sid, reason)


@event.listens_for(Session, "after_rollback")
def _drop_events(session: Session) -> None:
    session.info.pop("ws_events", None)
    session.info.pop("ws_close", None)
