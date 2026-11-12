from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.schemas.common import PageParams


def paginate(db: Session, query, params: PageParams, sortable: dict[str, Any], default_sort: str, mapper=None) -> dict:
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    col = sortable.get(params.sort or default_sort, sortable[default_sort])
    query = query.order_by(col.desc() if params.order == "desc" else col.asc())
    rows = db.execute(query.offset(params.offset).limit(params.page_size)).unique().scalars().all()
    return {
        "items": [mapper(r) for r in rows] if mapper else rows,
        "total": total or 0,
        "page": params.page,
        "page_size": params.page_size,
    }


def not_found(what: str = "Resource") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found", "message": f"{what} not found"})


def bad_request(message: str, code: str = "bad_request") -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": code, "message": message})


def conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail={"code": "conflict", "message": message})


def forbidden(message: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "message": message})


def severity_rank(col):
    """Sort expression ordering severities by rank instead of alphabetically."""
    return case({"informational": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}, value=col, else_=0)
