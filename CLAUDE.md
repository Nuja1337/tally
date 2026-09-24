# Tally

Local-first fitness and nutrition log (PWA): meals and nutrients, trackers for anything (habits, measurements, bodyweight, ratings, times), routines, workouts with per-side logging, effort and custom fields, an ideal-week calendar, one-off events (big ones stand out), progressions, a built-in exercise library (about 400, each with a page) plus your own, day tags, a goal with checkpoints. Formerly "Mettle" (2.x) and "Matbook" (1.x). Owner: Alex.

## Stack
- Client: vanilla JavaScript as classic `<script>` files under a global `MB` namespace. No build step, no bundler, no framework, no client runtime dependencies. Lives in `public/`.
- Hosting + API: one Cloudflare Worker (`worker/index.js`) with static assets from `public/`. Files are served directly (free); only `/api/*` and `POST /share` reach the Worker.
- Cloud data: Cloudflare D1 (`migrations/`). Browser data: IndexedDB via `public/js/store.js` (source of truth; all charts and analysis are computed locally).
- `package.json` exists only for dev tooling (wrangler, vitest, jsdom). The app itself never needs `npm install`.

## Files
- `public/js/ui.js` DOM helpers, dates, sheets, charts
- `public/js/i18n.js` + `public/js/i18n/<lang>.js` 8 dictionaries: en es fr pt de ja ko zh
- `public/js/exlib.js` the built-in exercise library (about 400, English, one entry per line); `public/js/exercises.js` looks entries up, links profile exercises to them (`base`, id, name or alias) and draws the muscle map
- `public/js/schema.js` data format v5: defaults, normalize, v4 upgrade (habits, measurements, rank), status grades, setup history, events, import planning, export, starter packs, field docs
- `public/js/store.js` IndexedDB store with profiles (`p/<profileId>/<path>`) and global meta (`m/<key>`)
- `public/js/sync.js` outbox and cloud sync (added in 2.2); `store.applyRemote` merges days and settings edited on two devices (`schema.mergeDoc`, base copies in `m/base:<profile>/<path>`)
- `public/js/app.js` pages (Today, Plan, Progress, Library, Settings, Get started), routing, boot
- `public/sw.js` offline cache, share target. `worker/index.js` API. `migrations/*.sql` D1 schema.

## Rules
- Every user-facing string goes through `t()` and must exist in all 8 dictionaries with identical keys and placeholders. Run `node scripts/check-i18n.mjs`. A string with a count is a `[singular, plural]` pair and is called with `{ n }`.
- Any change under `public/`: bump `VERSION` in `public/sw.js` and keep its `ASSETS` list matching the real files.
- The service worker must never cache `/api/*`.
- Statuses use the five-step scale in schema.js (`targetStatus`, `trackerGrade`, `gradeOf` for one day, `rateGrade` for rates over weeks and months) and the `--g-*` color tokens; never hard-code green/red for a status. Past days are judged with `setupOn(date)` (setup history), not the current settings; before the profile's first day (`startDate()`) it expects nothing.
- Weights and lengths: use `unit()` and `settings.units.system`; anything stored in a unit that converts must be handled in `changeSystem` (app.js). "Today" is `ui.today()`, which honors the profile's `dayStart`; never build today's date from `new Date()`.
- Changing what the server accepts or how sync merges: bump `PROTOCOL` in both `public/js/sync.js` and `worker/index.js`, so apps that have not reloaded get 426 instead of losing data.
- Events can tag a day and take it off the plan. For a date, read tags with `tagIdsOn(date, day)` or `skipDay(day, date)` and planned training with `plannedOn(date)`, never `day.tags` or `SC.plannedFor` directly.
- `Element.append`/`replaceChildren` print `null` as text: filter optional children (`h()` already skips them).
- Keep screens calm: one primary (orange) action per card, deletes inside the item's sheet (with undo), no marks against a day that is not over.
- Alex dislikes screen flash and needless re-renders. Update in place; never re-render a page while a sheet is open or an input has focus.
- The exercise library is text written for Tally: never paste text or images from other sites or datasets. After editing `exlib.js`, run `node scripts/check-exlib.mjs`. Its labels (categories, gear, muscles) go through `t()`; its write-ups stay English.
- Sheets replace each other unless opened with `{ stack: true }`; use a stacked sheet for anything opened from inside another sheet that must survive (a workout being logged, a draft).
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
- `node scripts/check-exlib.mjs` exercise library check
