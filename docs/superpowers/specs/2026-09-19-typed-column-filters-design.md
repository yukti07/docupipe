# Typed column filters

Status: built
Date: 2026-09-19
Scope: `packages/web/src/lib/filters.ts` (new), `packages/web/src/components/quarry/ColumnFilter.tsx`,
`packages/web/src/components/quarry/DataTable.tsx`, `packages/web/src/components/quarry/DataCell.tsx`

## 1 · Why

The table screen is the product's payoff: a document went in unstructured and a schema came out.
Right now that screen does not show it. Every column filter is the same control — one text box,
one operator, `contains` — whether the column holds an invoice number or a total. A CSV dropped into
a spreadsheet offers strictly more: numeric columns there can be compared.

Two consequences follow.

**The typing is invisible.** `SchemaField.type` is inferred per field, editable in the schema editor,
and carried on every table response. Nothing downstream of the schema editor reads it except the
sort function. Someone looking at the converted table cannot tell that `total` is a currency and
`invoice_number` is a string, because both render and filter identically.

**Numeric questions cannot be asked.** "Which invoices are over 1,000" is the ordinary question about
a table of invoices, and the answer today is to sort by `total` and read down the column. `contains`
is the wrong tool: filtering `total` for `100` matches `1100.00` and `2100.00` and misses `250.00`.

## 2 · Goals

- Each column's filter offers the operators its declared type supports, and no others.
- The declared type is legible on the table itself, before anyone opens a filter.
- The parsing and operator rules live in one pure module, testable without React.
- A cell whose text cannot be read as its own type is excluded from comparisons, and the popover
  says how many such cells the column has.

Non-goals, deliberately: several filters on one column, OR logic across columns, saved filter sets,
filters persisted in the URL.

## 3 · Constraint: values arrive as display strings

`CellValue` carries `display: string` and nothing numeric:

```ts
export type CellValue = {
  valueId: string
  display: string
  state: CellState
  reason?: string
}
```

There is no normalized numeric or date field on a cell and no server-side filtering endpoint. Every
comparison therefore parses `display` in the browser. That is the load-bearing constraint of this
design, and the reason §4 is mostly parsers.

The fixture (`fixtures/api/table-invoice-1044.json`) shows what the worker actually emits: currency
as bare `"1488.00"`, dates as ISO `"2026-01-01"`. The parsers are built wider than that, because the
worker's output is not the only source — merged tables union several files, and a schema's type can
be changed by hand after inference.

## 4 · `src/lib/filters.ts`

A new module with no React import.

### 4.1 The operator sets

```ts
export type Operator =
  | "contains" | "notContains" | "is" | "isNot"
  | "gt" | "lt" | "gte" | "lte" | "eq"
  | "after" | "before" | "on"
  | "between"
  | "isYes" | "isNo"
  | "hasItem" | "lacksItem"
  | "isEmpty" | "isNotEmpty"
```

| Type | Operators, in menu order |
|---|---|
| `text` | `contains`, `notContains`, `is`, `isNot`, `isEmpty`, `isNotEmpty` |
| `number` | `gt`, `lt`, `gte`, `lte`, `eq`, `between`, `isEmpty` |
| `currency` | same as `number` |
| `date` | `after`, `before`, `on`, `between`, `isEmpty` |
| `boolean` | `isYes`, `isNo`, `isEmpty` |
| `list` | `hasItem`, `lacksItem`, `isEmpty` |

`OPERATORS: Record<FieldType, readonly Operator[]>` holds the table above. The default operator for a
type is its first entry.

`OPERATOR_LABELS: Record<Operator, string>` holds the words — `"contains"`, `"does not contain"`,
`"is greater than"`, `"is at least"`, `"is between"`, `"is yes"`, `"has item"`, `"is empty"`. The
operator menu and the active-filter chip both read this map, so the two cannot drift apart.

`ARITY: Record<Operator, 0 | 1 | 2>` — `0` for `isEmpty` / `isNotEmpty` / `isYes` / `isNo`, `2` for
`between`, `1` for everything else. This is what decides how many value inputs the popover renders.

