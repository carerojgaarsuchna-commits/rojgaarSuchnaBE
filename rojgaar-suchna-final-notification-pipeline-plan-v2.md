# Rojgaar Suchna — Final Notification Pipeline Architecture & Implementation Plan

**Status:** Final plan for architecture lock
**Scope:** ChangeDetection webhook → validated → reviewed/published `LatestJob`
**Target scale:** 200+ sites initially; designed for 1,500–2,000+ government websites

## 1. Objective

Build a reliable, scalable notification-ingestion pipeline that turns meaningful government-website changes into accurate, candidate-friendly Rojgaar Suchna job notifications.

Core requirements:

- ChangeDetection.io is the monitoring layer.
- Never re-fetch the monitored government page from the backend.
- Capture the ChangeDetection HTML snapshot immediately on webhook receipt.
- Store the HTML as a durable artifact.
- Use deterministic matching first; use an LLM only for ambiguous matching.
- Discover and verify the official PDF deterministically; never trust an LLM-generated URL.
- Download and checksum the PDF.
- Extract PDF text first.
- Use a quality gate to decide whether extracted text is usable.
- Use a vision-capable LLM only when extraction fails or quality is poor.
- Use one normal document-analysis LLM call to produce structured notification data and the article.
- Enforce backend validation as a hard gate.
- Preserve a complete audit trail.
- Make processing stages independently retryable.
- Publish validated content into `LatestJob`.

## 2. Locked Architecture Principles

### 2.1 Monitoring

```text
Government Website
      ↓
ChangeDetection.io
      ↓
Webhook
      ↓
Backend
```

The backend does not continuously crawl monitored government pages.

### 2.2 No monitored-page fallback fetch

The backend retrieves HTML from the ChangeDetection instance, conceptually:

```text
GET /api/v1/watch/{watch_uuid}/history/latest?html=1
```

There is no direct government-page fallback. If the ChangeDetection snapshot cannot be obtained:

```text
html_unavailable → pending_review
```

### 2.3 Immediate HTML capture

The synchronous webhook section is intentionally small:

```text
Authenticate
  ↓
Idempotency
  ↓
Create raw_event
  ↓
Retrieve ChangeDetection HTML
  ↓
Persist HTML
  ↓
Enqueue matching
  ↓
Return webhook response
```

No PDF processing, matching, AI, or article generation happens synchronously.

### 2.4 Webhook idempotency

Idempotency occurs before expensive synchronous work. Repeated ChangeDetection webhooks must not create duplicate pipeline runs.

```text
Webhook
  ↓
Authenticate
  ↓
Build event fingerprint
  ↓
Existing event?
 ┌───────┴───────┐
 YES             NO
 ↓                ↓
Return           Create raw_event
```

### 2.5 Snapshot consistency

Synchronous retrieval reduces snapshot rotation risk but does not mathematically guarantee that `latest` is the triggering snapshot. Store and compare:

- webhook `change_datetime`;
- snapshot timestamp, when available;
- backend retrieval timestamp.

If the timestamps are clearly inconsistent:

```text
html_snapshot_mismatch → pending_review
```

No government-site fallback is allowed.

### Hard timeout

The complete synchronous webhook step has a hard total time budget of approximately **3–5 seconds**, including bounded retries for the ChangeDetection HTML request.

If the HTML cannot be retrieved within that budget:

```text
html_unavailable
        ↓
pending_review
```

The webhook handler must not wait indefinitely for a slow ChangeDetection instance.


## 3. Final End-to-End Flow

```text
Government Website
        ↓
ChangeDetection.io
        ↓
POST /api/webhook/change
        ↓
Webhook Authentication
        ↓
Noise Filter
        ↓
Idempotency Check
        ↓
raw_events
        ↓
Immediate ChangeDetection HTML Retrieval
        ↓
HTML → R2
        ↓
pipeline-match
        ↓
Deterministic Notification Matching
        │
        ├── High confidence → MATCHED
        └── Ambiguous → bounded LLM disambiguation
        ↓
pipeline-pdf
        ↓
Deterministic PDF Discovery
        ↓
PDF Download + Verification
        ↓
PDF → R2
        ↓
pipeline-text
        ↓
PDF Text Extraction
        ↓
Quality Gate
        │
        ├── PASS → Text LLM
        └── FAIL → Vision LLM
        ↓
Structured Notification + Article
        ↓
Backend Validation
        ↓
Pending Review
        ↓
Admin Approval
        ↓
pipeline-publish
        ↓
LatestJob
```

