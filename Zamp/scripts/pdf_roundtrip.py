"""Detect a schema from one PDF, then convert that PDF using it.

The PDF twin of `scripts/image_roundtrip.py`, and the same bargain: it exercises
the real production classes — `GeminiSchemaDetector` (which is the detector a
PDF actually resolves to, since `application/pdf` is in `NATIVE_MIME_TYPES` and
nothing else claims it), `SchemaValidator`, `GeminiPdfReader`, `SchemaMapper`,
`TypeCoercer`, `DeterministicValidator` — and reproduces the per-record loop
from `ProcessingPipeline._one_record` exactly.

What it leaves out is the durable layer: no database, no lease, no outbox, no
object storage. Those need PostgreSQL and none of them are what this shows.

The PDF is sent to Gemini twice, once for the shape and once for the values.
Nothing else leaves the machine, and the API key is never printed.
"""
from __future__ import annotations

import argparse
import codecs
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "shared" / "src"))

#: What the workers default to, and what the deployed convert worker is pinned
#: to. A roundtrip on a different model is a roundtrip against a different
#: product, so this is stated rather than inherited.
DEFAULT_MODEL = "gemini-3.5-flash"


def load_dotenv() -> None:
    """Read `.env`, whatever encoding the shell that wrote it chose."""
    path = ROOT / ".env"
    if not path.is_file():
        return
    raw = path.read_bytes()
    text = (raw.decode("utf-16") if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE))
            else raw.decode("utf-8-sig", errors="replace"))
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, _, value = line.partition("=")
            os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


load_dotenv()

from zamp_shared.domain import SchemaDetectionContext, SourceFile  # noqa: E402
from zamp_shared.errors import DomainError  # noqa: E402
from zamp_shared.llm import GeminiClient, PromptRepository  # noqa: E402

PROMPTS = ROOT / "python" / "prompts"


def use_worker(name: str) -> None:
    """Put one worker's `app` package on the path, replacing the other's."""
    for module in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[module]
    sys.path[:] = [entry for entry in sys.path
                   if not entry.endswith(("schema-detector\\src", "schema-detector/src",
                                          "data-processor\\src", "data-processor/src"))]
    sys.path.insert(0, str(ROOT / "python" / name / "src"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect a schema from a PDF, then convert the PDF with it.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--model", default=os.getenv("ZAMP_LLM_MODEL") or DEFAULT_MODEL)
    args = parser.parse_args()

    path = args.pdf.resolve()
    if not path.is_file():
        parser.error(f"File does not exist: {path}")
    if not os.getenv("ZAMP_LLM_API_KEY"):
        parser.error("ZAMP_LLM_API_KEY is required (put it in Zamp/.env)")

    def client() -> GeminiClient:
        return GeminiClient(os.environ["ZAMP_LLM_API_KEY"], args.model)

    # The backend types an upload from its extension; this is what it would send.
    source = SourceFile(id="local-file", request_id="local-request", user_id="local-user",
                        bucket="local", object_key=f"uploads/{path.name}", filename=path.name,
                        mime_type="application/pdf", size_bytes=path.stat().st_size)
    say(f"pdf       {path.name} (application/pdf, {source.size_bytes:,} bytes)")
    say(f"model     {args.model}")

    # ---------------------------------------------------------------- detect
    use_worker("schema-detector")
    from app.detectors.gemini import GeminiSchemaDetector
    from app.services.schema_validator import SchemaValidator

    detector = GeminiSchemaDetector(client())
    say("detect    asking gemini for the shape...")
    started = time.monotonic()
    tables = detector.detect_tables(SchemaDetectionContext(source_file=source, local_path=str(path)))
    # `.schema_definition`, not `.schema`: the field is aliased because pydantic
    # already owns the name, and reaching for the alias hands back the model's
    # own deprecated classmethod instead of the table.
    schema = SchemaValidator().validate(tables[0].schema_definition)
    detect_seconds = time.monotonic() - started
    say(f"detect    {len(schema.fields)} fields in {detect_seconds:.1f}s: "
        f"{', '.join(f.name for f in schema.fields)}")

    # --------------------------------------------------------------- convert
    use_worker("data-processor")
    from app.readers.pdf import GeminiPdfReader
    from app.transformation.coercion import TypeCoercer
    from app.transformation.mapper import SchemaMapper
    from app.validation.deterministic import DeterministicValidator

    reader = GeminiPdfReader(client(), PromptRepository(PROMPTS))
    mapper, coercer, validator = SchemaMapper(), TypeCoercer(), DeterministicValidator()

    say("convert   asking gemini for the records...")
    started = time.monotonic()
    records, errors = [], []
    total = processed = failed = 0
    try:
        for number, canonical in enumerate(reader.read(source, str(path), schema), start=1):
            total += 1
            # The same loop as ProcessingPipeline._one_record.
            mapped = mapper.map(canonical.values, schema)
            converted, record_errors = {}, []
            for field in schema.fields:
                try:
                    converted[field.name] = coercer.coerce(mapped[field.name], field.type)
                except Exception as exc:  # noqa: BLE001
                    record_errors.append({"recordNumber": number, "field": field.name,
                                          "code": getattr(exc, "code", "TYPE_COERCION_FAILED"),
                                          "message": str(exc)})
            issues = validator.validate(converted, schema)
            if record_errors or issues:
                failed += 1
                errors.extend(record_errors)
                errors.extend({"recordNumber": number, "issue": str(issue)} for issue in issues)
            else:
                processed += 1
            records.append(converted)
    except DomainError as exc:
        errors.append({"code": exc.code, "message": str(exc)})
    convert_seconds = time.monotonic() - started
    say(f"convert   {total} records in {convert_seconds:.1f}s "
        f"({processed} clean, {failed} with errors)")

    print(json.dumps({
        "pdf": {"filename": path.name, "mimeType": "application/pdf", "sizeBytes": source.size_bytes},
        "model": args.model,
        "timings": {"detect_seconds": round(detect_seconds, 1),
                    "convert_seconds": round(convert_seconds, 1)},
        "detected_schema": schema.model_dump(mode="json"),
        "processing": {"records_total": total, "records_processed": processed, "records_failed": failed},
        "records": records,
        "record_errors": errors,
    }, default=str, indent=2))


def say(line: str) -> None:
    print(line, file=sys.stderr)


if __name__ == "__main__":
    main()
