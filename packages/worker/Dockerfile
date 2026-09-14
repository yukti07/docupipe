# One image, two roles (§26). SERVICE_ROLE selects the processor at startup;
# nothing about the build differs between the inspect and convert services.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the whole tree.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

# Never run as root. Cloud Run does not require it, and there is no reason to
# hand a container that reaches a database and a bucket any more than it needs.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin worker \
 && mkdir -p /var/quarry/storage \
 && chown -R worker:worker /app /var/quarry
USER worker

# Cloud Run sets PORT. The default matches it so `docker run` behaves the same.
ENV PORT=8080
EXPOSE 8080

# Single worker process: concurrency is 1 at the Cloud Run level (§34), the
# processor is CPU-bound, and each request holds a database connection.
CMD exec uvicorn src.main:app \
      --host 0.0.0.0 \
      --port ${PORT} \
      --workers 1 \
      --timeout-keep-alive 75 \
      --no-access-log
