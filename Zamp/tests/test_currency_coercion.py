"""A currency column never fails a row over the symbol in front of the number.

The currency on a field is an assertion about the COLUMN, not a check on each
value, so a euro amount in a column marked USD is a data-quality matter for the
user rather than a reason to reject the row.
"""
import pytest


@pytest.fixture
def coerce(processor):
    return processor.TypeCoercer().coerce


@pytest.mark.parametrize("raw", ["$500", "₹500", "€500", "£500", "¥500", "500"])
def test_every_supported_symbol_reads_as_the_same_amount(raw, coerce) -> None:
    assert coerce(raw, "currency") == 500.0


def test_a_symbol_the_column_did_not_expect_is_still_read(coerce) -> None:
    # A euro amount in a column the user marked USD. Wrong, and the user's to
    # fix — but the number is legible and the row must survive.
    assert coerce("€1,299.50", "currency") == 1299.5


@pytest.mark.parametrize("raw,expected", [
    ("1,500", 1500.0),
    ("1 500", 1500.0),
    ("USD 1,500", 1500.0),
    ("1500 EUR", 1500.0),
    ("  $ 1,500.75  ", 1500.75),
    ("-$250", -250.0),
])
def test_separators_codes_and_spacing_are_tolerated(raw, expected, coerce) -> None:
    assert coerce(raw, "currency") == expected


def test_something_that_is_not_an_amount_comes_through_untouched(coerce) -> None:
    # Not None: a required field would then fail validation, which is the very
    # thing this must not do. The user sees exactly what the cell held.
    assert coerce("n/a", "currency") == "n/a"


def test_an_empty_cell_is_not_an_error(coerce) -> None:
    assert coerce("", "currency") == ""


def test_nothing_at_all_is_still_nothing(coerce) -> None:
    assert coerce(None, "currency") is None


def test_a_number_already_a_number_is_left_alone(coerce) -> None:
    assert coerce(1299.5, "currency") == 1299.5


def test_plain_number_columns_stay_strict(coerce) -> None:
    # Only `currency` is forgiving. A `number` column that cannot be read is
    # still a marked cell, which is the signal the type exists to give.
    with pytest.raises((ValueError, TypeError)):
        coerce("n/a", "number")


# --------------------------------------------------------------- the code

# The rest of this file is about the currency CODE, which is a property of the
# column: the schema detector reads it off the document, the user can change it
# in the schema editor, and it has to survive the trip back here intact.


@pytest.fixture
def shared():
    from zamp_shared import repositories
    return repositories


def test_an_edited_schema_still_reaches_the_coercer_as_a_currency(shared) -> None:
    """The regression this whole file exists for.

    `from_backend_schema` used to flatten `currency` onto `number`. Nothing
    looked wrong: the detected shape kept its canonical fields and coerced
    leniently, so only a schema the user had EDITED took the strict `number`
    branch — where a euro sign is a ValueError and the row is lost.
    """
    schema = shared.from_backend_schema(
        [{"key": "total", "label": "total", "type": "currency", "currency": "EUR"}])
    assert schema.fields[0].type == "currency"
    assert schema.fields[0].currency == "EUR"


def test_the_code_survives_a_round_trip_through_the_backend(shared) -> None:
    from zamp_shared.domain import Schema, SchemaField

    original = Schema(name="records", fields=[SchemaField(name="total", type="currency", currency="GBP")])
    persisted = shared.to_backend_fields(original)
    assert persisted[0]["type"] == "currency"
    assert persisted[0]["currency"] == "GBP"
    assert shared.from_backend_schema(persisted).fields[0].currency == "GBP"


def test_a_currency_field_with_no_code_is_still_a_currency_field(shared) -> None:
    # The document often does not say. That is not a reason to demote the
    # column to a plain number and lose the lenient coercion with it.
    schema = shared.from_backend_schema([{"key": "total", "label": "total", "type": "currency"}])
    assert schema.fields[0].type == "currency"
    assert schema.fields[0].currency is None


def test_a_code_left_on_a_retyped_field_is_dropped_both_ways(shared) -> None:
    from zamp_shared.domain import Schema, SchemaField

    # A column the user retyped to text is no longer making a claim about
    # amounts, and the schema editor strips the code on exactly this rule.
    assert shared.from_backend_schema(
        [{"key": "note", "label": "note", "type": "text", "currency": "USD"}]).fields[0].currency is None

    stale = Schema(name="records", fields=[SchemaField(name="note", type="string", currency="USD")])
    assert "currency" not in shared.to_backend_fields(stale)[0]
