"""Approve the detected schema, trigger conversion, and print the run result."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

import psycopg


PROJECT_ID = "project-cf6fd144-baf2-463b-9cd"
TOPIC = "convert-requested"
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
    ).replace("postgresql+psycopg://", "postgresql://", 1)


def publish(request_id: str, file_id: str, run_id: str, schema_version_id: str) -> str:
    payload = json.dumps({
        "eventType": "PROCESSING_REQUESTED",
        "requestId": request_id,
        "fileId": file_id,
        "processingRunId": run_id,
        "fileSchemaVersionId": schema_version_id,
    }, separators=(",", ":"))
    result = subprocess.run(
        gcloud_command("pubsub", "topics", "publish", TOPIC, f"--project={PROJECT_ID}", f"--message={payload}"),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", default="req_e2emu2wtxxp")
    parser.add_argument("--file-id", default="file_PcMpSbiqMck")
    parser.add_argument("--user-id", default="usr_e2e1789491157261ABCDEFGH")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--port", type=int, default=5434)
    parser.add_argument("--wait-seconds", type=int, default=180)
    args = parser.parse_args()
    run_id = args.run_id or f"run_{args.request_id}_conversion"

    proxy = Path(os.getenv("TEMP", ".")) / "cloud-sql-proxy.exe"
    if not proxy.exists():
        raise SystemExit(f"Cloud SQL proxy not found at {proxy}")
    proxy_process = subprocess.Popen([str(proxy), f"--port={args.port}", INSTANCE])
    try:
        url = proxy_url(database_url(), args.port)
        with psycopg.connect(url, connect_timeout=15) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT user_id FROM requests WHERE id = %s", (args.request_id,))
                request_user = cursor.fetchone()
                if not request_user or request_user[0] != args.user_id:
                    raise SystemExit("Request/user_id mismatch or request was not found")
                cursor.execute(
                    """
                    SELECT id, status::text, version, fields, schema_metadata
                    FROM file_schema_versions
                    WHERE request_id = %s AND file_id = %s
                    ORDER BY version DESC, created_at DESC
                    LIMIT 1
                    """,
                    (args.request_id, args.file_id),
                )
                schema = cursor.fetchone()
                if not schema:
                    raise SystemExit("No detected schema found for the request/file")
                schema_id, status, version, fields, metadata = schema
                if status == "READY_FOR_REVIEW":
                    approved_id = str(uuid.uuid4())
                    cursor.execute(
                        """
                        INSERT INTO file_schema_versions
                                     (id, file_schema_id, request_id, file_id, version, status, fields, schema_metadata, source, created_at)
                        SELECT %s, file_schema_id, request_id, file_id, version + 1,
                                         'APPROVED', fields, schema_metadata, 'USER_APPROVED', now()
                        FROM file_schema_versions WHERE id = %s
                        RETURNING id, version
                        """,
                        (approved_id, schema_id),
                    )
                    schema_id, version = cursor.fetchone()
                elif status != "APPROVED":
                    raise SystemExit(f"Latest schema is not convertible: {status}")
                cursor.execute(
                    """
                    INSERT INTO processing_runs
                        (id, request_id, file_id, file_schema_version_id, status,
                         records_total, records_processed, records_failed, llm_calls, llm_repairs)
                    VALUES (%s, %s, %s, %s, 'PENDING', 0, 0, 0, 0, 0)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (run_id, args.request_id, args.file_id, schema_id),
                )

        print(f"Approved schema version: {schema_id} (version {version})")
        print(f"Published conversion: {publish(args.request_id, args.file_id, run_id, schema_id)}")
        deadline = time.monotonic() + args.wait_seconds
        while time.monotonic() < deadline:
            with psycopg.connect(url, connect_timeout=15) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT id, status::text, records_total, records_processed, records_failed, error_code, error_message FROM processing_runs WHERE id = %s",
                        (run_id,),
                    )
                    result = cursor.fetchone()
            if result and result[1] in {"COMPLETED", "FAILED"}:
                print(json.dumps(dict(zip(["id", "status", "records_total", "records_processed", "records_failed", "error_code", "error_message"], result, strict=True)), indent=2))
                return
            time.sleep(5)
        raise SystemExit(f"Timed out waiting for processing run {run_id}")
    finally:
        proxy_process.terminate()
        proxy_process.wait(timeout=10)


if __name__ == "__main__":
    main()