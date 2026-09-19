from abc import ABC, abstractmethod

from zamp_shared.domain import DetectedTable, Schema, SchemaDetectionContext


class SchemaDetector(ABC):
    @abstractmethod
    def detect(self, context: SchemaDetectionContext) -> Schema: ...

    def detect_tables(self, context: SchemaDetectionContext) -> list[DetectedTable]:
        """Every table this file holds, in ordinal order.

        One table is the normal case and stays the default, so a format that
        cannot hold more than one never has to think about this. A workbook
        overrides it and returns one table per worksheet.
        """
        return [DetectedTable(ord=0, schema=self.detect(context))]
