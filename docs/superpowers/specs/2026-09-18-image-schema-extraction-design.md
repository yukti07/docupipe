# Image-based schema extraction (Zamp schema-detector)

Status: implemented; §17 records a follow-on that removes the §14 conversion limitation
Date: 2026-09-18
Scope: `Zamp/` plus one additive line in `packages/web/src/server/validate.ts`

## 1 · Why

The Zamp schema-detector resolves a `SchemaDetector` per MIME type and writes an immutable
`file_schema_versions` row. CSV, JSON and XLSX have deterministic detectors. Everything else falls
through to `GeminiSchemaDetector`, which is registered as the registry's *fallback* rather than
against any MIME type.

That accident is the whole of today's image support, and it is uneven:

| Input | Current behaviour |
|---|---|
| png, jpeg, webp, heic, heif | Correct in kind — the bytes go up as `inline_data`, so Gemini reads a real image. But the prompt is document/CSV-oriented, there is no retry on 429/5xx, and a `{"schema": {...}}` response is rejected outright. |
| tiff | **Wrong.** Absent from `NATIVE_MIME_TYPES`, so the bytes are `decode("utf-8", errors="replace")`d and sent as text. Gemini receives mojibake and most plausibly answers with a confident `content` fallback. No error is raised. |
| bmp | Unreachable: `BY_EXTENSION` in the backend has no `bmp` entry. |
| any image, at conversion | `ProcessorRegistry` has no image reader, so conversion fails `UNSUPPORTED_MIME_TYPE`. |

With `llm.enabled: false` (the shipped example config) there is no fallback at all and every image
fails `format_unsupported`.

The tiff row is the motivating defect. It does not fail; it fabricates a schema from binary noise,
and tiff is in the backend's upload allowlist today.

## 2 · Goals

- A dedicated image detector that sends the **actual image** to Gemini and infers the *structure* the
  image represents, not a transcript.
- Explicit MIME routing for `image/jpeg`, `image/png`, `image/webp`, `image/bmp`, `image/tiff`
  (plus `image/heic`, `image/heif`, already accepted by Gemini and by the backend).
- Gemini responses treated as untrusted: extract, normalize, validate, reject.
- The canonical `Schema` root object (`{name, fields, metadata}`) is the only shape that leaves the
  parser. No `schema` wrapper propagates.

## 3 · Non-goals

- No Document AI, no OCR dependency. Gemini receives the image.
- No change to the `Schema` / `SchemaField` domain model.
- ~~No image **record** extraction.~~ Added afterwards as a follow-on; see §17.
- No unrelated refactoring. The existing detectors' observable behaviour is preserved.

## 4 · Module layout

| File | Status | Responsibility |
|---|---|---|
| `python/shared/src/zamp_shared/llm.py` | modified | Add `GeminiClient`: the only code in the repo that speaks HTTP to Gemini. `generate(parts) -> str`. Bounded retry with exponential backoff plus jitter on 408/429/5xx; immediate failure on other 4xx; response bodies truncated and API-key-scrubbed before logging. Sits beside the existing `LLMClient` and `PromptRepository` rather than forming a parallel abstraction. |
| `python/schema-detector/src/app/services/schema_parser.py` | new | `parse_schema(raw: str) -> Schema`. Owns every stage of turning untrusted text into a validated `Schema`. |
| `python/schema-detector/src/app/detectors/image.py` | new | `GeminiImageSchemaDetector(SchemaDetector)`. Size check, bmp/tiff transcode, multimodal part construction, prompt load. No HTTP, no JSON handling. |
| `python/schema-detector/src/app/detectors/gemini.py` | modified | Retains its prompt and behaviour; delegates transport to `GeminiClient` and parsing to `parse_schema`. This is what gives the PDF path retry and wrapper tolerance. |
| `python/schema-detector/src/app/pipeline/detector_registry.py` | modified | Image extensions added to the existing `extension_types` map. No new branching. |
| `python/schema-detector/src/app/main.py` | modified | Registers the seven image MIME types against one shared detector instance, only when the LLM is configured. |
| `python/prompts/schema/schema_from_image.txt` | new | The image prompt. |
| `python/schema-detector/requirements.txt` | modified | `Pillow>=10,<12`. |

`SchemaDetector.detect(context) -> Schema` is unchanged. `SchemaPipeline` still does
`registry.resolve(...)` then `detector.detect(...)` then `validator.validate(...)`.

