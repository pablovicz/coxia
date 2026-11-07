from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_fixtures_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "tests" / "fixtures"
        if (candidate / "ai").is_dir():
            return candidate
    return Path("/fixtures")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    ai_service_token: str = Field(min_length=16)
    # "fixture": respostas determinísticas para dev/CI; "openai": chamadas reais.
    ai_provider: Literal["fixture", "openai"] = "fixture"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    openai_transcribe_model: str = "gpt-4o-mini-transcribe"
    openai_timeout_seconds: float = 45.0
    # FIXTURES_DIR no container (/fixtures); no monorepo, <raiz>/tests/fixtures.
    fixtures_dir: Path = Field(default_factory=lambda: _default_fixtures_dir())
    log_level: str = "info"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