`isApplied(filter)` reads that arity back: true when the operator has every value it needs. It is the
one definition of "this filter means something", used by Apply's disabled state, by the chip row, and
by `setFilter` — so a half-typed filter cannot enter the table's state by any route.

### 4.2 The filter value

```ts
export type ColumnFilterValue = {
  op: Operator
  /** Empty string when the operator takes no value. */
  value: string
  /** The upper bound; only read when the operator is `between`. */
  value2?: string
}
```

An object rather than a string, so the operator survives into the chip row and into the row model
without being re-parsed out of the text someone typed.

### 4.3 The parsers

All three return `null` for "this text is not a value of that type", which is what §4.4 turns into
exclusion.

**`parseNumber(display: string): number | null`**

Applied in order: trim; return `null` on empty. Note a leading `-` or a wrapping `(…)` as negative.
Strip currency symbols and letters (`$ € £ ¥ ₹` and any Unicode letter), `%`, and whitespace
including non-breaking and narrow non-breaking spaces. Then resolve the separators:

| Input | Reading | Result |
|---|---|---|
| `1,234.50` | comma groups, dot decimal | `1234.5` |
| `1.234,50` | dot groups, comma decimal | `1234.5` |
| `1 234,50` | space groups, comma decimal | `1234.5` |
| `1234` | no separators | `1234` |
| `1,234` | comma groups | `1234` |
| `12%` | percent stripped, not divided | `12` |
| `(500)` | accounting negative | `-500` |
| `-500` | plain negative | `-500` |
| `INV-1044` | no numeric reading | `null` |
| `` / `n/a` / `—` | empty or placeholder | `null` |

The separator rule: if both `,` and `.` appear, the rightmost one is the decimal point and the other
is a grouping separator. If only one appears, it is a decimal point when it is followed by exactly
one or two digits to the end of the string and appears once; otherwise it is a grouping separator.
`1,234` is therefore `1234`, and `1,23` is `1.23`. This is a guess in the genuinely ambiguous case,
and the ambiguous case is rare enough that a wrong guess costs one filter, not a wrong total.

Percent is stripped, not divided: `12%` filtered for "greater than 10" should match, because `12` is
what the column shows.

**`parseDate(display: string): number | null`** — returns a UTC timestamp at midnight, so two dates
compare without a timezone shifting one of them across a day boundary. Tried in order: ISO
`YYYY-MM-DD`; then `D/M/YYYY` and `D-M-YYYY` read **day-first**; then `D Mon YYYY` and `Mon D, YYYY`
with English month names. Anything else is `null`. Native `Date` parsing is not used as a fallback —
it reads `03/04/2025` as month-first, which would contradict the rule above.

Day-first is an assumption. It is safe on the filter side regardless: the popover's value control is
`<input type="date">`, which yields ISO, so the operand is never ambiguous. Only the cell being
compared against can be misread, and only when the worker emits a slash date at all — which the
fixture does not.

**`parseList(display: string): string[]`** — splits on commas, semicolons and newlines, trims each
part, drops the empties. `""` yields `[]`.

**`isBlank(value: CellValue | undefined): boolean`** — true when the cell is absent, its state is
`not-found`, or its `display` trims to empty. A `marked` cell is not blank: it has a value that an
automatic check flagged, and it takes part in comparisons like any other.

### 4.4 `matches`

```ts
export function matches(
  type: FieldType,
  value: CellValue | undefined,
  filter: ColumnFilterValue,
): boolean
```

`isEmpty` / `isNotEmpty` are answered from `isBlank` alone, for every type — those two never parse.

Every other operator returns `false` on a blank cell. Then, by type:

- `text` — `contains` / `notContains` / `is` / `isNot` on the trimmed `display`, case-insensitive.
  A blank filter value is handled by the caller (§5), not here.
- `number`, `currency` — `parseNumber` the cell; `null` returns `false`. Parse the operand(s) with
  the same function, so `1,000` typed into the box works. An unparsable operand returns `false`.
  `between` is inclusive, and endpoints given in the wrong order are swapped rather than rejected.
- `date` — `parseDate` the cell; `null` returns `false`. Operands come from a date input as ISO.
  `on` compares the whole day. `between` is inclusive and swaps reversed endpoints.
