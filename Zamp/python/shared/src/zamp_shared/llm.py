from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from .domain import Schema, SourceFile

T = TypeVar("T", bound=BaseModel)


class LLMClient(ABC):
    @abstractmethod
    def generate_structured(self, prompt: str, response_model: type[T], variables: dict[str, Any]) -> T: ...


class DisabledLLMClient(LLMClient):
    def generate_structured(self, prompt: str, response_model: type[T], variables: dict[str, Any]) -> T:
        raise RuntimeError("LLM is disabled")


class PromptRepository:
    def __init__(self, root: str | Path): self.root = Path(root)
    def load(self, prompt_name: str) -> str:
        path = (self.root / prompt_name).resolve()
        if self.root.resolve() not in path.parents or not path.is_file(): raise FileNotFoundError(prompt_name)
        return path.read_text(encoding="utf-8")


class LLMService:
    """Optional boundary. Deterministic MIME paths stay valid when it is disabled or unavailable."""
    def __init__(self, client: LLMClient | None = None, enabled: bool = False): self.client, self.enabled = client or DisabledLLMClient(), enabled
    def enhance_schema(self, source: SourceFile, schema: Schema, context: dict[str, Any]) -> Schema:
        return schema
    def validate_record(self, record: dict[str, Any], schema: Schema) -> None: return None
    def repair_record(self, record: dict[str, Any], schema: Schema) -> dict[str, Any]: return record
