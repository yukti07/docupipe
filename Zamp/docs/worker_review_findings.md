# Worker review findings

Review of the `schema-detector` and `data-processor` Cloud Run workers, covering deployment/connectivity wiring and correctness of schema detection.

Findings are grouped as **A. Connectivity** and **B. Schema detection**, ordered by severity within each group. File references are `path:line` against the reviewed tree.

**Status legend:** 🔴 critical · 🟠 high · ⚪ minor · ✅ fixed

---

## A. Connectivity issues

### ✅ A1. The detector writes to GCS but is provisioned read-only — every detection failed after the schema was already committed

**Status: fixed.** See *Fix applied* below.

`schema_pipeline.py:32` uploads the detected-schema artifact:

```python
self.storage.upload_file(source.bucket, f"uploads/{request_id}/schema/detected-v{version.version}.json", artifact)
```

`README.md` stated *"The schema detector needs GCS read access, while the data processor needs GCS read/write access."* Deployed that way (`roles/storage.objectViewer`), **every detection 403s** at this line.

The ordering made it far worse. `Database.session()` (`repositories.py:171-173`) uses `sessionmaker.begin()`, so **each repository call is its own committed transaction**. By the time the upload threw:

- `persist_detected` had **already committed** the schema version row
- `record_detection_result` and `files.update_stage(file_id, "SCHEMA_READY")` had **not** run

`google.api_core.exceptions.Forbidden` is not a `DomainError`, so `except DomainError` at `schema_pipeline.py:36` did not catch it, and `main.py:51-55` (handling only `DomainError` and `RuntimeError`) did not either → **500** → Pub/Sub redelivered.

On redelivery, `schema_pipeline.py:22-23` short-circuited:

```python
existing = self.schemas.latest_for_file(file_id)
if existing: return existing
```

→ returned **200 OK**, message **acked**. The file was permanently stuck at `stage='UPLOADED'`, `file_schema_results` never written, and the backend waiting on `SCHEMA_READY` hung forever — with no error recorded anywhere. Silent, permanent, and indistinguishable from success.

#### Fix applied

`python/schema-detector/src/app/pipeline/schema_pipeline.py` — detection is now resumable instead of all-or-nothing. The bare early return became a guard plus a resume path; the completion steps run on every delivery that reaches them, and detect-and-persist moved into `_detect`:

```python
existing = self.schemas.latest_for_file(file_id)
# A user edit or approval means detection already finished; resuming would regress the file stage.
if existing and existing.source != "DETERMINISTIC": return existing
with tempfile.TemporaryDirectory(prefix=f"schema-{request_id}-") as directory:
    # Redelivery after a partial failure resumes from the committed version; every step below is idempotent.
    version = existing or self._detect(request_id, file_id, source, directory)
```

This holds because all three completion steps are already idempotent: the upload uses a deterministic object key, `record_detection_result` is a `session.merge` upsert keyed on `file_schema_id`, and `update_stage` is a plain assignment (which also clears a stale `FAILED` marking on recovery). The resume path skips the GCS download — it only needs `version.schema_definition`, already persisted.

The `source != "DETERMINISTIC"` guard is load-bearing: without it, making the terminal steps unconditional would newly *introduce* a regression where a stray redelivery knocks an already-approved-and-processed file from `COMPLETED` back to `SCHEMA_READY` and overwrites its artifact with post-edit fields.

`README.md` was also corrected to state that both workers need GCS read **and** write on the upload bucket, naming the prefix each writes to.

| Scenario | Before | After |
|---|---|---|
| Happy path | works | works |
| 403 after schema commit, then redelivery | **acked with `stage=UPLOADED`, no result row, no artifact — stuck forever** | converges: stage advances, result recorded, artifact written |
| Stray redelivery after user approval | no-op | no-op, `COMPLETED` preserved |

Two caveats:

- Recovery now covers *any* failure after the schema commit, not just the 403 — a crash between `record_detection_result` and `update_stage` heals on redelivery too.
- On the resume path the artifact is rebuilt from the persisted schema, which goes through the lossy round-trip in **B1**. A resumed artifact can therefore differ from a first-attempt one (integers shown as `number`, nested objects flattened to `text`) until B1 is fixed. DB state is unaffected.