- `boolean` — read the cell as true for `yes` / `true` / `y` / `1` / `✓` and false for `no` /
  `false` / `n` / `0`, case-insensitive. Anything else returns `false` for both `isYes` and `isNo`.
- `list` — `hasItem` is true when any parsed item equals the operand case-insensitively;
  `lacksItem` is its negation over a non-blank cell.

### 4.5 `unreadable`

```ts
export function unreadable(type: FieldType, rows: TableRow[], key: string): number
```

Counts non-blank cells in a column that their own type's parser returns `null` for. Only meaningful
for `number`, `currency` and `date`; returns `0` for the other three types. Blank cells are not
counted — "no value" is a different fact from "a value I cannot read", and the popover's note is
about the second.

### 4.6 `describeOperand`

```ts
export function describeOperand(filter: ColumnFilterValue): string
```

The operand half of a chip: `"1000"`, `"1000 and 5000"` for `between`, `""` for the nullary
operators. The chip in §6 renders the column's header, `OPERATOR_LABELS[op]`, then this.

## 5 · `ColumnFilter`

Signature changes from `value: string` to `value: ColumnFilterValue | undefined`, and it gains
`type: FieldType`. The popover is still mounted only while open, so the draft still starts from
what is applied, and the filter is still applied on submit rather than per keystroke.

Inside the form, top to bottom:

1. A label naming the column.
2. An operator `Select` (the existing `ui/select`, as `FieldTypeSelect` uses it) listing
   `OPERATORS[type]` by `OPERATOR_LABELS`. Changing the operator keeps the typed value when the new
   operator's arity still has room for it, and clears the second value when arity drops to 1.
3. The value control, shaped by type and arity:
   - arity 0 → nothing.
   - `number`, `currency` → `<input inputMode="decimal">`. Not `type="number"`, so `1,000` and `$50`
     can be typed and parsed by the same function that reads the cells.
   - `date` → `<input type="date">`; two of them for `between`, labelled from and to.
   - `text`, `list` → the text input as today, its placeholder naming what is expected
     (`"Any text"` / `"One item"`).
4. When the operator compares and `unreadable` is non-zero: *"3 of 412 cells here have no readable
   number — those rows won't match."* Shown once, under the inputs, in muted text.
5. Clear and Apply, as today. Apply is disabled when the operator's arity demands a value and none
   is typed — that is what stops an empty filter from entering the state at all.

The trigger button's `aria-label` keeps naming the applied filter, now with the operator word:
`Filter on total — is greater than 1000`.

## 6 · Chips

`ActiveFilters` takes `{ id: string; label: string; operator: string; operand: string }[]` — already
resolved by `DataTable`, so the chip row does not need the field list or the label maps. It renders
`total` · `is greater than` · `1000`, with the operand omitted for a nullary operator, and keeps its
per-chip remove and the Clear all it grows past one filter.

`id` and `label` are separate because they differ on one column. A field column's id is its key,
which is also its header; the source column's id is the internal `__source`, and a control named
after that reads an implementation detail out to whoever is listening. Every user-facing string —
the chip, its remove button, the filter trigger, the sort button — is built from `label`, while the
filter state stays keyed by `id`, which is what the row model requires. Fixing this was not in the
original design: the source column's sort button has been labelled `Sort by __source` all along, and
writing the first test that named that column is what surfaced it.

## 7 · `DataTable`

- No named filter fn is registered. `constructFilterFn` is not usable here: it hands the comparator
  a resolved scalar, and the predicate needs the field's declared type and the whole `CellValue`.
  Each column instead carries a plain `FilterFn` closed over its own field —
  `(row, _id, filter) => matches(field.type, …, filter)` — which is what `FilterFnOption` allows.
  Closing over the field beats a shared registry plus a key→type lookup: the column and the rule it
  is filtered by are written in the same place, and cannot disagree.
- A **failed row** is passed to the predicate as no value at all. This was not in the original
  design. Such a row carries whatever the worker managed before giving up, but `DataCell` renders
  every cell in it as "not found" — so a filter that read the hidden `0.00` would return a row whose
  screen shows nothing. It therefore matches `isEmpty` and no comparison, which is what the cells
  say.
