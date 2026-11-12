from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class Message(BaseModel):
    message: str


class PageParams:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        sort: str | None = Query(None, max_length=40),
        order: str = Query("desc", pattern="^(asc|desc)$"),
        q: str | None = Query(None, max_length=200),
    ):
        self.page, self.page_size, self.sort, self.order, self.q = page, page_size, sort, order, q

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size