## 5 · Prompt relocation

`Zamp/prompts/` sits outside the `python/` Docker build context, so no prompt file can reach either
image. This is recorded as finding A7 in `Zamp/docs/worker_review_findings.md`, whose recommended fix
is to bake the directory into the image.

- `git mv Zamp/prompts Zamp/python/prompts` (contents unchanged).
- `COPY prompts /app/prompts` in both Dockerfiles.
- `schema.prompts_dir` config value, default `prompts`, which resolves correctly under the image's
  `WORKDIR /app`.
- For local runs and tests the root differs, so `ZAMP_SCHEMA_PROMPTS_DIR=python/prompts` is set in
  `tests/conftest.py` and `.env.example` and documented in the README. No path-guessing logic.

`cloudbuild.yaml`, `docker-compose.yml`, `python/.dockerignore` and both build contexts are untouched,
so the Cloud Run deployment is satisfied by not changing it. The move also repairs the same
unreachability for `prompts/processing/*.txt`, which the data-processor cannot load today.

## 6 · Image request construction

1. `os.stat` the path first. A file over `schema.max_image_bytes` raises `GEMINI_FILE_TOO_LARGE`
   before any bytes are read, so an oversized image is never loaded into memory.
2. Normalize the MIME type (strip parameters, lowercase).
3. `image/bmp` and `image/tiff` are **not** in Gemini's accepted inline-image set, so they are
   re-encoded to PNG with Pillow. PNG is lossless: no resolution is lost, and no resizing or
   compression is applied to any format. The transcoded result is re-checked against the size cap,
   because PNG can be larger than the source.
4. Every other supported type is sent byte-for-byte with its own MIME type. No format is assumed to
   be JPEG.
5. Parts are `[{inline_data: {mime_type, data}}, {text: <prompt>}]` — the image first, then the
   instruction.

Pillow is an image codec, not an OCR engine. It never extracts text; the model still receives pixels.

## 7 · Parser

```
Gemini text -> extract -> normalize -> Schema.model_validate -> semantic checks -> Schema
```

Extraction, in order, stopping at the first success:

1. Strip whitespace.
2. Strip surrounding markdown fences, tolerating an absent language tag and a missing closing fence.
3. Direct `json.loads`.
4. Scan with `json.JSONDecoder().raw_decode` from each opening brace, collecting every decodable
   object. No naive regex — nesting makes that unsafe.
5. Score the candidates and take the best: `name` and `fields` present, `metadata` preferred. A
   `schema` key whose value carries `name`/`fields` also qualifies.
6. Unwrap `{"schema": {...}}`, merging a sibling `metadata` into the root.
7. If the result is a JSON string, decode **once** more. Never recursive.
8. No plausible candidate leaves `GEMINI_JSON_INVALID`.

Normalization runs **before** Pydantic, because the model's root `unique_names` validator would
otherwise reject duplicates before they can be judged. It is deliberately narrow and
meaning-preserving:

- Drop unrecognized keys at root and field level.
- Default missing `aliases`, `fields`, `item_fields` to `[]`; missing `item_type` to null;
  missing `required` to false.
- Coerce a numeric-string `confidence`, then clamp to `[0.0, 1.0]`. A non-numeric `confidence` is
  dropped and a note recorded. Confidence is model-reported only and is never described as
  calibrated.
- Force `metadata.provider` to `gemini` and `metadata.format` to `image`.
- Duplicate field names collapse **only** when the two objects are byte-for-byte identical.
  Otherwise `GEMINI_SCHEMA_INVALID` — merging non-identical duplicates would change meaning.

Semantic checks then cover what Pydantic does not:

| # | Rule | Enforced by |
|---|---|---|
| 1 | Schema name non-empty | Pydantic (`min_length=1`) |
| 2 | `fields` is a non-empty list | Pydantic (`min_length=1`) |
| 3 | Every field name non-empty | Pydantic |
| 4 | Field names unique at the root | Pydantic |
| 4n | **Field names unique at every nested level** | new — a genuine model gap |
| 5 | Type in the `FieldType` vocabulary | Pydantic |
| 6 | `required` is a real boolean, not the string `"true"` | new — Pydantic would coerce the string |
| 7 | `aliases` is a list of non-blank strings | Pydantic |
| 8 | `object` defines `fields`; `array` defines `item_type` | Pydantic |
| 9 | `item_type`/`item_fields` only on `array`/`list` | new |
| 10 | `item_fields` entries recurse through the same checks | new |

