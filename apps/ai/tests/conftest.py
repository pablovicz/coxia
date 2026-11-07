import os
from pathlib import Path

import pytest

# Fixtures compartilhadas do monorepo (no container: /fixtures).
REPO_FIXTURES = Path(
    os.environ.get("COXIA_FIXTURES_DIR", Path(__file__).resolve().parents[3] / "tests" / "fixtures")
)
SCHEMAS_DIR = Path(
    os.environ.get(
        "COXIA_SCHEMAS_DIR", Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"
    )
)

TOKEN = "test-ai-service-token-000"


@pytest.fixture
def fixtures_dir() -> Path:
    return REPO_FIXTURES


@pytest.fixture
def client(fixtures_dir: Path):
    from fastapi.testclient import TestClient

    from coxia_ai.main import create_app
    from coxia_ai.settings import Settings

    settings = Settings(ai_service_token=TOKEN, ai_provider="fixture", fixtures_dir=fixtures_dir)
    return TestClient(create_app(settings))


@pytest.fixture
def auth() -> dict[str, str]:
    return {"authorization": f"Bearer {TOKEN}"}
