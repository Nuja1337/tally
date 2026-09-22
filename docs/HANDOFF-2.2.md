# Tally 2.2 handoff: rename, move to Cloudflare, add cloud sync

You are setting up Tally 2.2 for Alex. Read `CLAUDE.md` first. Work phase by phase. At each **Checkpoint**, stop, summarize in a few lines, commit, and wait for Alex's OK. Steps marked **Needs Alex** require his accounts or browser; tell him exactly what to run or click, then continue once he confirms.

## Starting point
- This folder is the Mettle 2.1 repo (unzipped from `mettle-repo.zip`): `index.html`, `styles.css`, `js/`, `sw.js`, `manifest.webmanifest`, `icons/`, `examples/`, `README.md`, `LICENSE`, `.nojekyll`.
- `private/mettle-alex.json` is Alex's personal profile (format v4). It must never be committed.
- The app works today on any static host with browser-only storage. Nothing is deployed yet and no real user data exists online.

## Goal
1. Rename the app from Mettle to Tally everywhere.
2. Host it on Cloudflare (one Worker serving static assets + a small API) instead of GitHub Pages.
3. Add optional cross-device sync: a free D1 database, sync-key auth, offline-first outbox, newest-wins merge.
4. Everything stays on free tiers with hard caps. No card, no email service, no third-party auth.

## Decisions already made (do not reopen without asking)
- Backend: Cloudflare Workers Free + D1. Not Firebase, not Supabase.
- Auth: a random sync key per profile (a "vault"), sent as a bearer token. Server stores only its SHA-256 hash. Creating a vault requires an `INVITE_CODE` secret so strangers cannot use Alex's free quota. Passkeys may come later; out of scope now.
- One vault = one local profile. Only the active profile syncs; others sync when switched to.
- Conflict rule: per document, newest `updatedAt` wins (same rule as the existing import merge). Deletes are tombstones.
- IndexedDB stays the source of truth. The app must work exactly as today when offline or unlinked.
- Out of scope: passkeys, leaderboards, notifications, background sync on iOS (not supported there anyway).