### 🔴 A2. Blocking work inside an `async def` handler starves the event loop → health checks fail mid-run

`main.py:46-49` (both workers):

```python
async def receive_pubsub(request: Request) -> JSONResponse:
    ...
    result = get_pipeline().execute(...)   # fully synchronous: GCS download, pandas, per-record DB I/O
```

FastAPI runs `async def` endpoints **directly on the event loop**. Everything in `execute()` is blocking. While a file processes, uvicorn cannot read new connections at all — so Cloud Run's probes against `/health` time out and the instance can be killed **mid-processing**.

**Fix:** drop `async` (`def receive_pubsub(...)`) and read the body synchronously, so FastAPI dispatches it to the threadpool.

### 🔴 A3. Synchronous processing inside a push handler will exceed the Pub/Sub ack deadline

`processing_pipeline.py:37-53` iterates up to `max_records` (default **100,000**) inline, and `RecordRepository.write` (`repositories.py:256-259`) opens **a new session, a SELECT, and a commit per record** — ~200k round trips through a pool of `pool_size=2`.

Pub/Sub push requires a response within the ack deadline (10s default, 600s max); Cloud Run's request timeout is 300s by default. Neither will hold. The message is redelivered while the first run is still going, and with `max-instances=1`/`concurrency=1` the redelivery is rejected and retried indefinitely.

`structured_records` has `UNIQUE(processing_run_id, record_number)` so records will not duplicate — but see A5.

**Fix:** batch record writes into one transaction per chunk, and either ack immediately + process asynchronously, or raise the ack deadline and Cloud Run timeout to bound real file sizes.

### 🔴 A4. No dead-letter topic, and many *permanent* failures return 500 → infinite retry

The design intent (`README.md`, `main.py:51-53`) is sound: `DomainError` → 200 + ack; dependency failure → non-2xx + retry. But a large class of genuinely permanent, poison-message failures do **not** raise `DomainError`:

| Input | Raises | Result |
|---|---|---|
| Malformed CSV | `pandas.errors.ParserError` | 500 → retry forever |
| Latin-1 / cp1252 CSV | `UnicodeDecodeError` | 500 → retry forever |
| Invalid JSON | `json.JSONDecodeError` | 500 → retry forever |
| Duplicate-after-casefold columns | `pydantic.ValidationError` (B5) | 500 → retry forever |
| Empty nested object | `pydantic.ValidationError` (B4) | 500 → retry forever |

Each pins the single allowed instance in a retry loop until the 7-day retention expires.

**Fix:** configure a dead-letter topic — nothing in the repo or README mentions one — and wrap the detector/reader calls to convert parse failures into `DomainError`.

### 🟠 A5. Non-`DomainError` mid-processing leaves the run stuck `RUNNING` and multiplies `record_errors`

`processing_pipeline.py:60` catches only `DomainError`. Anything else propagates with the run left at `status=RUNNING` and no `error_code`. On redelivery, the guard at line 26 only short-circuits on `COMPLETED`, so it reprocesses from record 1. `RecordRepository.write` dedupes, but `ErrorRepository.write` (`repositories.py:264-265`) does a blind `session.add` with no uniqueness constraint — so **error rows duplicate on every retry**, inflating `records_failed` reporting.

### 🔴 A6. No Cloud SQL connectivity path is configured or documented

`ZAMP_DATABASE_URL` is a plain `postgresql+psycopg://host:5432/...` URL. From Cloud Run that reaches a Cloud SQL instance **only** via a unix socket (`--add-cloudsql-instances`, host `/cloudsql/PROJ:REGION:INST`) or a Serverless VPC Access connector for private IP. Neither appears in `README.md` or `cloudbuild.yaml`. As written, deployment connects to nothing and every request 503s.

Credit where due: `pool_pre_ping=True` (`repositories.py:162`) is the right call for Cloud Run's idle-instance connection drops.

### 🟠 A7. `config.yaml` can never exist in the deployed image → silent fallback to defaults

