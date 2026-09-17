"""Trigger schema detection and print the persisted schema for one file."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

import psycopg


PROJECT_ID = "project-cf6fd144-baf2-463b-9cd"
TOPIC = "file-uploaded"
INSTANCE = f"{PROJECT_ID}:us-central1:free-trial-first-project"


def gcloud_command(*args: str) -> list[str]:
    if os.name == "nt":
        gcloud = shutil.which("gcloud.cmd") or "gcloud.cmd"
        quote = lambda value: "'" + value.replace("'", "''") + "'"
        command = "& " + quote(gcloud) + " " + " ".join(quote(arg) for arg in args)
        return ["powershell.exe", "-NoProfile", "-Command", command]
    return ["gcloud", *args]


def database_url() -> str:
    value = os.getenv("ZAMP_DATABASE_URL")
    if value:
        return value
    result = subprocess.run(
        gcloud_command("secrets", "versions", "access", "latest", "--secret=zamp-database-url", f"--project={PROJECT_ID}"),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def proxy_url(value: str, port: int) -> str:
    parsed = urlsplit(value)
    query = parse_qs(parsed.query)
    query.pop("host", None)
    query_text = "&".join(f"{key}={item}" for key, values in query.items() for item in values)
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{parsed.path.lstrip('/')}", query_text, parsed.fragment)).replace(
        "@/", f"@127.0.0.1:{port}/", 1
    )


def publish(request_id: str, file_id: str) -> str:
    payload = json.dumps({"eventType": "SCHEMA_DETECTION_REQUESTED", "requestId": request_id, "fileId": file_id}, separators=(",", ":"))
    result = subprocess.run(
        gcloud_command("pubsub", "topics", "publish", TOPIC, f"--project={PROJECT_ID}", f"--message={payload}"),
        check=True,
        capture_output=True,
        text=True,
    )
    for line in result.stdout.splitlines():
        if line.strip().startswith("'"):
            return line.strip().strip("'")
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", default="req_e2emu2wtxxp")
    parser.add_argument("--file-id", default="file_PcMpSbiqMck")
    parser.add_argument("--port", type=int, default=5433)
    parser.add_argument("--wait-seconds", type=int, default=90)
    args = parser.parse_args()

    proxy = Path(os.getenv("TEMP", ".")) / "cloud-sql-proxy.exe"
    if not proxy.exists():
        raise SystemExit(f"Cloud SQL proxy not found at {proxy}")

    proxy_process = subprocess.Popen([str(proxy), f"--port={args.port}", INSTANCE])
    try:
        url = proxy_url(database_url(), args.port)
        deadline = time.monotonic() + args.wait_seconds
        with psycopg.connect(url.replace("postgresql+psycopg://", "postgresql://"), connect_timeout=10) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        message_id = publish(args.request_id, args.file_id)
        print(f"Published message: {message_id}")

        while time.monotonic() < deadline:
            with psycopg.connect(url.replace("postgresql+psycopg://", "postgresql://"), connect_timeout=10) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT id, file_schema_id, request_id, file_id, version, status::text,
                               fields, schema_metadata, source, created_at
                        FROM file_schema_versions
                        WHERE request_id = %s AND file_id = %s
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (args.request_id, args.file_id),
                    )
                    row = cursor.fetchone()
            if row:
                keys = ["id", "file_schema_id", "request_id", "file_id", "version", "status", "fields", "schema_metadata", "source", "created_at"]
                print(json.dumps(dict(zip(keys, row, strict=True)), default=str, indent=2))
                return
            time.sleep(3)
        raise SystemExit("Timed out waiting for file_schema_versions row")
    finally:
        proxy_process.terminate()
        proxy_process.wait(timeout=10)


if __name__ == "__main__":
    main()