from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_", env_nested_delimiter="__", extra="ignore")
    environment: str = "development"
    log_level: str = "INFO"


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_DATABASE_", extra="ignore")
    url: str | None = None
    pool_size: int = 2
    max_overflow: int = 2


class GcpSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_GCP_", extra="ignore")
    project_id: str = ""
    storage_bucket: str = ""
    # The names must match what the backend publishes to; see
    # packages/web/src/server/env.ts.
    topic_file_uploaded: str = "file-uploaded"
    topic_convert_requested: str = "convert-requested"


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_RUNTIME_", extra="ignore")
    #: Must be longer than the work and no longer than the Pub/Sub ack
    #: deadline, or a healthy worker has its file reclaimed mid-run.
    lease_seconds: int = 600
    outbox_batch_size: int = 100
    reap_batch_size: int = 100
    outbox_max_attempts: int = 10


class ProcessingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_PROCESSING_", extra="ignore")
    csv_chunk_size: int = 1000
    max_file_size_mb: int = 100
    max_records: int = 100000


class SchemaSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_SCHEMA_", extra="ignore")
    sample_rows: int = 20
    max_sample_bytes: int = 1_048_576
    #: Gemini caps a whole request at 20MB and base64 inflates bytes by a third,
    #: so the raw image has to stay under 15MB with room left for the prompt.
    max_image_bytes: int = 14_000_000
    max_pdf_bytes: int = 14_000_000
    #: Relative to the working directory, which is /app in both images.
    prompts_dir: str = "prompts"


class LlmSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZAMP_LLM_", extra="ignore")
    enabled: bool = False
    provider: str = ""
    model: str = ""
    api_key: str = ""
    temperature: float = 0.0
    max_output_tokens: int = 8192
    #: Attempts after the first, so 3 means at most 4 requests.
    max_retries: int = 3
    timeout_seconds: int = 60


class Settings:
    def __init__(self, config_path: str | Path | None = None):
        raw: dict[str, Any] = {}
        if config_path and Path(config_path).exists():
            raw = yaml.safe_load(Path(config_path).read_text(encoding="utf-8")) or {}
        self.app = AppSettings(**self._override("app", raw.get("app", {})))
        self.database = DatabaseSettings(**self._override("database", raw.get("database", {})))
        self.gcp = GcpSettings(**self._override("gcp", raw.get("gcp", {})))
        self.runtime = RuntimeSettings(**self._override("runtime", raw.get("runtime", {})))
        self.processing = ProcessingSettings(**self._override("processing", raw.get("processing", {})))
        self.schema = SchemaSettings(**self._override("schema", raw.get("schema", {})))
        self.llm = LlmSettings(**self._override("llm", raw.get("llm", {})))

    @staticmethod
    def _override(section: str, values: dict[str, Any]) -> dict[str, Any]:
        """Apply explicit ZAMP_SECTION_FIELD environment overrides over YAML."""
        result = dict(values)
        prefix = f"ZAMP_{section.upper()}_"
        for name, value in os.environ.items():
            if name.startswith(prefix): result[name.removeprefix(prefix).lower()] = value
        return result