## Phase 0: tooling
- Check `node --version` (current LTS) and `git`. Create `package.json` (private, dev dependencies only: `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `jsdom`, `fake-indexeddb`). Scripts: `dev`, `test`, `deploy`.
- `.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`, `private/`, `*.log`.
- `git init -b main` if not already a repo.

## Phase 1: rename and restructure
- Move the app into `public/` (index.html, styles.css, js/, sw.js, manifest.webmanifest, icons/, examples/). Delete `.nojekyll`. README and LICENSE stay at the root.
- `grep -rni "mettle\|matbook"` and rename to Tally: `MB.APP = { id: 'tally', name: 'Tally', version: '2.2.0' }`, page title, meta and Open Graph tags, manifest `name`/`short_name`, noscript text, `styles.css` rail label, README, `examples/starter-profile.json` (`app: "tally"`), export file names (`tally-<profile>-<date>.json`).
- Storage keys: IndexedDB name `tally`, localStorage prefix `tally:` (theme and language keys too). Generalize the existing one-time migration in `store.js` so it imports from `mettle` and then `matbook` (IndexedDB and localStorage) when the new store is empty. Keep `matbook`/`mettle` only inside that migration code.
- Import must keep accepting files with `app: "mettle"` or `"matbook"`. Schema `VERSION` stays 4.
- `public/sw.js`: `VERSION = 'tally-2.2.0'`; bypass the cache for any `/api/` path (let the request go straight to the network, no caching, no offline fallback).
- Write `private/tally-alex.json`: a copy of `private/mettle-alex.json` with `app: "tally"`. Keep the original.
- Add `scripts/check-i18n.mjs`: loads all 8 dictionaries, fails on missing keys or mismatched `{placeholders}` versus English.
- Minimal `wrangler.jsonc` so `npx wrangler dev` serves `public/` (see Phase 2 for the full file).

**Checkpoint 1:** app runs under `npx wrangler dev`, reads "Tally" everywhere, existing data migrates, i18n check passes.

## Phase 2: Worker and D1
### Config (verify key names against current Cloudflare docs)
```jsonc
{
  "name": "tally",
  "main": "worker/index.js",
  "compatibility_date": "<today>",
  "assets": { "directory": "./public" },
  "d1_databases": [{ "binding": "DB", "database_name": "tally", "database_id": "<filled in Phase 4>", "migrations_dir": "migrations" }]
}
```
Hash routing means no SPA fallback is needed. Static asset requests never invoke the Worker.

### Schema: `migrations/0001_init.sql`
```sql
CREATE TABLE vaults (
  id TEXT PRIMARY KEY,            -- hex SHA-256 of the normalized sync key
  created_at INTEGER NOT NULL     -- ms since epoch
);
CREATE TABLE docs (
  vault TEXT NOT NULL,
  path TEXT NOT NULL,             -- e.g. settings/main, foods/banana, templates/x, days/2026-09-21
  body TEXT,                      -- document JSON; NULL when deleted
  updated_at INTEGER NOT NULL,    -- ms since epoch, drives newest-wins
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,           -- per-vault change number, drives delta pulls
  PRIMARY KEY (vault, path)
);
CREATE INDEX docs_vault_seq ON docs (vault, seq);
```

### API
| Route | Auth | Request | Response |
|---|---|---|---|
| `POST /api/vault` | body `invite` | `{ invite }` | `201 { key }`; `403` on a wrong invite |
| `POST /api/sync` | `Authorization: Bearer <key>` | `{ cursor, changes: [{ path, doc, updatedAt, deleted }] }` | `200 { cursor, changes: [{ path, doc, updatedAt, deleted, seq }], more, serverTime }` |
| `GET /api/export` | Bearer | | `200` a normal Tally export (`app`, `version: 4`, `exportedAt`, `settings`, `foods`, `templates`, `days`), importable as-is |
| `DELETE /api/vault` | Bearer | | `204`, removes the vault and all its docs |
| `POST /share` | none | | `303` to `/#start` (share-target fallback before the service worker is active) |

Rules:
- Sync key: 16 random bytes, base32, shown as `tly-XXXX-XXXX-XXXX-XXXX-XXXX-XX`. Normalize (uppercase, strip spaces and dashes) before hashing. Unknown key: `401`.
- Compare the invite code with a timing-safe comparison.
- Push is applied with one SQL statement per change inside a single `db.batch()` (one transaction), so `seq` assignment is atomic:
  `INSERT ... VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM docs WHERE vault = ?)) ON CONFLICT (vault, path) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq WHERE excluded.updated_at > docs.updated_at`
  Ties keep the existing row.
- The D1 free plan allows 50 queries per Worker invocation: cap a push at 40 changes (`413` above that), request body at 1 MB, one doc at 512 KB.
- Clamp any `updatedAt` more than 2 minutes ahead of server time to server time.
- Pull after push: rows with `seq > cursor` ordered by `seq`, limit 200; `more: true` when there may be more. Returning the client's own just-pushed rows is fine (the client ignores equal timestamps).
- Worker Free has a 10 ms CPU limit per request: no heavy work, no per-request crypto beyond one SHA-256.
- JSON errors `{ error }` with proper status codes. No CORS headers needed (same origin).

### Tests (`npm test`, vitest with the Workers pool and migrations applied)
Wrong and right invite; 401 without or with a bad key; push then pull; newer write wins, older ignored, tie ignored; future timestamp clamped; tombstone propagates; 250 docs pull across pages with `more`; 41 changes rejected; export shape imports cleanly through `schema.planImport`; vault deletion.

**Checkpoint 2:** all worker tests pass locally.

## Phase 3: client sync
### Store changes (`store.js` is the single choke point)
- Every document write stamps `updatedAt` (ISO) if missing. Newest-wins compares `Date.parse(updatedAt)` in ms.
- Outbox per profile in meta `m/sync:<profileId>`: `{ key, cursor, outbox: { [path]: { deleted, updatedAt } }, lastSync, lastError }`. Only linked profiles record outbox entries.
- `setDoc`, `deleteDoc` and `bulk` add outbox entries for the active profile when it is linked. Deletes record a tombstone.
- New `applyRemote(changes)`: writes pulled docs without touching the outbox, only when the incoming `updatedAt` is newer than the local doc (or the doc is missing); tombstones delete locally. Returns the changed paths.
- `eraseProfile` and `deleteProfile` unlink first. They never push tombstones; the cloud copy stays unless the user deletes it explicitly.

### `public/js/sync.js` (classic script, loaded after `store.js`, before `app.js`)
- `link(key)`, `createVault(invite)`, `unlink()`, `deleteCloud()`, `syncNow()`, `status()`, and an `onchange` callback for the UI.
- Sync loop: send up to 40 outbox entries (reading current doc bodies from the store) with the cursor; apply returned changes via `applyRemote`; clear the entries that were sent unless they changed again meanwhile; save the cursor; repeat while the outbox is non-empty or `more` is true.
- Triggers: app start, 3 s after local writes (debounced), the `online` event, returning to the foreground if the last sync is older than 30 s, the Sync now button, tapping the status dot.
- Robustness: 15 s timeout per request; exponential backoff on errors (5 s up to 5 min); `navigator.locks` (when available) so two tabs never sync the same profile at once; a failed request loses nothing.
- First link on a device with existing data: put every local doc of that profile in the outbox, cursor 0, run the loop. The server keeps the newer copy of each doc, so nothing newer is lost on either side.
- After remote changes arrive for the active profile, re-hydrate state and re-render the current page in place, but only when no sheet is open and no input has focus; otherwise re-render when the sheet closes. Preserve scroll. No flash.

### UI (strings in all 8 languages)
- Top bar: a small status dot next to the brand, hidden when unlinked. States: synced (green), pending with count (amber), syncing, offline (gray), error (red; tap shows the message). Include an `aria-label`.
- Settings, new **Sync** card:
  - Unlinked: **Create cloud vault** (asks for the invite code, then shows the key once, large, with Copy and the warning "Save this in your password manager. It's the only way to link other devices, and anyone with it can read and change this profile.") and **Link this device** (paste a key; accepts spaces, dashes, any case).
  - Linked: last synced time, pending count, **Sync now**, **Show sync key**, **Download cloud backup** (`/api/export`), **Unlink this device** (keeps local data), **Delete cloud copy** (confirm).
- Erase and delete profile confirmations say the cloud copy is not affected.
- iPhone note in the Link dialog: the home-screen app has its own storage, separate from Safari, so link inside the installed app.

### Tests
Extend `npm test` with a jsdom + fake-indexeddb smoke test that serves `public/` against `wrangler dev` (or the vitest Workers pool) and uses two separate DOM instances as two devices:
- Link A, create data, link B: B receives everything.
- Edit on A appears on B after sync; the open page re-renders without errors.
- Both offline, same day edited on both, then sync: the newer edit wins on both.
- Delete on A removes it on B; it does not come back.
- First link of B with its own older and newer local docs: newer ones survive on both sides.
- App works unlinked and offline exactly as before; zero console errors.

**Checkpoint 3:** all tests pass; the i18n check passes; short summary of the UI to Alex.

## Phase 4: cloud setup and deploy
- **Needs Alex:** create a free Cloudflare account and choose the `workers.dev` subdomain (it becomes the URL `tally.<subdomain>.workers.dev`).
- **Needs Alex:** `npx wrangler login` (opens a browser to authorize).
- `npx wrangler d1 create tally`, then write the `database_id` into `wrangler.jsonc`.
- `npx wrangler d1 migrations apply tally --remote`
- Generate a long random invite code, show it to Alex once, then `npx wrangler secret put INVITE_CODE`.
- `npx wrangler deploy`, then smoke-test with curl: `/` returns the app, `/api/sync` without a key returns 401, a bad invite returns 403.
- **Needs Alex:** create a private GitHub repo `tally`; push `main`. Optional: connect the repo to the Worker in the Cloudflare dashboard so each push deploys.

**Checkpoint 4:** live URL works; report it with the invite code reminder.

## Phase 5: docs and handover
- README: what Tally is, the new hosting (Cloudflare Worker + static assets), the sync model in a short paragraph, setup commands, free-tier limits, how to update (edit, bump `VERSION` in `public/sw.js`, deploy), data format v4 unchanged. No personal data anywhere in the repo.
- Final message to Alex, concise, with his first-run steps:
  1. Laptop: open the URL, Get started, Import `private/tally-alex.json` with **Replace**.
  2. Settings, Sync, Create cloud vault with the invite code; save the key in a password manager.
  3. iPhone: open the URL in Safari, Share, Add to Home Screen; open the installed app, Settings, Sync, Link this device, paste the key; wait for the green dot.
  4. Keep occasional exports as a second backup.
