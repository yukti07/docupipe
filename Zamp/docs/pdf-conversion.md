# PDF conversion

PDFs use Gemini for both schema detection and record extraction. Enable Gemini
and configure its API key/model on both workers. `ZAMP_SCHEMA_MAX_PDF_BYTES`
defaults to 14,000,000 bytes; larger files are rejected before the extraction
request. Files are sent intact as inline `application/pdf` data, including scanned
pages. Generic upload MIME types fall back to the `.pdf` extension.

The processing pipeline loads the schema version named in the event from
`file_schema_versions` and requires it to be approved. If the event names no
version, it snapshots the current database schema as approved, following the
existing Convert-button flow. The PDF reader receives that schema and the file
downloaded from GCS. It sends both to Gemini with
`python/prompts/processing/records_from_pdf.txt`; it does not infer another schema.
The prompt covers every page, repeated table headers, document versus line-item
records, nested fields, nulls, types, and instructions embedded in the document.

The existing pipeline maps, coerces, and validates returned records and persists
valid records and errors separately. Empty/malformed responses and exhausted
output budgets fail explicitly. This implementation uses one model request per
PDF/table; it does not chunk large documents. The byte limit and model output
budget bound supported document size. Model extraction accuracy still depends
on the document and the approved schema.

## Tests

From the repository root:

```powershell
python -m pytest Zamp/tests/test_pdf_support.py Zamp/tests/test_detector_contract.py Zamp/tests/test_processing_pipeline_worksheets.py Zamp/tests/test_currency_coercion.py -q
```

`scripts/pdf_cloud_roundtrip.py` is an opt-in live test of the three-page invoice
fixture. It uses gcloud credentials and Secret Manager, the Cloud SQL Python
Connector with pg8000, real GCS, and real Pub/Sub. It publishes detection, waits
for the database schema, stores an edited/approved invoice schema, then publishes
conversion with that exact version. It verifies both invoices' persisted values,
zero record errors, and the GCS summary. It creates uniquely named test data and
retains it for inspection. It does not create/deploy services or subscriptions.

```powershell
python Zamp/scripts/pdf_cloud_roundtrip.py --probe
python Zamp/scripts/pdf_cloud_roundtrip.py --conversion-topic YOUR_TEST_TOPIC
```

Use `--seed-schema` to isolate conversion: the test persists and approves the
fixture schema in Cloud SQL without calling the detector. Publishing uses the
authenticated Pub/Sub REST API to preserve JSON exactly across Windows shells.

Point the conversion topic's authenticated push subscription at the revision
containing the PDF reader. A tagged revision with no production traffic allows
testing without changing which revision serves the existing conversion topic.
The default result is `.local-storage/pdf-cloud-result.json`; it contains no
credentials. The test fixture's expected values are checked after extraction and
are never included in the Gemini prompt.
