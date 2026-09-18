from abc import ABC, abstractmethod
from collections.abc import Iterator

from zamp_shared.domain import CanonicalRecord, Schema, SourceFile


class SourceReader(ABC):
    """Turns one source file into canonical records.

    `schema` is the approved schema this run was created against. The local
    readers already know their own column names and ignore it; a reader that
    asks a model for the values needs it, because the field names are the only
    thing telling the model what to look for.
    """

    @abstractmethod
    def read(self, source: SourceFile, local_path: str, schema: Schema) -> Iterator[CanonicalRecord]: ...
