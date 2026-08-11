# LatestNotification Audit & Migration Guide (Chunk 0)

This audit documents every consumer of the legacy `LatestNotification` MongoDB model prior to deprecation and transition to `RawEvent` + `LatestJob`.

---

## 1. File Inventory of `LatestNotification` Usage

| File Path | Role | Description / Endpoints |
|---|---|---|
| `src/models/LatestNotification.js` | Mongoose Schema | Model definition for `latestnotifications` collection |
| `src/controllers/latestNotificationController.js` | Controller | Handles legacy webhooks and GET list APIs |
| `src/service/latestNotificationService.js` | Service | Business logic for legacy webhook parsing & notification saving |
| `src/workers/webhook.worker.js` | BullMQ Worker | Legacy queue worker executing `latestNotificationService` |
| `src/routes/webhook.routes.js` | Express Routes | Exposes `/api/webhook/change`, `/api/webhook/list`, `/api/webhook/slug/:slug` |
| `src/scripts/normalizeLatestNotificationCategories.js` | Script | Utility script normalizing categories |

---

## 2. Legacy Endpoint Mapping & Migration Plan

### 1. `POST /api/webhook/change`
- **Legacy Behavior**: Saves directly to `LatestNotification` via `webhook.worker.js`.
- **New Pipeline Behavior**: Creates idempotent `RawEvent`, fetches HTML snapshot to R2, runs Stage 1–6 pipeline (`pipeline-match` $\rightarrow$ `pipeline-pdf` $\rightarrow$ `pipeline-text` $\rightarrow$ `pipeline-ai` $\rightarrow$ `pipeline-validate` $\rightarrow$ `pipeline-publish`).
- **Migration Action**: Controlled by environment flag `USE_LEGACY_WEBHOOK=false`. Set `USE_LEGACY_WEBHOOK=false` in `.env` to bypass legacy `LatestNotification` writes.

### 2. `GET /api/webhook/list`
- **Legacy Behavior**: Returns paginated `LatestNotification` documents.
- **New Pipeline Replacement**: `GET /api/pipeline/events` returns paginated `RawEvent` records; published notifications live in `LatestJob` (`GET /api/latest-jobs`).
- **Migration Action**: Keep read-only until frontend references update to `/api/latest-jobs`.

### 3. `GET /api/webhook/slug/:slug` & `GET /api/webhook/sitemap`
- **Legacy Behavior**: Fetches single notification by slug / builds sitemap.
- **New Pipeline Replacement**: `GET /api/latest-jobs/:slug` and `/api/latest-jobs/sitemap`.

---

## 3. Deprecation Checklist

- [x] Create `RawEvent` model and pipeline architecture (Chunks 1–6)
- [x] Add `USE_LEGACY_WEBHOOK` env toggle
- [x] Verify pipeline output publishes to `LatestJob` model
- [ ] Set `USE_LEGACY_WEBHOOK=false` in production `.env`
- [ ] Mark `@deprecated` in `src/models/LatestNotification.js` docstring
