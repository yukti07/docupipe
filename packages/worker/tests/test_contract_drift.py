"""The failure list must be identical in four places.

It is product semantics that lives in two languages, and the plan names it as
one of the few things that will drift without anyone noticing. It already did
once: the frontend built against `spec.md`'s taxonomy while the worker was
built against the plan's §12.4, and only nine of twenty-one values agreed.

A class the worker writes but the client omits renders as "unknown" — a worse
sentence than the one we had, arriving silently. A class the client expects
but the Postgres enum omits is a constraint violation at write time.

So this test reads the other three files and compares. It needs no database
and no Node: it is text, deliberately, so it runs everywhere and fails fast.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.failures import FailureClass

#: packages/ — so the db and web packages are siblings of this one.
PACKAGES = Path(__file__).resolve().parents[2]
MIGRATION = PACKAGES / "db/prisma/migrations/20260915000000_init/migration.sql"
PRISMA = PACKAGES / "db/prisma/schema.prisma"
TYPES_TS = PACKAGES / "web/src/lib/api/types.ts"
HTTP_TS = PACKAGES / "web/src/lib/api/http.ts"

#: Client-side states. The server never sends them, so they are absent from
#: the database enum on purpose.
CLIENT_ONLY = {"network", "unknown"}


def _worker() -> set[str]:
    return {c.value for c in FailureClass}


def _sql_enum() -> set[str]:
    body = re.search(
        r'CREATE TYPE "failure_class" AS ENUM\s*\((.*?)\);',
        MIGRATION.read_text(encoding="utf-8"),
        re.S,
    )
    assert body, "no failure_class enum in the migration"
    return set(re.findall(r"'([a-z_]+)'", body.group(1)))


def _prisma_enum() -> set[str]:
    body = re.search(
        r"enum FailureClass \{(.*?)\n\}", PRISMA.read_text(encoding="utf-8"), re.S
    )
    assert body, "no FailureClass enum in schema.prisma"
    lines = [ln.split("//")[0].strip() for ln in body.group(1).splitlines()]
    return {ln for ln in lines if re.fullmatch(r"[a-z_]+", ln)}


def _ts_type() -> set[str]:
    body = re.search(
        r"export type FailureClass =(.*?)\n\n", TYPES_TS.read_text(encoding="utf-8"), re.S
    )
    assert body, "no FailureClass type in types.ts"
    return set(re.findall(r'"([a-z_]+)"', body.group(1)))


def _ts_known() -> set[str]:
    body = re.search(
        r"const KNOWN = new Set<string>\(\[(.*?)\]\)",
        HTTP_TS.read_text(encoding="utf-8"),
        re.S,
    )
    assert body, "no KNOWN set in http.ts"
    return set(re.findall(r'"([a-z_]+)"', body.group(1)))


@pytest.mark.skipif(not MIGRATION.exists(), reason="db package not present")
def test_worker_and_postgres_enum_agree():
    assert _worker() == _sql_enum()


@pytest.mark.skipif(not PRISMA.exists(), reason="db package not present")
def test_prisma_and_postgres_enum_agree():
    """Prisma and the migration describe the same type. If these disagree, the
    next `prisma migrate dev` proposes a destructive change."""
    assert _prisma_enum() == _sql_enum()


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_frontend_type_and_worker_agree():
    assert _ts_type() - CLIENT_ONLY == _worker()


@pytest.mark.skipif(not HTTP_TS.exists(), reason="web package not present")
def test_frontend_guard_set_matches_its_own_type():
    """`classOf()` maps anything outside KNOWN to "unknown". A value in the
    type but missing from the set is a class that silently loses its sentence.
    """
    assert _ts_known() == _ts_type()


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_client_only_classes_are_not_in_the_database():
    """`network` and `unknown` describe the client's own state. Storing them
    would mean a file row claiming a failure the server never diagnosed."""
    assert CLIENT_ONLY & _sql_enum() == set()


@pytest.mark.skipif(not TYPES_TS.exists(), reason="web package not present")
def test_field_origin_value_matches_what_the_ui_renders():
    """SchemaFieldRow renders the "added by you" marker on `origin === "added"`.
    Anything else and the marker silently never appears."""
    from src.shapes import ORIGIN_ADDED, ORIGIN_DETECTED

    origins = set(
        re.findall(r'origin: "(\w+)" \| "(\w+)"', TYPES_TS.read_text(encoding="utf-8"))
    )
    assert origins, "no SchemaField.origin union in types.ts"
    assert set(origins.pop()) == {ORIGIN_DETECTED, ORIGIN_ADDED}
