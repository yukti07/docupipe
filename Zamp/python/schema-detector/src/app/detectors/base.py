from abc import ABC, abstractmethod

from zamp_shared.domain import Schema, SchemaDetectionContext


class SchemaDetector(ABC):
    @abstractmethod
    def detect(self, context: SchemaDetectionContext) -> Schema: ...