## 4. Processing Stages

### Stage 0 — Webhook Receiver

Responsibilities:

- authenticate ChangeDetection;
- parse payload;
- cheap noise filtering;
- event fingerprint/idempotency;
- create `raw_events`;
- retrieve ChangeDetection HTML immediately;
- persist HTML to R2;
- enqueue `pipeline-match`.

Must not download PDFs or invoke AI.

### Stage 1 — Matching

Extract notification candidates from stored HTML:

```json
{
  "title": "...",
  "href": "...",
  "dom_context": "..."
}
```

Compare candidates with `original_title`, advertisement number, keywords, URL evidence, and `diff_added` using deterministic normalization and similarity methods.

High-confidence result proceeds automatically.

Ambiguous result may use one cheap LLM disambiguation call. No LLM is used for the normal matching path.

### Stage 2 — PDF Discovery

PDF discovery is a standalone deterministic subsystem.

Candidate sources:

- direct `.pdf` links;
- relative PDF links;
- known supported document-host patterns;
- one-hop detail/landing pages.

Do not recursively crawl. Do not let the LLM invent a PDF URL.

Candidate ranking should use title/DOM proximity, filename relevance, advertisement-number relevance, and explicit download semantics.

If candidates are ambiguous, do not guess: route to review or a narrowly scoped disambiguation step.

### Stage 3 — PDF Download

Verify:

- HTTP response;
- Content-Type;
- `%PDF-` magic bytes;
- maximum size;
- redirect policy;
- SSRF restrictions.

Calculate SHA-256 and store the PDF permanently in R2.

Mongo stores PDF metadata and the R2 reference.

### Stage 4 — PDF Text Extraction

Preferred:

```text
PDF → pdf-parse → pdfjs-dist fallback
```

Distinguish:

- `extraction_failed`: parser/library failure;
- `quality_gate_failed`: extraction succeeded but content is unusable.

Both route to the vision path.

### Stage 5 — Quality Gate

Assess more than text length. Signals can include:

- character count;
- words/tokens;
- characters per page;
- printable ratio;
- garbled-character ratio;
- whitespace ratio;
- repeated garbage patterns;
- meaningful recruitment vocabulary;
- page coverage;
- language/script indicators;
- expected notification fields.

Store a score, reason, and signal details.

### Stage 6 — AI Extraction

Normal path:

```text
Good text → one LLM call → structured_notification + article
```

Vision path:

```text
Bad/failed text → PDF to vision-capable LLM → structured_notification + article
```

The LLM is a semantic document analyst, not a crawler, URL authority, dedupe engine, queue manager, or database-state authority.

### Stage 7 — Validation

Validation is a hard gate:

```text
LLM
 ↓
Parse
 ↓
Schema validation
 ↓
Business validation
 ↓
PASS / FAIL
```

Schema checks include types, enums, dates, URLs, required fields, vacancy values, and confidence values.

Business checks include consistency between structured data and article, verified PDF identity, non-fabricated advertisement numbers, source identity, sensible dates, and valid vacancy values.

Invalid output never proceeds silently to publication.

### Stage 8 — Review

Normal validated content:

```text
validation PASS → pending_review → admin approval
```

Validation failures also enter review with reasons attached.

Auto-publish is optional and should only be introduced after sufficient reliability data exists.

### Stage 9 — Publish

`PublishWorker` maps the validated structured notification and article into `LatestJob`, resolves Department/Body references, generates the slug, and stores the source-event reference.

## 5. Data Model

### `raw_events`

This is the ingestion/staging/audit anchor.

Conceptual fields:

```text
_id
watch_uuid
watch_title
watch_url
change_datetime
webhook_payload / webhook_payload_ref
status
status_history[]
dedupe_hash
html_snapshot
matched_notification
pdf
extracted_text
quality_report
ai
validation
review
published
retry
created_at
updated_at
```

Mongo stores structured metadata and references. Large artifacts are stored in R2.

### `LatestJob`

This remains the public-facing model.

Required additive changes should be limited to fields genuinely needed by the pipeline, such as:

```text
source_event_id
advertisement_no
ai.confidence
category
```

The published record must be traceable back to `raw_events`.

### `LatestNotification`

Do not immediately delete it. Before stopping its write path, audit every route, service, script, admin, and frontend consumer. Then deprecate it in place and preserve historical records.

## 6. Artifact Storage

### R2

Store:

- immutable HTML snapshot;
- official PDF;
- extracted text;
- article before publication if useful;
- large webhook payloads;
- large raw AI responses.

### MongoDB

Store:

- states;
- metadata;
- references;
- matching results;
- PDF metadata/checksum;
- quality report;
- structured notification;
- validation;
- review;
- publishing information.

Use a configurable size threshold (around 100 KB) for deciding when variable payloads should move to R2.

## 7. Queue Architecture

Use independent BullMQ queues:

```text
pipeline-match
pipeline-pdf
pipeline-text
pipeline-ai
pipeline-validate
pipeline-publish
```

There is no `pipeline-html` queue because HTML acquisition occurs immediately at webhook receipt.

Queue jobs contain only:

```json
{ "raw_event_id": "..." }
```

Never put HTML, PDF, extracted text, or large AI responses into Redis job payloads.

Each stage has independent concurrency/rate controls. PDF fetching is polite per government domain; AI concurrency is controlled by provider limits/budget.

## 8. Retry and Recovery

Retry only transient infrastructure failures:

- timeouts;
- temporary 5xx;
- network failures;
- provider rate limits;
- transient MongoDB failures.

Do not repeatedly retry business failures such as:

- PDF 404;
- PDF not found;
- ambiguous match;
- unsupported host;
- invalid content;
- business validation failure.

Use exponential backoff and jitter where appropriate.

Successful artifacts are reused. A downstream failure never re-downloads or re-extracts an already successful upstream artifact.

## 9. LLM Exception Budget

Normal path:

```text
0 matching-LLM calls
+
1 document LLM call
=
1 LLM call
```

Bounded exceptions:

- matching disambiguation: max 1;
- vision escalation after suspicious text result: max 1;
- malformed JSON reprompt: max 1;
- validation reprompt: max 1.

Worst case is approximately four calls for one problematic event. Track normal calls and exception calls separately.

## 10. Backend Authority

The backend is authoritative for:

- source identity;
- URLs;
- PDF file and checksum;
- storage references;
- timestamps;
- database IDs;
- state;
- dedupe;
- verified artifacts.

The LLM cannot override these values.

The LLM is authoritative only for semantic interpretation of the document within backend validation constraints.

## 11. State Machine

Core lifecycle:

```text
received
 ↓
html_ready
 ↓
matching
 ↓
matched
 ↓
pdf_ready
 ↓
text_extracting
 ↓
quality_gate
 ↓
ai_processing
 ↓
ai_ready
 ↓
validating
 ↓
pending_review
 ↓
publishing
 ↓
published
```

Failure/review states include:

```text
html_unavailable
html_snapshot_mismatch
match_failed
pdf_not_found
pdf_ambiguous
pdf_failed
pdf_invalid
extraction_failed
ai_failed
validation_failed
rejected
duplicate
publish_failed
```

## 12. Security

Implement:

- webhook secret validation;
- `401` for invalid webhook authentication;
- server-side ChangeDetection API credentials;
- SSRF protection;
- private-IP/localhost/metadata endpoint blocking;
- PDF size limits;
- magic-byte checks;
- redirect restrictions;
- safe file handling;
- prompt-injection-resistant prompts.

Government HTML/PDF content is untrusted data, not instructions.

## 13. Observability

Per-event information should include:

```text
raw_event_id
watch_uuid
site
stage + duration
match score + method
PDF URL + checksum
PDF size
quality score
AI path
AI model
AI latency
AI tokens/cost estimate
validation result
final state
failure reason
```

Useful dashboards:

- failure rate by site;
- PDF discovery failure rate;
- matching confidence;
- LLM fallback rate;
- vision percentage;
- exception-budget usage;
- AI cost;
- median time-to-publish;
- validation failure rate;
- duplicate rate;
- stuck events.

## 14. Scaling

Design for 200 → 1,500–2,000+ sites without prematurely introducing distributed infrastructure.

