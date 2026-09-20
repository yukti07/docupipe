"""Detect a schema from one image, then convert that image using it.

Exercises the real production classes — `GeminiImageSchemaDetector`,
`SchemaValidator`, `GeminiImageReader`, `SchemaMapper`, `TypeCoercer`,
`DeterministicValidator` — and reproduces the per-record loop from
`ProcessingPipeline._one_record` exactly.

What it deliberately leaves out is the durable layer: no database, no lease, no
outbox, no object storage. Those need PostgreSQL (the claim statement uses
`make_interval` and a `file_stage` cast), and none of them are what this script
is here to show. `scripts/smoke_test.py` is the one that covers that path, and
it is currently broken for unrelated reasons.

The image is sent to Gemini twice, once for the shape and once for the values.
Nothing else leaves the machine, and the API key is never printed.
"""
from __future__ import annotations

import argparse
import codecs
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "shared" / "src"))

MIME_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".heic": "image/heic", ".heif": "image/heif",
}


def load_dotenv() -> None:
    """Read `.env`, whatever encoding the shell that wrote it chose.

    Windows PowerShell's `>>` writes UTF-16LE, so a key appended there arrives
    with a BOM that no UTF-8 decode can read.
    """
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


def use_worker(name: str):
    """Put one worker's `app` package on the path, replacing the other's.

    Both workers are separate deployables that root their code at `app`, so only
    one can own the name at a time.
    """
    for module in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[module]
    sys.path[:] = [entry for entry in sys.path if not entry.endswith(("schema-detector\\src", "schema-detector/src",
                                                                      "data-processor\\src", "data-processor/src"))]
    sys.path.insert(0, str(ROOT / "python" / name / "src"))


def client() -> GeminiClient:
    return GeminiClient(os.environ["ZAMP_LLM_API_KEY"], os.getenv("ZAMP_LLM_MODEL") or "gemini-3.5-flash")


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect a schema from an image, then convert the image with it.")
    parser.add_argument("image", type=Path)
    args = parser.parse_args()

    path = args.image.resolve()
    if not path.is_file():
        parser.error(f"File does not exist: {path}")
    mime_type = MIME_TYPES.get(path.suffix.lower())
    if not mime_type:
        parser.error(f"{path.suffix} is not a supported image extension; one of {sorted(MIME_TYPES)}")
    if not os.getenv("ZAMP_LLM_API_KEY"):
        parser.error("ZAMP_LLM_API_KEY is required (put it in Zamp/.env)")

    source = SourceFile(id="local-file", request_id="local-request", user_id="local-user",
                        bucket="local", object_key=f"uploads/{path.name}", filename=path.name,
                        mime_type=mime_type, size_bytes=path.stat().st_size)
    print(f"image     {path.name} ({mime_type}, {source.size_bytes:,} bytes)", file=sys.stderr)

    # ---------------------------------------------------------------- detect
    use_worker("schema-detector")
    from app.detectors.image import GeminiImageSchemaDetector
    from app.services.schema_validator import SchemaValidator

    detector = GeminiImageSchemaDetector(client(), PromptRepository(PROMPTS))
    print("detect    asking gemini for the schema...", file=sys.stderr)
    schema = SchemaValidator().validate(
        detector.detect(SchemaDetectionContext(source_file=source, local_path=str(path))))
    print(f"detect    {len(schema.fields)} fields: {', '.join(f.name for f in schema.fields)}", file=sys.stderr)

    # --------------------------------------------------------------- convert
    use_worker("data-processor")
    from app.readers.image import GeminiImageReader
    from app.transformation.coercion import TypeCoercer
    from app.transformation.mapper import SchemaMapper
    from app.validation.deterministic import DeterministicValidator

    reader, mapper, coercer = GeminiImageReader(client(), PromptRepository(PROMPTS)), SchemaMapper(), TypeCoercer()
    validator = DeterministicValidator()

    print("convert   asking gemini for the records...", file=sys.stderr)
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
                                          "code": getattr(exc, "code", "TYPE_COERCION_FAILED"), "message": str(exc)})
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

    print(json.dumps({
        "image": {"filename": path.name, "mimeType": mime_type, "sizeBytes": source.size_bytes},
        "detected_schema": schema.model_dump(mode="json"),
        "processing": {"records_total": total, "records_processed": processed, "records_failed": failed},
        "records": records,
        "record_errors": errors,
    }, default=str, indent=2))


if __name__ == "__main__":
    main()
