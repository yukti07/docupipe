import contextlib
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "python" / "shared" / "src"), str(ROOT / "python" / "schema-detector" / "src")]

# In the image the prompts sit next to the working directory at /app/prompts, so
# the default is correct there and only a local run needs telling.
os.environ.setdefault("ZAMP_SCHEMA_PROMPTS_DIR", str(ROOT / "python" / "prompts"))

PROCESSOR_SRC = ROOT / "python" / "data-processor" / "src"


@contextlib.contextmanager
def _processor_on_path():
    """Swap the detector's `app` package for the processor's.

    Both workers are separate deployables that happen to root their code at
    `app`, so only one of them can own the name at a time. `scripts/smoke_test.py`
    solves this the same way.
    """
    saved = {name: module for name, module in sys.modules.items() if name == "app" or name.startswith("app.")}
    for name in saved:
        del sys.modules[name]
    sys.path.insert(0, str(PROCESSOR_SRC))
    try:
        yield
    finally:
        sys.path.remove(str(PROCESSOR_SRC))
        for name in [n for n in sys.modules if n == "app" or n.startswith("app.")]:
            del sys.modules[name]
        sys.modules.update(saved)


@pytest.fixture
def processor():
    """The data-processor modules the image tests need, imported safely."""
    with _processor_on_path():
        from app.readers.image import GeminiImageReader
        from app.services.record_parser import parse_records
        from app.transformation.coercion import TypeCoercer
        from app.transformation.mapper import SchemaMapper

        yield type("Processor", (), {"GeminiImageReader": staticmethod(GeminiImageReader),
                                     "parse_records": staticmethod(parse_records),
                                     "TypeCoercer": staticmethod(TypeCoercer),
                                     "SchemaMapper": staticmethod(SchemaMapper)})
