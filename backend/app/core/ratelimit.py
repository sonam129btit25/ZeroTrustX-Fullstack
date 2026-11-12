"""Simple in-process sliding-window rate limiter (per process; use Redis for multi-instance deployments)."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.config import settings


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return False, window - (now - q[0])
            q.append(now)
            return True, 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def rate_limit(bucket: str, limit: int | None = None, window: float = 60.0):
    def dep(request: Request) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return
        ip = request.client.host if request.client else "unknown"
        ok, retry = limiter.hit(f"{bucket}:{ip}", limit or settings.LOGIN_RATE_LIMIT_PER_MINUTE, window)
        if not ok:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many requests. Please slow down."},
                headers={"Retry-After": str(int(retry) + 1)},
            )

    return dep
