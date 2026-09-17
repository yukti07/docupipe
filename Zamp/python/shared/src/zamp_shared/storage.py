from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class ObjectStorage(ABC):
    @abstractmethod
    def download_to_file(self, bucket: str, object_key: str, destination: str | Path) -> None: ...

    @abstractmethod
    def upload_file(self, bucket: str, object_key: str, source: str | Path) -> None: ...

    @abstractmethod
    def exists(self, bucket: str, object_key: str) -> bool: ...


class FakeObjectStorage(ObjectStorage):
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def download_to_file(self, bucket: str, object_key: str, destination: str | Path) -> None:
        Path(destination).write_bytes(self.objects[(bucket, object_key)])

    def upload_file(self, bucket: str, object_key: str, source: str | Path) -> None:
        self.objects[(bucket, object_key)] = Path(source).read_bytes()

    def exists(self, bucket: str, object_key: str) -> bool:
        return (bucket, object_key) in self.objects


class GCSObjectStorage(ObjectStorage):
    """Uses Application Default Credentials in Cloud Run and local gcloud ADC."""
    def __init__(self, project: str | None = None) -> None:
        from google.cloud import storage
        self.client = storage.Client(project=project or None)

    def download_to_file(self, bucket: str, object_key: str, destination: str | Path) -> None:
        self.client.bucket(bucket).blob(object_key).download_to_filename(str(destination))

    def upload_file(self, bucket: str, object_key: str, source: str | Path) -> None:
        self.client.bucket(bucket).blob(object_key).upload_from_filename(str(source))

    def exists(self, bucket: str, object_key: str) -> bool:
        return self.client.bucket(bucket).blob(object_key).exists(self.client)