Both Dockerfiles build from context `python/`. `prompts/` **is now inside it** — it was moved to
`python/prompts` and both Dockerfiles `COPY prompts /app/prompts`, so prompt files do reach the
image. `config/` is still outside the build context and cannot be copied. `ZAMP_CONFIG_PATH` defaults to `config/config.yaml`, and `config.py:54` silently skips a missing file:

```python
if config_path and Path(config_path).exists():
```

So in Cloud Run every tuned value — `max_records`, `csv_chunk_size`, `sample_rows`, `pool_size` — silently reverts to its default, and `database.url` is `None` unless `ZAMP_DATABASE_URL` is set.

**Fix:** log a warning when the config path is absent, and either bake the config into the image or set every value via env.

### ⚪ A8. Smaller items

- **`PORT` ignored**: both Dockerfiles hardcode `--port 8080`. Cloud Run's default container port is 8080 so it works today, but any `--port` on deploy breaks it. Use a shell-form CMD with `--port ${PORT:-8080}`.
- **No in-app OIDC verification**: security rests entirely on deploying with `--no-allow-unauthenticated` + Cloud Run Invoker. A legitimate choice, but one mis-deploy makes both endpoints world-writable with no second line of defense.
- **`docker-compose.yml`**: `depends_on: [postgres]` without `condition: service_healthy` (Postgres is not ready on first request — masked by lazy init + 503); no volume, so local data is lost each run; the `gcloud` ADC mount path is Windows-only.
- **`max_file_size_mb` and `max_sample_bytes` are configured but never referenced anywhere** (grepped — no call sites). Nothing bounds input size before download or parse.

---

## B. Schema detection bugs

### 🔴 B1. The persistence round-trip silently destroys the detected schema

The most damaging bug. `to_backend_fields` (`repositories.py:20-24`) downcasts types and emits **only** `{key, label, type, required, description, aliases}`. `from_backend_schema` (`repositories.py:27-35`) maps back with a *different, non-inverse* table. Every read through `SchemaRepository._to_model` (`repositories.py:231`) goes through this.

Verified by replicating both functions verbatim:

```
field    detected   -> stored   -> loaded by processor  LOSS
------------------------------------------------------------------------
id       integer    -> number   -> number                <-- TYPE CHANGED
amount   number     -> number   -> number
when     datetime   -> date     -> date                  <-- TYPE CHANGED
addr     object     -> text     -> string                <-- TYPE CHANGED  <-- nested 'fields' DROPPED
tags     array      -> list     -> array
ok       boolean    -> boolean  -> boolean
notes    null       -> text     -> string                <-- TYPE CHANGED

keys persisted per field: ['aliases', 'description', 'key', 'label', 'required', 'type']
nested/item info survived?  False
```

`fields`, `item_type`, and `item_fields` are **never persisted**. Feeding those degraded types into `TypeCoercer`:

```
integer id 1001 coerced as 'number' -> 1001.0
nested dict coerced as 'string'     -> "{'city': 'NY', 'zip': 10001}"
  is that valid JSON?               -> NO -- JSONDecodeError
```

Concretely:

- **Every integer becomes a float.** Order IDs, account numbers, quantities land in `structured_records` as `1001.0`.
- **Every nested object becomes a Python `repr` string.** The JSON detector's entire nested-object capability (`json.py:37-38`) is discarded at write time, and the processor stores `"{'city': 'NY'}"` — not valid JSON, un-queryable in a JSONB column. Silent corruption of real customer data.
- **`datetime` collapses to `date`**, so `coercion.py:26-29` takes the date branch and the time-of-day is discarded.
- **Arrays keep no item type** — `from_backend_schema:31` hardcodes `item_type="string"` regardless of what was detected.

**Fix:** persist the full `SchemaField` (nested `fields`, `item_type`, `item_fields`) in a `schema_metadata` sub-key alongside the backend's flat contract, and make the two type tables exact inverses.

### 🔴 B2. There is no MIME *detection* — it trusts the uploader's declared type, with no parameter stripping and no fallback

The stated goal is "auto detect schema **based on the mime type** for the given input file." The registry (`detector_registry.py:9`) does a bare dict lookup on `row.detected_content_type or row.content_type or ""` (`repositories.py:183`). Verified against the real keys from `main.py:31-36`:

