import json

import pytest
from starlette.websockets import WebSocketDisconnect

API = "/api/v1"


def test_ws_rejects_unauthenticated(client):
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": "garbage"}))
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "error"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()


def test_ws_delivers_realtime_events(client, make_user, login):
    admin = make_user("security_admin")
    h = login(admin)
    token = h["Authorization"].split()[1]
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": token}))
        assert json.loads(ws.receive_text())["type"] == "ready"
        victim = make_user()
        login(victim)  # creates session -> session.created broadcast to admins
        types = set()
        for _ in range(10):
            types.add(json.loads(ws.receive_text())["type"])
            if "session.created" in types:
                break
        assert "session.created" in types


def test_ws_non_admin_does_not_receive_admin_events(client, make_user, login):
    emp = make_user()
    h = login(emp)
    token = h["Authorization"].split()[1]
    with client.websocket_connect("/api/v1/ws") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": token}))
        assert json.loads(ws.receive_text())["type"] == "ready"
        login(make_user())
        ws.send_text(json.dumps({"type": "ping"}))
        # The next message must be our pong, not someone else's session event
        assert json.loads(ws.receive_text())["type"] == "pong"
