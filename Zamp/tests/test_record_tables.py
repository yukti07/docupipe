"""Each table of a file gets a physical records table of its own."""
import pytest

from zamp_shared.errors import DomainError
from zamp_shared.repositories import RecordRepository


def repo() -> RecordRepository:
    return RecordRepository(database=None)


def test_two_worksheets_of_one_file_land_in_different_tables() -> None:
    assert repo().table_name("F100", 0) != repo().table_name("F100", 1)


def test_the_same_worksheet_always_resolves_to_the_same_table() -> None:
    assert repo().table_name("F100", 1) == repo().table_name("F100", 1)


def test_the_name_carries_the_ordinal_where_it_can_be_read() -> None:
    assert repo().table_name("F100", 2).endswith("_t2")


def test_the_name_is_a_legal_postgres_identifier() -> None:
    name = repo().table_name("F100", 11)
    assert len(name) <= 63
    assert name.startswith("structured_records_")


def test_a_file_id_that_is_not_an_identifier_is_still_refused() -> None:
    with pytest.raises(DomainError):
        repo().table_name("F100; DROP TABLE users", 0)


def test_a_negative_ordinal_is_refused() -> None:
    with pytest.raises(DomainError):
        repo().table_name("F100", -1)
