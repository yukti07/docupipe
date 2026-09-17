from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from zamp_shared.domain import CanonicalRecord, SourceFile, SourceReference
from zamp_shared.errors import InvalidInput
from .base import SourceReader


class JsonReader(SourceReader):
    def read(self, source: SourceFile, local_path: str) -> Iterator[CanonicalRecord]:
        with open(local_path, encoding="utf-8") as stream: data: Any = json.load(stream)
        if isinstance(data, dict):
            arrays = [value for value in data.values() if isinstance(value, list) and all(isinstance(item, dict) for item in value)]
            if len(arrays) == 1: data = arrays[0]
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data): raise InvalidInput("JSON must contain object records")
        for index, item in enumerate(data, start=1):
            yield CanonicalRecord(values=item, source_reference=SourceReference(json_path=f"$[{index - 1}]"))

