from __future__ import annotations

import json
import logging
import random
import time
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

from .domain import Schema, SourceFile
from .errors import InvalidInput, TransientError

log = logging.getLogger(__name__)

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


#: Gemini answers 429 on quota and 5xx whenever the model is busy, which is
#: routine rather than a verdict on the file. Everything else it rejects is a
#: statement about this request and will be rejected again on redelivery.
RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})

#: Enough of the provider's own words to debug with, bounded so a runaway body
#: cannot fill the log.
MAX_LOGGED_ERROR_CHARS = 512


class GeminiClient:
    """The only place in the repo that speaks HTTP to Gemini.

    Detectors hand it already-built parts — text, inline images, or both — and
    get back the raw response text. It knows nothing about schemas, so the
    parsing rules live in one place instead of once per detector.

    The API key travels in `x-goog-api-key`, never in the query string. A key
    in the URL reaches logs through `HTTPError.url`, exception reprs and proxy
    access logs, none of which are under this class's control.
    """

    def __init__(self, api_key: str, model: str = "gemini-3.6-flash", *, temperature: float = 0.0,
                 max_output_tokens: int = 8192, max_retries: int = 3, timeout_seconds: int = 60,
                 sleep: Callable[[float], None] = time.sleep):
        self.api_key, self.model = api_key, model
        self.temperature, self.max_output_tokens = temperature, max_output_tokens
        # Clamped: a negative value would empty the attempt loop, and "no
        # request was made" is indistinguishable from "the provider is down".
        self.max_retries, self.timeout_seconds = max(0, max_retries), timeout_seconds
        self._sleep = sleep

    def generate(self, parts: list[dict[str, Any]]) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = json.dumps({
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": self.temperature,
                                 "maxOutputTokens": self.max_output_tokens,
                                 "responseMimeType": "application/json"},
        }).encode()
        headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}

        last: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                request = urllib.request.Request(url, data=body, headers=headers, method="POST")
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    payload = json.load(response)
            except json.JSONDecodeError as exc:
                # A 200 carrying something other than JSON is an intermediary
                # talking, not the model. Retried like a 5xx, because letting a
                # ValueError escape settles the file as `internal` forever.
                log.warning("gemini returned a non-json body", extra={"model": self.model,
                                                                       "attempt": attempt + 1})
                last = exc
            except urllib.error.HTTPError as exc:
                detail = self._scrub(self._read_error_body(exc))
                log.warning("gemini request failed", extra={"model": self.model, "status": exc.code,
                                                            "attempt": attempt + 1, "detail": detail})
                if exc.code not in RETRYABLE_STATUS:
                    # A rejected request is permanent: bad key, bad model name,
                    # payload the API will not take. Retrying spends quota to
                    # arrive at the same answer.
                    raise InvalidInput(f"Gemini rejected the schema detection request with HTTP {exc.code}",
                                       "GEMINI_REQUEST_FAILED") from exc
                last = exc
            except (urllib.error.URLError, TimeoutError) as exc:
                log.warning("gemini unreachable", extra={"model": self.model, "attempt": attempt + 1,
                                                          "detail": self._scrub(str(exc))})
                last = exc
            else:
                return self._extract_text(payload)

            if attempt < self.max_retries:
                self._sleep(self._backoff(attempt))

        status = getattr(last, "code", None)
        if status is not None:
            raise TransientError(f"Gemini is unavailable (HTTP {status})", "GEMINI_UNAVAILABLE") from last
        raise TransientError("Gemini could not be reached", "GEMINI_UNREACHABLE") from last

    @staticmethod
    def _backoff(attempt: int) -> float:
        """Exponential, with full jitter and a ceiling.

        Jitter matters more than the curve here: every worker retrying a shared
        quota on the same schedule re-collides at each step.
        """
        return random.uniform(0.0, min(8.0, 0.5 * (2 ** attempt)))

    @staticmethod
    def _read_error_body(exc: urllib.error.HTTPError) -> str:
        try:
            return exc.read().decode("utf-8", errors="replace")[:MAX_LOGGED_ERROR_CHARS]
        except Exception:  # noqa: BLE001
            return ""

    def _scrub(self, text: str) -> str:
        return text.replace(self.api_key, "<redacted>") if self.api_key else text

    @staticmethod
    def _extract_text(result: dict[str, Any]) -> str:
        try:
            candidate = result["candidates"][0]
            parts = candidate["content"]["parts"]
        except (KeyError, IndexError, TypeError) as exc:
            raise InvalidInput("Gemini returned no content", "GEMINI_EMPTY_RESPONSE") from exc

        # Why the model stopped decides what the caller should be told. Without
        # this, a truncated answer reaches the parser as malformed JSON and is
        # reported as an unparseable response, which sends the reader hunting
        # for a prompt bug instead of raising the output budget.
        reason = candidate.get("finishReason")
        if reason == "MAX_TOKENS":
            raise InvalidInput("Gemini ran out of output budget before finishing the response",
                               "GEMINI_RESPONSE_TRUNCATED")
        if reason not in (None, "STOP"):
            raise InvalidInput(f"Gemini stopped early ({reason})", "GEMINI_REQUEST_REFUSED")
        # A thinking model interleaves reasoning parts that carry no text at all.
        text = "".join(part["text"] for part in parts if "text" in part)
        if not text:
            raise InvalidInput("Gemini returned no text", "GEMINI_EMPTY_RESPONSE")
        return text


class LLMService:
    """Optional boundary. Deterministic MIME paths stay valid when it is disabled or unavailable."""
    def __init__(self, client: LLMClient | None = None, enabled: bool = False): self.client, self.enabled = client or DisabledLLMClient(), enabled
    def enhance_schema(self, source: SourceFile, schema: Schema, context: dict[str, Any]) -> Schema:
        return schema
    def validate_record(self, record: dict[str, Any], schema: Schema) -> None: return None
    def repair_record(self, record: dict[str, Any], schema: Schema) -> dict[str, Any]: return record
