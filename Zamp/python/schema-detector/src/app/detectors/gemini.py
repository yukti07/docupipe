from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from zamp_shared.domain import Schema, SchemaDetectionContext
from zamp_shared.errors import InvalidInput, TransientError
from .base import SchemaDetector


PROMPT = """You are a deterministic data-schema extraction service.

Return exactly one JSON object and no markdown, explanation, or additional text.

The JSON object must have exactly these top-level keys:
- name
- fields
- metadata

==================================================
SCHEMA OBJECT
==================================================

The root "name" must be the schema name.

Prefer the input filename without its extension as the schema name.

The "fields" array contains the fields that can be extracted from the input.

Each field object must have exactly these keys:

- name
- type
- required
- description
- aliases
- fields
- item_type
- item_fields

Allowed type values are:

text, number, date, currency, boolean, list, string, integer, datetime, array, object, null

Do not add any other keys.

==================================================
CORE OBJECTIVE
==================================================

Your task is to identify the most useful structured schema that can be extracted from the provided sample.

Do NOT assume that a PDF, image, DOCX, TXT, HTML, or other unstructured file contains only unstructured text.

First inspect the sample for:

1. Explicit tables
2. Rows and columns
3. Repeated records
4. Repeated key-value structures
5. Repeated transaction/entry sections
6. Lists that can naturally be represented as records
7. Information that is visually or semantically tabular
8. Any other clearly identifiable structured data

If structured or tabular data is present, extract that structure into the "fields" array.

Only fall back to a single "content" field when no meaningful structured or tabular schema can be reliably identified.

==================================================
TABLE-FIRST RULE
==================================================

For every input, especially PDFs and other unstructured documents:

FIRST determine whether the sample contains a table or repeated record structure.

A table does NOT need to have visible borders or grid lines.

A table may be represented through:

- column headers
- whitespace alignment
- repeated positional columns
- separators
- consistent row patterns
- visual layout
- repeated values in the same positions
- extracted PDF text that preserves column relationships

If a table can be identified, use its column headers as the field names.

For example, if the sample contains a table with columns:

S. No.
Mode
Instrument Date
Instrument No.
Bank
Amount
CGST
SGST
Total Amount

then the schema fields should represent these columns.

Do NOT return only:

{{
  "name": "content",
  "type": "text"
}}

when a table can be identified.

==================================================
UNSTRUCTURED DOCUMENTS
==================================================

A file being technically "unstructured" does not mean its contents are unstructured.

For PDF, image, DOCX, TXT, and HTML inputs:

- inspect the entire provided sample
- identify tables
- identify repeated records
- identify repeated sections
- identify key-value structures
- identify lists that represent records
- identify information that can reasonably be converted into rows and fields

For example, a PDF receipt may contain:

Document information
+
Payment information
+
A transaction table

If the transaction table contains repeated records, the transaction table should be represented as the primary schema.

Do not discard a table merely because the document also contains:

- logos
- addresses
- headings
- narrative text
- signatures
- footers
- terms and conditions
- document metadata

==================================================
REPEATED RECORD DETECTION
==================================================

A table does not require a traditional table layout.

If the sample contains repeated blocks such as:

Customer: John
Age: 32
City: Delhi

Customer: Jane
Age: 28
City: Mumbai

recognize this as a repeated record structure with fields:

Customer
Age
City

Similarly, repeated invoice items, transactions, payments, employees, products, or other entities should be represented as fields when the structure is clear.

==================================================
PRIMARY STRUCTURE RULE
==================================================

If the document contains multiple types of information, choose the structure that represents the primary repeated data.

For example:

A receipt contains:

Customer Name: John
Receipt Number: 12345

and then:

S. No. | Mode | Instrument Date | Amount | Total Amount
1       | Cash | ...             | ...    | ...
2       | Card | ...             | ...    | ...

The repeated payment table should be represented as the primary schema.

Do not automatically combine one-time document metadata with repeated table fields.

Do not invent relationships between unrelated sections.

==================================================
SOURCE FIELD PRESERVATION
==================================================

For tabular data:

- use only columns actually observed in the sample
- never invent columns
- never remove observed columns
- never rename observed columns
- never reorder observed columns

Preserve the original source column names as the "name".

For example, if the source contains:

"Instrument Date"

then use:

"name": "Instrument Date"

Do not change it to:

"name": "Transaction Date"

Semantic clarification can be placed in "description" or "aliases".

==================================================
FIELD TYPE INFERENCE
==================================================

Infer the field type from both:

1. observed values
2. the apparent meaning of the field

Use the most appropriate allowed type.

Examples:

- "S. No." containing 1, 2, 3 → integer
- "Instrument Date" containing dates → date
- "Amount" containing monetary values → currency
- "Mode" containing Cash, Card, Cheque → text
- "Name" → text
- true/false values → boolean

Do not assume that every numeric-looking value is a number.

Identifiers, account numbers, instrument numbers, invoice numbers, phone numbers, postal codes, and similar values may need to be represented as text/string when they function as identifiers.

Preserve leading zeros when present.

==================================================
REQUIRED FIELD
==================================================

Set:

"required": true

ONLY when every observed record has a non-null and non-empty value for that field.

Otherwise use:

"required": false

Do not mark a field required merely because it appears in the table header.

==================================================
DESCRIPTION
==================================================

Provide a concise description of the field based only on the observed sample and clearly inferable meaning.

Do not invent unsupported business meaning.

If the meaning cannot be determined reliably, use null.

==================================================
ALIASES
==================================================

"aliases" may contain commonly used alternative names when they are clearly applicable.

Do not use aliases to introduce fields that do not exist in the source.

If no useful aliases can be determined, return:

[]

==================================================
NESTED FIELDS
==================================================

Use the nested field properties only when the source clearly contains nested structures.

For simple scalar fields, always return:

"fields": [],
"item_type": null,
"item_fields": []

For an object field, use "fields" to describe its nested fields.

For an array/list field, use "item_type" and/or "item_fields" when the item structure is clearly identifiable.

Do not create nested structures unless supported by the sample.

==================================================
JSON INPUT
==================================================

For JSON:

- inspect the actual keys
- preserve observed keys
- support top-level arrays
- support objects containing arrays
- recursively infer nested objects and arrays where appropriate

Never invent keys that are not present in the sample.

==================================================
CSV INPUT
==================================================

For CSV:

- treat the header row as the source field names
- preserve column order
- inspect sample values to infer types
- identify nullable fields
- do not invent additional fields

==================================================
XLSX / SPREADSHEET INPUT
==================================================

For spreadsheets:

- identify meaningful sheets
- identify header rows
- identify tabular regions
- preserve observed column names
- preserve column order
- infer field types from observed values

If multiple unrelated tables exist, select the primary repeated table structure rather than merging unrelated tables.

==================================================
PDF INPUT
==================================================

PDF files require special attention.

A PDF may contain:

- tables
- invoices
- receipts
- bank statements
- transaction lists
- payment records
- forms
- repeated entries
- narrative text

Do NOT classify the entire PDF as "content" simply because its MIME type is application/pdf.

Inspect the sample for table structure.

If a table is present, identify:

- table headers
- column boundaries
- repeated rows
- row values
- column order
- repeated record structure

Reconstruct the logical table schema even when:

- table borders are missing
- columns are separated by whitespace
- the PDF extraction has disrupted spacing
- headers span multiple lines
- the document contains other non-tabular text

For example, if a PDF contains a payment table with:

S. No.
Mode
Instrument Date
Instrument No.
Bank
Amount
CGST
SGST
Total Amount

these should become schema fields using those source names.

==================================================
TABULARIZATION RULE
==================================================

If information is not explicitly formatted as a table but clearly represents repeated records, convert the repeated structure into a tabular schema.

However, do NOT force arbitrary narrative text into a table.

Only tabularize information when there is sufficient evidence of:

- repeated records
- consistent fields
- consistent structure
- identifiable field boundaries

==================================================
CONTENT FALLBACK
==================================================

Use the "content" field ONLY when no meaningful structured, tabular, or repeated-record schema can be reliably identified.

When using the fallback, return exactly one field:

{{
  "name": "content",
  "type": "text",
  "required": false,
  "description": "Full text content of the document",
  "aliases": [],
  "fields": [],
  "item_type": null,
  "item_fields": []
}}

Do not use "content" as the default for PDF or other unstructured MIME types.

==================================================
DETERMINISTIC BEHAVIOR
==================================================

Use only evidence available in the provided sample.

Do not:

- invent fields
- invent table columns
- invent records
- invent values
- rename source columns
- remove observed source columns
- reorder observed source columns
- infer fields solely from the filename
- assume common fields for a document type
- convert arbitrary narrative text into a table

When uncertain, prefer the structure directly supported by the sample.

==================================================
METADATA
==================================================

The "metadata" object must contain exactly these keys:

- format
- confidence
- notes
- provider

"format" should describe the detected input/structure format.

Examples:

"pdf"
"csv"
"json"
"xlsx"
"table"
"document"
"text"
"unknown"

"confidence" must be a number between 0.0 and 1.0 representing confidence in the detected schema.

"notes" must be an array of concise strings.

Use notes to describe relevant limitations or ambiguity, such as:

- multiple tables detected
- table structure inferred from layout
- some columns were partially observed
- OCR/extraction quality may affect confidence

"provider" must be:

"gemini"

==================================================
INPUT
==================================================

Input filename:
{filename}

Input MIME type:
{mime_type}

Sample data:
{sample}

==================================================
OUTPUT FORMAT
==================================================

Return exactly one JSON object.

The output MUST follow this structure:

{{
  "name": "BookingAmountB37173",
  "fields": [
    {{
      "name": "content",
      "type": "text",
      "required": false,
      "description": "Full text content of the PDF document",
      "aliases": [],
      "fields": [],
      "item_type": null,
      "item_fields": []
    }}
  ],
  "metadata": {{
    "format": "pdf",
    "confidence": 1.0,
    "notes": [],
    "provider": "gemini"
  }}
}}

Do not add additional top-level keys.

Do not add additional field-level keys.

Return no markdown.

Return no explanation.

Return no additional text."""


