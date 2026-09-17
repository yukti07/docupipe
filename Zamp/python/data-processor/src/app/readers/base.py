from abc import ABC, abstractmethod
from collections.abc import Iterator

from zamp_shared.domain import CanonicalRecord, SourceFile


class SourceReader(ABC):
    @abstractmethod
    def read(self, source: SourceFile, local_path: str) -> Iterator[CanonicalRecord]: ...

