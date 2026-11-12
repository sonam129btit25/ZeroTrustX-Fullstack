"""Application configuration loaded from environment variables."""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "ZeroTrustX"
    APP_ENV: Literal["development", "test", "production"] = "development"
    API_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+psycopg://zerotrustx:zerotrustx_dev@localhost:5432/zerotrustx"

    # Secrets: MUST be overridden in production. Defaults only work outside production.
    JWT_SECRET_KEY: str = Field(default="dev-insecure-jwt-secret-change-me-0123456789abcdef")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    MFA_PENDING_TOKEN_EXPIRE_MINUTES: int = 5
    # Fernet key (urlsafe base64, 32 bytes) used to encrypt TOTP secrets at rest.
    MFA_ENCRYPTION_KEY: str = "ZGV2LWluc2VjdXJlLW1mYS1rZXktY2hhbmdlLW1lISE="

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "strict"

    RATE_LIMIT_ENABLED: bool = True
    LOGIN_RATE_LIMIT_PER_MINUTE: int = 10

    # Development helper: return password-reset URLs in API responses (never enable in production).
    EXPOSE_DEV_RESET_TOKENS: bool = False
    FRONTEND_URL: str = "http://localhost:5173"

    # Optional AI integration for the Security Assistant (not required; local rules engine is default).
    ASSISTANT_PROVIDER: Literal["local"] = "local"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def _secret_len(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters")
        return v

    def assert_production_safe(self) -> None:
        if self.APP_ENV == "production":
            if "dev-insecure" in self.JWT_SECRET_KEY or self.MFA_ENCRYPTION_KEY.startswith("ZGV2LWluc2VjdXJl"):
                raise RuntimeError("Refusing to start: default development secrets used in production")
            if self.EXPOSE_DEV_RESET_TOKENS:
                raise RuntimeError("EXPOSE_DEV_RESET_TOKENS must be false in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