Scale stages independently. PDF acquisition remains polite per host. AI concurrency respects provider limits. At higher volume, separate HTTP and BullMQ worker processes.

## 15. Implementation Plan

### Phase -1 — Migration Audit

- Find every `LatestNotification` consumer.
- Document routes, services, workers, scripts, admin, and frontend usage.
- No behavior change.

### Phase 0 — Foundation

- Create `raw_events`.
- Implement webhook idempotency.
- Fix invalid-secret response.
- Implement immediate ChangeDetection HTML capture.
- Persist HTML in R2.
- Store snapshot metadata and consistency checks.
- Implement noise filtering.

### Phase 1 — Matching + PDF Discovery

- Build HTML candidate extraction.
- Build normalization/similarity engine.
- Build ambiguous-match handling.
- Build deterministic PDF Discovery subsystem.
- Add bounded one-hop landing-page support.
- Add candidate ranking and confidence.
- Test against ~20 real government sites.

### Phase 2 — PDF → Text → Quality Gate

- PDF download/storage/checksum.
- `pdf-parse` extraction.
- `pdfjs-dist` fallback.
- Quality gate.
- R2 text storage.

### Phase 3 — AI Text Path

- Structured output schema.
- Document-analysis prompt.
- One-call structured data + article.
- Hard schema validation.
- Business validation.
- Exception budget tracking.

### Phase 4 — Vision Path

- Vision routing.
- Suspicious-output escalation.
- Vision cost/usage metrics.

### Phase 5 — Review + Publish

- Review API/UI.
- Approval/rejection/edit workflow.
- PublishWorker.
- Department/Body resolution.
- Slug generation.
- `LatestJob` creation/update.

### Phase 6 — Hardening

- Full retry matrix.
- Dead-letter/manual replay.
- Observability dashboards.
- Failure and recovery testing.
- Duplicate webhook testing.
- Snapshot mismatch testing.

### Phase 7 — Scale

- Separate worker processes.
- Tune domain politeness.
- Tune AI concurrency.
- Consider narrow auto-publish conditions only after reliability is demonstrated.
- Deprecate legacy `LatestNotification`.

## 16. Final Locked Flow

```text
ChangeDetection
      ↓
Webhook
      ↓
Authenticate
      ↓
Idempotency
      ↓
raw_events
      ↓
Immediate ChangeDetection HTML Snapshot
      ↓
R2
      ↓
Deterministic Notification Match
      ↓
PDF Discovery
      ↓
Verified PDF
      ↓
R2
      ↓
PDF Text Extraction
      ↓
Quality Gate
   ↙          ↘
PASS          FAIL
 ↓              ↓
Text LLM     Vision LLM
   ↘          ↙
 Structured Notification
 +
 Candidate Article
      ↓
Backend Schema Validation
      ↓
Backend Business Validation
      ↓
Pending Review
      ↓
Approval
      ↓
Publish Worker
      ↓
LatestJob
```

## 17. Architecture Lock Criteria

The architecture is considered locked when the following are accepted:

- no monitored-page fallback fetch;
- webhook idempotency is mandatory;
- HTML snapshot is captured immediately and persisted durably;
- snapshot timestamp consistency is checked;
- deterministic matching is the default;
- LLM matching is only an ambiguity fallback;
- PDF discovery is deterministic and verified;
- no LLM-generated PDF URL is trusted;
- PDF text extraction precedes vision;
- quality gate determines the text/vision path;
- one normal document LLM call produces structured data + article;
- exception LLM calls are bounded and metered;
- backend validation is a hard gate;
- `raw_events` is the ingestion/audit anchor;
- `LatestJob` is the public content model;
- artifacts are reused across retries;
- large artifacts live in R2;
- queues are stage-specific;
- `LatestNotification` migration starts only after a dependency audit.

After this lock, the next design step is **data contracts**, not further architecture debate:

1. `raw_events` schema
2. HTML artifact metadata
3. matched-notification contract
4. PDF artifact metadata
5. quality-report schema
6. LLM structured-output schema
7. validation-result schema
8. BullMQ job contracts
9. state-transition rules
10. `LatestJob` field mapping

> **Diagram note:** This core lifecycle diagram is intentionally simplified. The detailed PDF states and transitions are defined in §4 (PDF discovery/download) and §16 (state machine) and take precedence when interpreting the PDF-processing sub-states.

