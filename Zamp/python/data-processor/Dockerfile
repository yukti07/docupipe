FROM python:3.12-slim
WORKDIR /app
COPY shared /app/shared
COPY prompts /app/prompts
COPY data-processor/requirements.txt /app/data-processor/requirements.txt
RUN pip install --no-cache-dir /app/shared -r /app/data-processor/requirements.txt
COPY data-processor/src /app/src
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app/src
# Shell form so Cloud Run's injected $PORT is honoured; 8080 is the local default.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
