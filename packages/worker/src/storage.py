"""Object storage, behind an interface with a local implementation.

Two implementations, one interface:

  * GcsStorage    — deployed
  * LocalStorage  — a directory on disk, so `docker compose up` needs no cloud
                    account, no key, and no .env editing

Selected by STORAGE_BACKEND. Nothing above this module knows which one it got.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .config import Config, StorageBackend

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ObjectInfo:
    exists: bool
    size: int = 0
    generation: int | None = None
    checksum: str | None = None
    content_type: str | None = None


class Storage(Protocol):
    def stat(self, key: str) -> ObjectInfo: ...
    def read(self, key: str) -> bytes: ...
    def write(self, key: str, data: bytes, content_type: str = "text/plain") -> None: ...


class ObjectNotFound(Exception):
    def __init__(self, key: str):
        self.key = key
        super().__init__(f"object not found: {key}")


# --------------------------------------------------------------- local

class LocalStorage:
    """A directory pretending to be a bucket.

    Only for local development and tests. Keys are written as nested paths, so
    the on-disk layout matches the object layout and is inspectable.
    """

    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # A key is server-generated (§17), but refuse traversal anyway — this
        # is the one place a bad key becomes a write outside the root.
        safe = os.path.normpath(key).replace("\\", "/").lstrip("/")
        if safe.startswith("..") or "/../" in safe:
            raise ValueError(f"unsafe object key: {key!r}")
        return self.root / safe

    def stat(self, key: str) -> ObjectInfo:
        path = self._path(key)
        if not path.is_file():
            return ObjectInfo(exists=False)
        data = path.read_bytes()
        return ObjectInfo(
            exists=True,
            size=len(data),
            generation=int(path.stat().st_mtime_ns),
            checksum=hashlib.md5(data).hexdigest(),
        )

    def read(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise ObjectNotFound(key)
        return path.read_bytes()

    def write(self, key: str, data: bytes, content_type: str = "text/plain") -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename, so a reader never sees a half-written object.
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        shutil.move(str(tmp), str(path))


# ----------------------------------------------------------------- gcs

class GcsStorage:
    def __init__(self, bucket_name: str):
        if not bucket_name:
            raise RuntimeError("GCS_BUCKET_NAME is required when STORAGE_BACKEND=gcs")
        self.bucket_name = bucket_name
        self._client = None

    @property
    def bucket(self):
        # Lazy: constructing a client resolves credentials, and doing that at
        # import time makes the container fail to start for a reason that
        # names credentials rather than timing.
        if self._client is None:
            from google.cloud import storage as gcs  # noqa: PLC0415

            self._client = gcs.Client()
        return self._client.bucket(self.bucket_name)

    def stat(self, key: str) -> ObjectInfo:
        blob = self.bucket.get_blob(key)
        if blob is None:
            return ObjectInfo(exists=False)
        return ObjectInfo(
            exists=True,
            size=blob.size or 0,
            generation=blob.generation,
            checksum=blob.md5_hash,
            content_type=blob.content_type,
        )

    def read(self, key: str) -> bytes:
        blob = self.bucket.get_blob(key)
        if blob is None:
            raise ObjectNotFound(key)
        return blob.download_as_bytes()

    def write(self, key: str, data: bytes, content_type: str = "text/plain") -> None:
        blob = self.bucket.blob(key)
        blob.upload_from_string(data, content_type=content_type)


# -------------------------------------------------------------- factory

_storage: Storage | None = None


def get_storage(cfg: Config) -> Storage:
    global _storage
    if _storage is not None:
        return _storage
    if cfg.storage_backend is StorageBackend.LOCAL:
        log.info("storage backend: local at %s", cfg.local_storage_root)
        _storage = LocalStorage(cfg.local_storage_root)
    else:
        _storage = GcsStorage(cfg.bucket)
    return _storage


def set_storage(storage: Storage | None) -> None:
    """Inject a storage. Used by tests; not used in production code."""
    global _storage
    _storage = storage


def output_key(request_id: str, file_id: str) -> str:
    """Deterministic, so a repeated run overwrites rather than duplicating."""
    return f"requests/{request_id}/output/{file_id}/result.txt"