These checks run only on LLM output, inside the parser. The deterministic CSV/JSON/XLSX detectors keep
their current validation path untouched.

## 8 · Type vocabulary

Only the existing `FieldType` literal: `text`, `number`, `date`, `currency`, `boolean`, `list`,
`string`, `integer`, `datetime`, `array`, `object`, `null`. The prompt instructs the model to prefer a
general compatible type (`text`) over a specific one when evidence is thin, and to treat
identifier-like numerics (invoice numbers, account numbers, postal codes, values with leading zeros)
as text.

## 9 · Prompt content (`schema_from_image.txt`)

Opens with "You are a schema extraction engine, not a transcription engine." Requires the whole image
to be inspected before deciding. Structural evidence priority: explicit tables, repeated
rows/records, repeated key/value structures, forms, repeated sections, lists, semantically grouped
fields, free-form content.

States explicitly that a table needs no visible borders, with a worked borderless example, and lists
the usable evidence: horizontal and vertical alignment, repeated positions, headers, indentation,
whitespace, typography, labels, repeated structures.

Constrains field creation: ignore logos, decorative text, page numbers, watermarks, repeated
headers/footers, copyright notices and instructional text unless they are part of the data. One field
per table column, never one per observed value. One schema per repeated record, never one per
instance. With several structures present, pick the primary repeated dataset rather than merging
unrelated ones; use `fields`, `item_type` and `item_fields` for nesting. Never invent a field a
document normally has — an invoice with no visible invoice number gets no `invoice_number`.

`required: true` only when structurally required, checked across observed records; insufficient
evidence means false. Aliases must be genuine visible or strongly implied alternative labels; an
empty array beats invention. Descriptions carry semantic meaning without restating the name or
inventing business rules.

The `content` fallback applies only when no meaningful structure exists — never because the image is
merely difficult. Output is exactly one JSON object in the canonical root shape, with no markdown,
prose, commentary, multiple objects, root arrays or `schema` wrapper.

## 10 · Configuration

```yaml
schema:
  max_image_bytes: 14000000
  prompts_dir: prompts
llm:
  temperature: 0
  max_output_tokens: 8192
  max_retries: 3
  timeout_seconds: 60
```

Added to `SchemaSettings` and `LlmSettings`, which already carry `ZAMP_*` env overrides, and mirrored
into `config/config.example.yaml`. `api_key` stays in `.env` / Secret Manager; no secret enters YAML.
14 MB keeps the base64-inflated payload inside Gemini's 20 MB request cap and matches the existing
`max_inline_bytes` default rather than introducing a second number.

## 11 · Error handling, retry, logging

`GeminiClient` retries 408/429/5xx up to `max_retries` with exponential backoff plus jitter, then
raises `TransientError` so `SchemaPipeline` leaves the file in `INSPECTING` for the reaper. Other 4xx
— malformed auth or configuration — raise `InvalidInput` immediately with no retry. Existing codes
already map through `failures.py`, so no backend enum change is needed:

| Code | `failure_class` |
|---|---|
| `GEMINI_FILE_TOO_LARGE` | `too_large` |
| `GEMINI_REQUEST_FAILED` | `provider_refused` |
| `GEMINI_EMPTY_RESPONSE` | `provider_refused` |
| `GEMINI_JSON_INVALID` | `response_unparseable` |
| `GEMINI_SCHEMA_INVALID` | `schema_inference_failed` |

Logged: model, MIME type, byte length, whether a transcode happened, HTTP status, attempt number,
response length, parser stage, validation error, and a truncated provider error. Never logged: the
API key (scrubbed from URLs and bodies), signed URLs, image bytes, or the full Gemini response.

## 12 · Testing

`tests/test_schema_parser.py` covers all sixteen required cases — clean JSON; fenced JSON; JSON after
prose; JSON before prose; multiple objects with one valid; `{"schema": ..., "metadata": ...}` wrapper;
JSON string containing JSON; malformed JSON; valid JSON but invalid `Schema`; duplicate field names
(identical and conflicting); unsupported type; missing `name`; missing `fields`; invalid metadata;
nested `item_fields`; content fallback.

`tests/fixtures/gemini/` holds six realistic scenario responses — invoice, receipt, spreadsheet
screenshot, form, prose fallback, mixed invoice — each deliberately messy with fences, prose or a
wrapper, serving as the integration-style fixtures.