```
'text/csv'                          OK
'text/csv; charset=utf-8'           UnsupportedMimeType -> acked as permanent failure
'application/json; charset=utf-8'   UnsupportedMimeType -> acked as permanent failure
'application/vnd.ms-excel'          UnsupportedMimeType -> acked as permanent failure
'text/plain'                        UnsupportedMimeType -> acked as permanent failure
'application/octet-stream'          UnsupportedMimeType -> acked as permanent failure
''                                  UnsupportedMimeType -> acked as permanent failure
```

Two showstoppers:

1. **No RFC 2045 parameter stripping.** `text/csv; charset=utf-8` is what `gsutil`, signed-URL uploads, and most HTTP clients send. Perfectly valid CSVs are rejected.
2. **No fallback chain.** A `.csv` uploaded from Windows Chrome with Excel installed arrives as `application/vnd.ms-excel`. GCS objects uploaded without an explicit `contentType` default to `application/octet-stream`. Both are rejected.

Rejection is *permanent*: `UnsupportedMimeType` is a `DomainError`, so `main.py:51-53` returns **200** and acks. The user's valid file is dropped with no retry path.

**Fix:** normalize with `mime.split(";")[0].strip().lower()`, then fall back to file extension, then to content sniffing (magic bytes / `csv.Sniffer`) before declaring unsupported.

### 🔴 B3. XLSX: the processor ignores the sheet the schema was approved for

`xlsx.py:20` (detector) records the chosen sheet and flags ambiguity:

```python
{"format": "xlsx", "sheet_name": selected, "meaningful_sheets": usable, "requires_review": len(usable) > 1}
```

But `readers/xlsx.py:13-19` (processor) **never reads that metadata** — it re-derives the sheet with its own "first non-empty" scan, as the comment concedes. For a multi-sheet workbook where the user reviewed `requires_review=True` and approved a schema for a *different* sheet, the processor reads sheet 0 anyway. `SchemaMapper.map` then finds no matching columns and returns all-`None`, so **every record fails `REQUIRED_FIELD_MISSING`** while the run reports "completed."

**Fix:** read `schema_version.schema_definition.metadata["sheet_name"]` in `XlsxReader`. (`schema_metadata` *is* persisted, so this is fixable independently of B1.)

### 🔴 B4. An empty nested object crashes detection into an infinite retry loop

`json.py:38` builds the object branch, and `domain.py:128-129` rejects it:

```python
# json.py:38
return SchemaField(name=name, type="object", required=required, fields=self._object_fields([...]))
# domain.py:128
if self.type == "object" and not self.fields:
    raise ValueError("object fields must define nested fields")
```

Input `{"rows": [{"id": 1, "meta": {}}]}` → `_object_fields([{}])` returns `[]` → `ValidationError`. Not a `DomainError`, so per A4 it is a **500 and retries forever**. `{"meta": {}}` is extremely common in real payloads.

Same class of latent crash: `from_backend_schema` passes `type: "object"` straight through with `fields=[]` (it is not in the `types` map at `repositories.py:28`), so if the backend or a user edit ever stores an `object` field, **every subsequent read of that schema version raises** — the processor can never load it again.

### 🔴 B5. Columns differing only in case crash detection

`domain.py:141-145` casefolds for its uniqueness check:

```python
names = [field.name.casefold() for field in self.fields]
if len(names) != len(set(names)): raise ValueError("schema field names must be unique")
```

A CSV with both `ID` and `id`, or JSON records with both keys, produces a `ValidationError` → 500 → infinite retry (A4). Separately, `SchemaMapper.map` (`mapper.py:9`) builds a casefolded lookup dict, so even if detection passed, one of the two columns would be **silently dropped** at processing time.

### 🟠 B6. `required` is inferred from a 20-row sample and applied to the whole file

`tabular.py:17`:

```python
required=not series.isna().any()
```

...over `nrows=20` (`csv.py:14`, `xlsx.py:19`). Any column that happens to be fully populated in the first 20 rows is marked **required**, and every later row with a null in it fails `REQUIRED_FIELD_MISSING` (`deterministic.py:21`). On a 100k-row file with a 5%-sparse column, that is thousands of spurious failures from a 20-row guess.

