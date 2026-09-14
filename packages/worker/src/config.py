"""Worker configuration, entirely from the environment.

One image runs as either role (§26). `SERVICE_ROLE` is the only thing that
decides which processor runs and which topic a reclaimed file goes back to.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache


class ServiceRole(str, Enum):
    INSPECT = "inspect"
    CONVERT = "convert"
    #: One process serving both topics. Local development only — deployed,
    #: the two are separate services with separate accounts so the inspect
    #: worker is structurally unable to write output or hold a model key.
    BOTH = "both"


class StorageBackend(str, Enum):
    GCS = "gcs"
    LOCAL = "local"


def _env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        raise RuntimeError(
            f"{name} is required. The worker refuses to start without it rather "
            f"than failing later on the first message."
        )
    return value or ""


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


@dataclass(frozen=True)
class Config:
    role: ServiceRole
    instance_id: str

    database_url: str
    instance_connection_name: str
    db_user: str
    db_password: str
    db_name: str
    db_pool_size: int

    storage_backend: StorageBackend
    bucket: str
    local_storage_root: str

    project_id: str
    topic_file_uploaded: str
    topic_convert_requested: str

    lease_seconds: int
    max_attempts: int
    outbox_max_attempts: int
    outbox_batch_size: int
    reap_batch_size: int

    log_level: str
    version: str

    @property
    def is_inspect(self) -> bool:
        return self.role is ServiceRole.INSPECT

    @property
    def is_convert(self) -> bool:
        return self.role is ServiceRole.CONVERT

    def topic_for_stage(self, stage: str) -> str:
        """Which topic a reclaimed file goes back to (§31.2).

        The reaper re-enqueues through the outbox, so it has to know which
        topic matches the stage it just reset the file to.
        """
        if stage in ("UPLOADED", "INSPECTING"):
            return self.topic_file_uploaded
        return self.topic_convert_requested


def _build() -> Config:
    role_raw = _env("SERVICE_ROLE", "inspect").strip().lower()
    try:
        role = ServiceRole(role_raw)
    except ValueError as exc:
        raise RuntimeError(
            f"SERVICE_ROLE must be 'inspect', 'convert' or 'both', got {role_raw!r}"
        ) from exc

    backend_raw = _env("STORAGE_BACKEND", "gcs").strip().lower()
    try:
        backend = StorageBackend(backend_raw)
    except ValueError as exc:
        raise RuntimeError(
            f"STORAGE_BACKEND must be 'gcs' or 'local', got {backend_raw!r}"
        ) from exc

    # Cloud Run injects a per-instance id; fall back to a hostname locally so
    # the lease still identifies one process.
    instance_id = (
        os.environ.get("CLOUD_RUN_EXECUTION")
        or os.environ.get("K_REVISION")
        or os.environ.get("HOSTNAME")
        or f"local-{os.getpid()}"
    )

    return Config(
        role=role,
        instance_id=f"{role.value}:{instance_id}",
        database_url=_env("DATABASE_URL"),
        instance_connection_name=_env("INSTANCE_CONNECTION_NAME"),
        db_user=_env("DB_USER"),
        db_password=_env("DB_PASSWORD"),
        db_name=_env("DB_NAME"),
        db_pool_size=_int_env("DB_POOL_SIZE", 2),
        storage_backend=backend,
        bucket=_env("GCS_BUCKET_NAME"),
        local_storage_root=_env("LOCAL_STORAGE_ROOT", "/var/quarry/storage"),
        project_id=_env("GCP_PROJECT_ID"),
        topic_file_uploaded=_env("PUBSUB_TOPIC_FILE_UPLOADED", "file-uploaded"),
        topic_convert_requested=_env(
            "PUBSUB_TOPIC_CONVERT_REQUESTED", "convert-requested"
        ),
        # The lease must be longer than the work, and the Pub/Sub ack deadline
        # at least as long as the lease, or a healthy worker gets its file
        # stolen mid-run (§31.2).
        lease_seconds=_int_env("LEASE_SECONDS", 600),
        max_attempts=_int_env("MAX_ATTEMPTS", 5),
        outbox_max_attempts=_int_env("OUTBOX_MAX_ATTEMPTS", 10),
        outbox_batch_size=_int_env("OUTBOX_BATCH_SIZE", 100),
        reap_batch_size=_int_env("REAP_BATCH_SIZE", 100),
        log_level=_env("LOG_LEVEL", "INFO").upper(),
        version=_env("GIT_SHA", "dev"),
    )


@lru_cache(maxsize=1)
def get_config() -> Config:
    return _build()


def reset_config_cache() -> None:
    """Tests change the environment between cases."""
    get_config.cache_clear()