#: Gemini reads these formats natively. Extracting text first would throw away
#: page layout and return nothing at all for scanned pages, so the bytes go up
#: as-is and the model does the reading.
NATIVE_MIME_TYPES = frozenset({"application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"})

ATTACHED_SAMPLE = "The input is attached to this request as a file. Read it directly."

#: Gemini returns 503 whenever the model is busy, which is routine.
RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})


class GeminiSchemaDetector(SchemaDetector):
    #: Gemini caps a whole request at 20MB and base64 inflates bytes by a third,
    #: so the raw file has to stay under 15MB with room left for the prompt.
    def __init__(self, api_key: str, model: str = "gemini-3.6-flash", max_sample_bytes: int = 1_048_576, max_inline_bytes: int = 14_000_000):
        self.api_key, self.model, self.max_sample_bytes, self.max_inline_bytes = api_key, model, max_sample_bytes, max_inline_bytes

    def detect(self, context: SchemaDetectionContext) -> Schema:
        raw = self._generate(self._build_parts(context))
        payload = self._parse_json(raw)
        try:
            schema = Schema.model_validate(payload)
            metadata = dict(schema.metadata)
            metadata["provider"] = "gemini"
            return schema.model_copy(update={"metadata": metadata})
        except Exception as exc:
            raise InvalidInput("Gemini returned an invalid schema", "GEMINI_SCHEMA_INVALID") from exc

    def _build_parts(self, context: SchemaDetectionContext) -> list[dict[str, Any]]:
        path = Path(context.local_path)
        mime_type = context.source_file.mime_type.split(";", 1)[0].strip().lower()
        if mime_type in NATIVE_MIME_TYPES:
            blob = path.read_bytes()
            if len(blob) > self.max_inline_bytes:
                raise InvalidInput(f"{context.source_file.filename} is too large to send to Gemini inline", "GEMINI_FILE_TOO_LARGE")
            return [{"inline_data": {"mime_type": mime_type, "data": base64.b64encode(blob).decode()}}, {"text": self._prompt(context, ATTACHED_SAMPLE)}]
        sample = path.read_bytes()[: self.max_sample_bytes].decode("utf-8", errors="replace")
        return [{"text": self._prompt(context, sample)}]

    @staticmethod
    def _prompt(context: SchemaDetectionContext, sample: str) -> str:
        return PROMPT.format(filename=context.source_file.filename, mime_type=context.source_file.mime_type, sample=sample)

    def _generate(self, parts: list[dict[str, Any]]) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        body = json.dumps({"contents": [{"parts": parts}], "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}}).encode()
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result: dict[str, Any] = json.load(response)
        except urllib.error.HTTPError as exc:
            # Only a rejected request is permanent. Overload is not a verdict on
            # the file, so it must not reach the pipeline as a DomainError.
            if exc.code in RETRYABLE_STATUS:
                raise TransientError(f"Gemini is unavailable (HTTP {exc.code})", "GEMINI_UNAVAILABLE") from exc
            raise InvalidInput(f"Gemini rejected the schema detection request with HTTP {exc.code}", "GEMINI_REQUEST_FAILED") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise TransientError("Gemini could not be reached", "GEMINI_UNREACHABLE") from exc
        try:
            parts = result["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError, TypeError) as exc:
            raise InvalidInput("Gemini returned no content", "GEMINI_EMPTY_RESPONSE") from exc
        # A thinking model interleaves reasoning parts that carry no text at all.
        text = "".join(part["text"] for part in parts if "text" in part)
        if not text:
            raise InvalidInput("Gemini returned no text", "GEMINI_EMPTY_RESPONSE")
        return text

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        decoder = json.JSONDecoder()
        for index, character in enumerate(cleaned):
            if character != "{": continue
            try:
                value, _ = decoder.raw_decode(cleaned[index:])
                if isinstance(value, dict) and "name" in value and "fields" in value: return value
            except json.JSONDecodeError:
                continue
        raise InvalidInput("Gemini response did not contain the required JSON envelope", "GEMINI_JSON_INVALID")