The same sampling problem hits types: a column that looks `integer` in 20 rows but contains `"N/A"` at row 900 produces a coercion failure per affected record.

**Fix:** at minimum, never infer `required=True` from a sample — default to `False` and let the human reviewer set it. That is exactly what the review step exists for.

### 🟠 B7. The JSON detector loads the entire file into memory and ignores every sampling limit

`json.py:14` does a bare `json.load(stream)` on the full file, and `_object_fields` (lines 29-30) walks **every record**. `JsonSchemaDetector` is the only detector constructed without `sample_rows` (`main.py:34`), and neither `max_file_size_mb` nor `max_sample_bytes` is enforced anywhere (grepped — no call sites). A 200MB JSON on a 512Mi Cloud Run instance gets OOM-killed → instance dies → Pub/Sub retries → loop.

### 🟠 B8. Date columns are never detected as dates

`tabular.py:13-16` tests bool → integer → float → **else `"string"`**. `pd.read_csv` does not parse dates without `parse_dates`, so every date column in a CSV becomes `string`. XLSX *does* return real `datetime64[ns]` from openpyxl — which also falls through to `"string"`. So the `date`/`datetime` members of `FieldType` are effectively unreachable from tabular detection, and `TypeCoercer`'s date branches are dead code for CSV/XLSX.

Related, in the same function: an integer column containing a single null is read by pandas as `float64` and therefore detected as `"number"`, so IDs become floats even before B1 compounds it.

### 🟠 B9. JSON: mixed numeric types collapse to string; exactly-one-array is too strict

- `json.py:36`: `kinds` of `{integer, number}` (e.g. values `1` and `2.5` in the same field) has `len == 2` → falls back to `"string"`. A numeric column becomes text. Widen `integer|number` → `number` before the fallback.
- `json.py:24-25` requires **exactly one** qualifying array. `all(isinstance(item, dict) for item in value)` is vacuously `True` for `[]`, so a realistic payload like `{"rows": [...], "errors": []}` counts two arrays and raises `InvalidInput` — acked as a permanent failure. Filter empty arrays out of the candidate set.

### ⚪ B10. Minor

- `tabular.py:11-12`: `non_null` and `dtype` are assigned and never used.
- `tabular.py:27` + `json_safe`: `sample_values` for an XLSX datetime column yields `pd.Timestamp` objects, which have no `.item()` and are not JSON-serializable. These land in `schema.metadata` → the `schema_metadata` JSON column. Unverified — confirm against a real dated workbook once 3.12 + deps are installed.
- `repositories.py:195`: `latest_for_file` orders by `created_at DESC` only. `created_at` is a Python-side default, so same-microsecond rows tie non-deterministically. Order by `version DESC` as a tiebreaker.
- `repositories.py:207-209`: `persist_detected` returns the latest version of the parent **regardless of status**, so a redelivered detection event can return an already-`APPROVED` version.

---

## Suggested order of attack

1. ~~**A1** (silent permanent stall)~~ — **done**; and **B2** (valid files rejected outright). These block the happy path today.
2. **B1** — silent data corruption; the longer it runs, the more bad rows accumulate.
3. **A4 + A5** (dead-letter topic + convert parse errors to `DomainError`) — stops poison messages from pinning the single instance, and covers B4/B5 as a class.
4. **A2 + A3** — required before this survives any realistic file size.
5. **B3, B6** — correctness of what actually gets processed.

---

## Verification notes

The pipeline could not be executed during review: only Python 3.10 is installed locally and the code targets 3.12 (`StrEnum`), with no dependencies present. Accordingly:

- **B1 and B2** were verified by replicating the relevant pure-logic functions (`to_backend_fields`, `from_backend_schema`, `TypeCoercer.coerce` branches, the registry lookup) verbatim and running them. Outputs are quoted inline above.
- **The A1 fix** was verified by mirroring the new `execute()` control flow against fakes across all three delivery scenarios, plus a `py_compile` check on the real module.
- **All other findings** are code-path claims traced by reading, with `path:line` references given so each can be checked directly.