`tests/test_image_detector.py` drives `GeminiImageSchemaDetector` through a stubbed `GeminiClient`:
the image is sent as `inline_data` and not as text; the real MIME type is used per format; bmp and
tiff arrive as `image/png`; an oversized file is rejected before being read; retry-then-succeed and
400-fails-fast; and the prompt loads from `prompts_dir`. Small synthetic PNG/BMP/TIFF files are
generated at test time via Pillow rather than committed.

No test touches the live Gemini API.

## 13 · Backend change

One additive line in `packages/web/src/server/validate.ts`: `bmp: "image/bmp"` in `BY_EXTENSION`.
Without it no `.bmp` can enter the pipeline and the detector's bmp support is dead code.

## 14 · Limitations

- ~~**Image conversion still fails.**~~ Resolved by the follow-on in §17.
- Confidence is model-reported, not calibrated.
- Multi-page TIFFs are transcoded from the first frame only.
- Structure inference quality is the model's; the parser guarantees shape, not correctness.

## 15 · Pre-existing issues found, not fixed

1. `prompts/schema/schema_enhancement.txt:1` and `docs/data-format-workflow.md:24` both specify a
   `{schema, metadata}` envelope, contradicting the canonical root contract. The prompt is dead code
   (`LLMService.enhance_schema` returns its input unchanged); the doc line is corrected as part of
   §16.
2. `Schema.unique_names` validates only root-level field names. Nested duplicates pass Pydantic. The
   parser compensates for LLM output; deterministic detectors remain unguarded.
3. `schema.max_sample_bytes` and `processing.max_file_size_mb` are configured but unreferenced, as
   already noted in `worker_review_findings.md` A8. Nothing bounds input size before download.
4. `PromptRepository` has no call sites anywhere in the repo.

## 16 · Documentation

`docs/data-format-workflow.md` gains an image section covering supported MIME types, the multimodal
request, bmp/tiff transcoding, the parser stages and the conversion limitation, and its
`{schema, metadata}` envelope sentence is corrected to the canonical root contract. `README.md` notes
image support and `ZAMP_SCHEMA_PROMPTS_DIR`.

## 17 · Follow-on: image record extraction

Added after the detection work landed, removing the §14 conversion limitation. The image is sent to
Gemini a second time, now with the approved schema, and the model returns the values rather than the
shape.

| File | Status | Responsibility |
|---|---|---|
| `zamp_shared/json_extract.py` | new | The JSON-digging both workers need: fence stripping, one bounded string-in-string decode, and a `raw_decode` scan. What counts as a plausible answer stays with each caller. |
| `zamp_shared/images.py` | new | Gemini's accepted image types, the bmp/tiff PNG transcode and the size check, shared by the detector and the reader. |
| `data-processor/.../readers/image.py` | new | `GeminiImageReader`. One request, one page of records. |
| `data-processor/.../services/record_parser.py` | new | Untrusted response to a list of record dicts. |
| `python/prompts/processing/records_from_image.txt` | new | The extraction prompt. |
| `readers/base.py` and the three local readers | modified | `read()` now also takes the approved `Schema`. The local readers know their own column names and ignore it; a reader that asks a model for values cannot work without it. |
| `processor_registry.py`, `data-processor/main.py` | modified | Image MIME routing, matching the detector's. |
| `failures.py` | modified | `GEMINI_RECORDS_INVALID` maps to `response_unparseable`. |

Decisions worth recording:

- **Aliases are withheld from the prompt.** `SchemaMapper` resolves a record by field name first, so
  showing the model an alias invites it to answer under a key that maps twice over.
- **Every field appears in every record**, with `null` where the image shows nothing. An omitted key
  and a genuinely empty cell are different claims.
- **Header, totals and subtotal rows are excluded.** They summarise the records; they are not records.
- **Zero records is a failure** (`EXTRACT_EMPTY`), not an empty success, because a schema was
  detected from this same image.
- **No streaming.** An image is one page of records, so the reader makes a single request and holds
  the result rather than pretending to chunk.
- **Per-record failures stay per-record.** A value returned in the wrong shape fails in `TypeCoercer`
  as an ordinary coercion error, exactly as a bad CSV cell does, rather than failing the run.

Remaining limitation: a table too large to be read in one response is truncated by
`max_output_tokens` rather than paged. Multi-page TIFFs still send only the first frame.
