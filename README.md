# Rojgaar API

Backend API for Rojgaar Suchna, built with Node.js, Express, and MongoDB.

This service powers home-page content, latest job notifications, documents, admit cards, results, FAQs, and department/body metadata. It also includes seed scripts for bootstrapping content and an R2 upload integration.

## Tech stack

- Node.js (ESM modules)
- Express 5
- MongoDB + Mongoose
- Zod (request validation)
- Multer (file upload)
- AWS SDK S3 client (Cloudflare R2 compatible)

## Project structure

```txt
src/
  app.js                 # Express app + middleware + route mounting
  server.js              # Entry point
  config/                # DB and R2 config
  controllers/           # Request handlers
  models/                # Mongoose schemas
  routes/                # API routes
  middleware/            # Validation + multer error handling
  validators/            # Zod schemas
  seeders/               # Data seed scripts
  scripts/               # Utility scripts (e.g. domain replacement)
```

## Prerequisites

- Node.js 18+
- MongoDB instance (local or remote)

## Environment variables

Create a `.env` file in the project root:

```env
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB=rojaar

R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name

OLD_URL=https://old-domain.example
NEW_URL=https://new-domain.example
BATCH_SIZE=500
```

Notes:
- `MONGO_URI` is required for DB connection.
- `R2_*` values are required only if you use upload endpoints/features.
- `OLD_URL`, `NEW_URL`, `BATCH_SIZE` are used by the `replace-domain` script.

## Installation

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Production mode:

```bash
npm start
```

API base URL:

```txt
http://localhost:5000/api
```

## Available scripts

- `npm run dev` - Start server with nodemon
- `npm start` - Start server with node
- `npm run seed` - Run seeders from `src/seeders/index.js`
- `npm run replace-domain` - Bulk replace old domain strings in DB content

## API overview

Mounted in `src/routes/index.js`:

- `/api/home`
- `/api/answer-keys`
- `/api/documents`
- `/api/admit-cards`
- `/api/results`
- `/api/job-notifications`
- `/api/admissions`
- `/api/faqs`
- `/api/department`
- `/api/bodies`

For full route/method details, check files inside `src/routes/`.

## Seeding workflow

Seed runner: `src/seeders/index.js`

Important:
- Seeder calls are intentionally toggled in code (many are commented out).
- Uncomment the seeders you want to run, then execute:

```bash
npm run seed
```

## File uploads

- `multer` handles incoming files.
- Upload utility/controller pushes files to Cloudflare R2 via S3-compatible API.
- Ensure `R2_ENDPOINT`, credentials, and bucket name are configured before testing uploads.

## Developer notes

- The codebase uses ESM (`"type": "module"` in `package.json`).
- Most request validation is handled via Zod validators + middleware.
- Latest job creation can trigger home re-seeding to keep home sections fresh.

## Troubleshooting

- `MongoDB connection error`: verify `MONGO_URI` and network access.
- Empty API responses after seed: confirm the desired seeders are uncommented in `src/seeders/index.js`.
- Upload failures: verify `R2_*` env vars and bucket permissions.

---

If you are onboarding new contributors, start from:
1. `src/app.js`
2. `src/routes/index.js`
3. One feature module end-to-end (route -> controller -> model -> validator)