- The `__source` column of a merged table gets the same typed predicate, as `text`, over a
  `CellValue` synthesized from the row's `sourceFile`. It cannot keep `includesString`: filter
  values are objects now, and that built-in would be handed one and stringify it.
- `columnFilters` state becomes `{ id: string; value: ColumnFilterValue }[]`. `setFilter(id, next)`
  replaces or removes by id as it does today; `next === undefined` removes.
- `active` is derived by resolving each entry through `OPERATOR_LABELS` and `describe` for the chip
  row, dropping any whose arity demands a value it does not have.
- The header renders the type badge (§8) and passes `type` into `ColumnFilter`.
- The two empty states keep naming search versus column filters, and their copy is unchanged apart
  from reading the count off the new state.

## 8 · Making the typing visible

**A type badge per header.** Beside the field key, a small uppercase badge reading the type — `text`,
`number`, `date`, `currency`, `yes/no`, `list`, reusing `FIELD_TYPE_LABELS` from `FieldTypeSelect`
so the table and the schema editor say the same words. Muted, `10px`, inside the sort button's row
but outside the button itself, so it never competes with the sort target. Hidden at `compact`
density, where the row has no vertical room for it.

**Numeric columns right-align.** `number` and `currency` cells and their headers align right;
everything else stays left. `DataCell` already renders values in `tabular-nums`; it gains an `align`
prop, defaulted to `"left"`, which `DataTable` sets from the field type. Right-aligned figures with
aligned decimal points are the cheapest available signal that a column is a quantity — it reads as
structure at a glance, from across the room, without opening anything.

The `__source` column is unaffected by both: no badge, left-aligned.

## 9 · Tests

**`src/lib/filters.test.ts`** carries most of the coverage, because most of the risk is in the
parsers.

- `parseNumber` over the whole table in §4.3, plus `null` for `INV-1044`, `""`, `"n/a"`, `"—"`.
- `parseDate` for ISO, day-first slashes, `3 Jan 2026`, `Jan 3, 2026`, and `null` for `"soon"`.
  A day-first case (`03/04/2025` → 3 April) asserted explicitly, since it is the design's one guess.
- `parseList` for commas, semicolons, newlines, stray whitespace, and `""` → `[]`.
- `matches` for every operator against a matching and a non-matching cell.
- `isApplied` for each arity, which is what gates Apply.
- `matches` returns `false` for a comparison against a `not-found` cell, and `true` for `isEmpty`
  against the same cell — the pair that proves the exclusion rule.
- `matches` treats a `marked` cell as an ordinary value.
- `between` with reversed endpoints matches the same rows as the ordered pair.
- `unreadable` counts the unparsable and not the blank.

**`src/components/quarry/DataTable.test.tsx`** gains integration cases over the existing
`invoice_number` (text) / `total` (currency) fixture, extended with a `date` and a `boolean` field.

- Opening the filter on a currency column offers "is greater than" and does not offer "contains".
- Opening the filter on a text column offers "contains" and does not offer "is greater than".
- Choosing "is greater than", typing `100`, applying: the `10.00` row goes, the `216.40` row stays.
- The `not-found` row does not survive that filter, and does survive "is empty".
- The chip reads `total is greater than 100`, and removing it restores every row.
- A currency header carries the `currency` badge; a text header carries `text`.
- A currency cell is right-aligned and a text cell is not.
- A failed row survives `is empty` and is absent from `is at most 1`, despite carrying `0.00`.
- The source column filters as text, carries no type badge, and is named by its header.
- Apply is disabled until the operator has its value, and enabled with none for `is empty`.

## 10 · Verified in the app

Driven against the fixture table (`npm run fixtures:on`, `/request/req_01KABC/table/sch_32`):
type badges on all six headers, the three currency columns right-aligned with their decimal points
in line, `net is greater than 2000` applied and read back as a chip, the date column offering only
`is after / is before / is on / is between / is empty`, `is between` rendering two native date
inputs with Apply held until both are filled, and the badges dropping on compact. No console errors.

## 11 · What this does not change

The server, the schema, the types in `lib/api/types.ts`, the download path (`csv.ts`, `xlsx.ts` still
write every row, not the filtered ones), the evidence panel, the cache. `SchemaField.type` was
already on the wire and already editable; this reads what was always there.
