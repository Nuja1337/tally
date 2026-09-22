# Tally

Local-first fitness and nutrition log (PWA): meals, habits, routines, workouts with per-side logging, an ideal-week calendar, an exercise library, bodyweight and measurements. Formerly "Mettle" (2.x) and "Matbook" (1.x). Owner: Alex.

## Stack
- Client: vanilla JavaScript as classic `<script>` files under a global `MB` namespace. No build step, no bundler, no framework, no client runtime dependencies. Lives in `public/`.
- Hosting + API: one Cloudflare Worker (`worker/index.js`) with static assets from `public/`. Files are served directly (free); only `/api/*` and `POST /share` reach the Worker.
- Cloud data: Cloudflare D1 (`migrations/`). Browser data: IndexedDB via `public/js/store.js` (source of truth; all charts and analysis are computed locally).
- `package.json` exists only for dev tooling (wrangler, vitest, jsdom). The app itself never needs `npm install`.

## Files
- `public/js/ui.js` DOM helpers, dates, sheets, charts
- `public/js/i18n.js` + `public/js/i18n/<lang>.js` 8 dictionaries: en es fr pt de ja ko zh
- `public/js/schema.js` data format v4: defaults, normalize, import planning, export, starter profile, field docs
- `public/js/store.js` IndexedDB store with profiles (`p/<profileId>/<path>`) and global meta (`m/<key>`)
- `public/js/sync.js` outbox and cloud sync (added in 2.2)
- `public/js/app.js` pages (Today, Plan, Progress, Library, Settings, Get started), routing, boot
- `public/sw.js` offline cache, share target. `worker/index.js` API. `migrations/*.sql` D1 schema.

## Rules
- Every user-facing string goes through `t()` and must exist in all 8 dictionaries with identical keys and placeholders. Run `node scripts/check-i18n.mjs`.
- Any change under `public/`: bump `VERSION` in `public/sw.js` and keep its `ASSETS` list matching the real files.
- The service worker must never cache `/api/*`.
- Alex dislikes screen flash and needless re-renders. Update in place; never re-render a page while a sheet is open or an input has focus.
- Data format changes: update `DOCS` in `schema.js` and the README format section together; keep old files importable.
- Never commit personal data. `private/` is gitignored and holds Alex's profile export.
- UI copy is short and plain. Replies to Alex: concise, organized, say what changed and what he must do.
- Verify Cloudflare config keys and limits against current docs before relying on memory; they change often.

## Commands
- `npx wrangler dev` run app + API locally (local D1)
- `npm test` worker tests and client smoke tests
- `npx wrangler d1 migrations apply tally --local` / `--remote`
- `npx wrangler deploy` publish
- `node scripts/check-i18n.mjs` dictionary parity
