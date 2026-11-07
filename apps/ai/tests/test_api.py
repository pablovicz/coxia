from coxia_ai.contracts import (
    AiErrorResponse,
    ExtractBriefingResponse,
    ExtractProjectEventsResponse,
    InterpretCommandResponse,
    TranscribeResponse,
)

EVENTS_REQUEST = {
    "organizationId": "org_1",
    "projectId": "prj_1",
    "projectTitle": "XPO",
    "timezone": "America/Sao_Paulo",
    "now": "2026-11-06T10:00:00-03:00",
    "projectStateSummary": None,
    "messages": [
        {
            "id": "golden-xpo-01",
            "authorPhone": "5511966665555",
            "authorName": "Bruno",
            "sentAt": "2026-11-06T09:40:00-03:00",
            "text": "Eu fecho o cartaz até quarta. Orçamento do som chegou: 2.500, ainda não aprovado.",
            "attachmentKind": None,
        }
    ],
}


def test_health_is_public(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "ai", "provider": "fixture"}


def test_requires_bearer_token(client):
    res = client.post("/v1/projects/events", json=EVENTS_REQUEST)
    assert res.status_code == 401
    body = AiErrorResponse.model_validate(res.json())
    assert body.error.code == "unauthorized"
    assert (
        client.post(
            "/v1/projects/events", json=EVENTS_REQUEST, headers={"authorization": "Bearer x"}
        ).status_code
        == 401
    )


def test_invalid_request_uses_error_contract(client, auth):
    res = client.post("/v1/projects/events", json={**EVENTS_REQUEST, "messages": []}, headers=auth)
    assert res.status_code == 422
    body = AiErrorResponse.model_validate(res.json())
    assert body.error.retryable is False


def test_golden_events_fixture(client, auth):
    """Fixture determinística: tarefa assumida e cotação (não pagamento)."""
    res = client.post("/v1/projects/events", json=EVENTS_REQUEST, headers=auth)
    assert res.status_code == 200
    out = ExtractProjectEventsResponse.model_validate(res.json())
    by_type = {e.type: e for e in out.events}
    assert by_type["task"].commitment == "committed"
    assert by_type["task"].dueDate == "2026-11-11"
    assert by_type["quote"].amountCents == 250000
    assert "expense" not in by_type and "payment_proof" not in by_type
    assert out.meta.promptVersion.startswith("project-events@")
    assert out.meta.parserVersion == "1"


def test_unknown_fixture_returns_safe_empty_result(client, auth):
    req = {**EVENTS_REQUEST, "messages": [{**EVENTS_REQUEST["messages"][0], "id": "sem-fixture"}]}
    out = ExtractProjectEventsResponse.model_validate(
        client.post("/v1/projects/events", json=req, headers=auth).json()
    )
    assert out.events == []


def test_ambiguous_command_asks_for_clarification(client, auth):
    req = {
        "organizationId": "org_1",
        "timezone": "America/Sao_Paulo",
        "now": "2026-11-06T10:00:00-03:00",
        "text": "Cancela a reserva das 15h de amanhã",
        "knownSpaces": [
            {"id": "s1", "name": "Sala Grande", "aliases": ["grande"]},
            {"id": "s3", "name": "Sala Pequena", "aliases": ["pequena"]},
        ],
        "knownBills": [],
    }
    res = client.post("/v1/commands/interpret", json=req, headers=auth)
    assert res.status_code == 200
    out = InterpretCommandResponse.model_validate(res.json())
    assert out.command.intent == "booking.cancel"
    assert out.clarificationQuestion


def test_idempotency_key_returns_same_execution(client, auth):
    req = {
        "mediaUrl": "https://bucket.test/a.ogg",
        "mimeType": "audio/ogg",
        "language": "pt",
        "sourceMessageId": "x",
    }
    headers = {**auth, "idempotency-key": "same-key"}
    a = TranscribeResponse.model_validate(client.post("/v1/transcribe", json=req, headers=headers).json())
    b = TranscribeResponse.model_validate(client.post("/v1/transcribe", json=req, headers=headers).json())
    assert a.meta.executionId == b.meta.executionId


def test_events_fixture_by_text_points_to_last_message(client, auth):
    """Fixture por texto (smoke no Docker): o id interno da mensagem não é conhecido de antemão."""
    req = {
        **EVENTS_REQUEST,
        "messages": [
            {**EVENTS_REQUEST["messages"][0], "id": "msg-anterior", "text": "Bom dia, gente"},
            {
                **EVENTS_REQUEST["messages"][0],
                "id": "cuid-interno-123",
                "text": "Eu fecho o  cartaz até quarta",
            },
        ],
    }
    out = ExtractProjectEventsResponse.model_validate(
        client.post("/v1/projects/events", json=req, headers=auth).json()
    )
    assert [(e.type, e.sourceMessageId) for e in out.events] == [("task", "cuid-interno-123")]
    assert out.meta.promptVersion == "project-events@2026-11-07"


def test_task_done_event_from_fixture(client, auth):
    req = {
        **EVENTS_REQUEST,
        "projectStateSummary": "Projeto: XPO\nTarefas em aberto:\n- Fazer o cartaz (Bruno, qua, 11/11)",
        "messages": [
            {**EVENTS_REQUEST["messages"][0], "id": "m9", "text": "Cartaz pronto e enviado pra gráfica!"}
        ],
    }
    out = ExtractProjectEventsResponse.model_validate(
        client.post("/v1/projects/events", json=req, headers=auth).json()
    )
    assert out.events[0].type == "task_done"
    assert out.events[0].taskTitle == "Fazer o cartaz"  # type: ignore[union-attr]


def test_briefing_fixture_by_transcript(client, auth):
    transcript = (
        "Mostra de fim de ano dos alunos de dança no dia 12 de dezembro. "
        "O Bruno cuida do cartaz até dia 11 de novembro, a Ana fecha o som. "
        "Orçamento de oito mil reais. Falta definir se vai ter venda de ingresso."
    )
    req = {
        "organizationId": "org_1",
        "projectId": "prj_1",
        "timezone": "America/Sao_Paulo",
        "now": "2026-11-07T10:00:00-03:00",
        "transcript": transcript,
        "sourceMessageId": "id-desconhecido",
    }
    out = ExtractBriefingResponse.model_validate(
        client.post("/v1/projects/briefing", json=req, headers=auth).json()
    )
    assert out.briefing.estimatedBudgetCents == 800000
    assert [t.title for t in out.briefing.proposedTasks] == ["Fazer o cartaz", "Fechar o som"]
    assert out.meta.model == "fixture"
