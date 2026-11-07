"""Golden de contrato: os mesmos exemplos validados pelo zod (packages/contracts) devem ter
o mesmo resultado aqui, e os modelos Pydantic devem exigir os mesmos campos que os JSON Schemas
exportados do zod."""

import json

import pytest
from pydantic import ValidationError

from coxia_ai.contracts import CONTRACTS

from .conftest import REPO_FIXTURES, SCHEMAS_DIR

CONTRACT_FILES = sorted((REPO_FIXTURES / "contracts").glob("*.json"))


def _cases():
    for path in CONTRACT_FILES:
        data = json.loads(path.read_text(encoding="utf-8"))
        for i, example in enumerate(data["valid"]):
            yield pytest.param(path.stem, example, True, id=f"{path.stem}-valid-{i}")
        for example in data["invalid"]:
            why = example.pop("_why")
            yield pytest.param(path.stem, example, False, id=f"{path.stem}-invalid-{why}")


def test_every_fixture_has_a_model():
    assert CONTRACT_FILES, "nenhuma fixture de contrato encontrada"
    for path in CONTRACT_FILES:
        assert path.stem in CONTRACTS, path.name


@pytest.mark.parametrize(("name", "example", "should_pass"), list(_cases()))
def test_examples_match_zod_behaviour(name, example, should_pass):
    model = CONTRACTS[name]
    if should_pass:
        model.model_validate(example)
    else:
        with pytest.raises(ValidationError):
            model.model_validate(example)


def _required_tree(schema: dict, defs: dict, path: str = "") -> dict[str, set[str]]:
    """Mapa caminho → campos obrigatórios, seguindo $ref, anyOf/oneOf e arrays."""
    out: dict[str, set[str]] = {}
    if "$ref" in schema:
        ref = schema["$ref"].split("/")[-1]
        return _required_tree(defs[ref], defs, path)
    for key in ("anyOf", "oneOf"):
        for i, sub in enumerate(schema.get(key, [])):
            resolved = defs[sub["$ref"].split("/")[-1]] if "$ref" in sub else sub
            props = resolved.get("properties", {})
            disc = props.get("type", {}).get("const") or props.get("intent", {}).get("const")
            for k, v in _required_tree(sub, defs, f"{path}|{disc or i}").items():
                out[k] = out.get(k, set()) | v
    if schema.get("type") == "object" or "properties" in schema:
        out[path] = set(schema.get("required", []))
        for prop, sub in schema.get("properties", {}).items():
            out.update(_required_tree(sub, defs, f"{path}.{prop}"))
    if "items" in schema and isinstance(schema["items"], dict):
        out.update(_required_tree(schema["items"], defs, f"{path}[]"))
    return out


@pytest.mark.parametrize("name", sorted(CONTRACTS))
def test_required_fields_match_exported_json_schema(name):
    zod_path = SCHEMAS_DIR / f"{name}.json"
    assert zod_path.is_file(), f"rode `pnpm contracts:export` ({zod_path})"
    zod = json.loads(zod_path.read_text(encoding="utf-8"))
    pyd = CONTRACTS[name].model_json_schema(by_alias=True)

    zod_tree = _required_tree(zod, zod.get("$defs", {}))
    pyd_tree = _required_tree(pyd, pyd.get("$defs", {}))
    # Uniões discriminadas: comparar por discriminador, não por posição.
    assert {k: sorted(v) for k, v in pyd_tree.items()} == {k: sorted(v) for k, v in zod_tree.items()}
