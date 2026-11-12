from dataclasses import dataclass

from fastapi import Request


@dataclass
class ClientInfo:
    ip: str | None
    user_agent: str | None
    device_identifier: str | None
    device_name: str | None


def client_info(request: Request) -> ClientInfo:
    ip = request.client.host if request.client else None
    # Only honour X-Forwarded-For when explicitly behind a trusted proxy.
    if request.app.state.trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            ip = fwd.split(",")[0].strip()
    dev = request.headers.get("x-device-id")
    if dev and (len(dev) > 128 or not all(ch.isalnum() or ch in "-_" for ch in dev)):
        dev = None
    name = (request.headers.get("x-device-name") or "")[:150] or None
    return ClientInfo(ip=ip, user_agent=(request.headers.get("user-agent") or "")[:512] or None, device_identifier=dev, device_name=name)
