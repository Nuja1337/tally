# Tally

A local-first training and nutrition log: meals, habits, routines, workouts with per-side logging, an ideal-week calendar, an exercise library with images and video, bodyweight, tape measurements and rank. Your data lives in your browser and the app works fully offline. Optional sync keeps a profile the same on your phone and your laptop.

- Works offline once opened, installs to the home screen like an app
- Five pages: Today, Plan (the ideal week), Progress, Library (workouts, routines, exercises, foods and meal templates), Settings (profile, targets, goal, habits, meal slots, rank, sync, data)
- English, Spanish, French, Portuguese, German, Japanese, Korean, Chinese
- Light and dark themes
- Several profiles on one device
- Optional cloud sync per profile: your own vault, no account, no email
- Export and import as plain JSON

## How it is hosted

One Cloudflare Worker on the free plan, at `https://tally.<subdomain>.workers.dev`:

- `public/` is served as static assets straight from Cloudflare. These requests are free, unlimited, and never run Worker code.
- `worker/index.js` answers only `/api/*` (sync) and `POST /share` (the share-target fallback before the service worker is active).
- Synced data lives in a D1 database (`migrations/`). IndexedDB in the browser stays the source of truth; every chart and summary is computed on the device.

The app is plain HTML, CSS and JavaScript with no build step, no framework and no client dependencies. `package.json` only holds dev tools (wrangler, vitest, @cloudflare/vitest-plugin, jsdom, fake-indexeddb).

## Sync

Sync is optional and per profile. Settings › Sync › **Create cloud vault** asks for the server's invite code and returns a sync key (`tly-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`). On another device, Settings › Sync › **Link this device** with that key. The key is the only credential: the server keeps just its SHA-256 hash, and anyone with the key can read and change the profile, so keep it in a password manager. The invite code only stops strangers from creating vaults on your free quota.

Every edit is saved to IndexedDB first and queued in an outbox. The app uploads the queue a few seconds after edits, on start, when back online or in the foreground, and on Sync now, and pulls other devices' changes in the same request. Per document (settings, each food, template and day) the copy with the newer `updatedAt` wins, the same rule as import; deletes travel as tombstones. Offline nothing is lost; the outbox waits. Linking a device that already has data merges both sides by the same rule. Open tabs share data live; only the active profile syncs. Unlinking or erasing a profile never deletes the cloud copy; Settings › Sync › **Delete cloud copy** does.

The dot next to the name shows the state: green synced, amber waiting to upload (with a count), gray offline, red error (tap for the message).

Keep in mind: a day is one document, so if the same day is edited on two devices while both are offline, the later edit replaces the whole day. On iPhone the home-screen app has its own storage, separate from Safari, so link inside the installed app.

## Set up

Needs Node.js (current LTS) and a free Cloudflare account. No card.

```sh
npm install                                        # dev tools only; the app never needs it
npx wrangler login                                 # authorize this machine once
npx wrangler d1 create tally                       # then put its database_id in wrangler.jsonc
npx wrangler d1 migrations apply tally --remote
npx wrangler deploy --secrets-file secrets.json    # first deploy, see below
```

`wrangler.jsonc` lists `INVITE_CODE` under `secrets.required`, so a deploy fails until it exists. For the first deploy put `{ "INVITE_CODE": "<a long random code>" }` in a file outside the repo, pass it as above and delete it. Afterwards change the code with `npx wrangler secret put INVITE_CODE`. Changing it never affects existing vaults.

### Run locally

```sh
echo INVITE_CODE=local-dev-invite > .dev.vars      # local invite code, git-ignored
npx wrangler d1 migrations apply tally --local
npx wrangler dev                                   # http://localhost:8787
```

### Test

```sh
npm test                           # API tests in the Workers runtime; app tests in jsdom against the real Worker
node scripts/check-i18n.mjs        # every dictionary has the English keys and placeholders
```

The app tests boot the real `public/` scripts as separate devices and tabs (own IndexedDB each) and sync them through the Worker: linking, conflicts, offline edits, deletes, reloads, failures, locks between tabs, and a run with sync off that must make no requests at all.

## Update

1. Edit. Every user-facing string goes through `t()` and exists in all 8 dictionaries.
2. If anything under `public/` changed, bump `VERSION` in `public/sw.js` (keep `ASSETS` matching the files; a test checks it). Open copies then show "New version ready".
3. `npm test` and `node scripts/check-i18n.mjs`.
4. `npx wrangler deploy`. A new file in `migrations/` needs `npx wrangler d1 migrations apply tally --remote` first.

Optional: to deploy on every push, open the Cloudflare dashboard › Workers & Pages › tally › Settings › Builds › Connect, and pick this GitHub repository. Migrations still need the command above.

## Free-tier limits

Per account, Workers Free and D1 Free, reset daily at 00:00 UTC:

| Limit | Free plan | Tally |
|---|---|---|
| Worker requests | 100,000 / day | only sync calls count; static files are free |
| CPU per request | 10 ms | one SHA-256; stored JSON is passed through, not re-parsed |
| D1 queries per request | 50 | at most 42 (40 changes, key check, pull) |
| D1 rows | 5 M read and 100 k written / day, 5 GB | one row per document |
| Workers per account | 100 | 1 |

The API also caps each request at 40 changes, 1 MB, and 512 KB per document, and pages pulls at 200 rows or about 2 MB. With no card on file nothing can be billed; past a limit the app keeps working locally and sync retries later.

## Install

- iPhone: Safari › Share › Add to Home Screen
- Android: Chrome menu › Install app
- Desktop: the install icon in the address bar

Installed copies keep working offline and get updates on the next open.

## Your data

Everything lives in the browser's IndexedDB (localStorage if that is blocked). Clearing site data deletes it; a synced profile can be restored by linking again, but export now and then either way. Today shows a reminder after seven unexported days. Settings › Sync › **Download cloud backup** saves the cloud copy as a normal export.

**Export** (Settings › Export): everything, setup only (settings, foods, templates), or days since a date. Download, share, or copy the JSON.

**Import** (Get started, or Settings › Import): drop a file, choose one, paste from the clipboard, or paste text. Preview shows what will change before you apply. On Android you can also share a `.json` file straight into the installed app; on desktop the installed app opens `.json` files.

Modes:

- **Merge**: adds and updates. Nothing is deleted. Rows and settings carry `updatedAt`; older copies do not overwrite newer ones.
- **Replace**: each section in the file replaces yours. Sections not in the file are untouched. Replaced rows count as edited now, so on a synced profile a restored backup wins on every device.
- **Remove**: deletes the listed ids or dates.

Import into the current profile or into a new one.

## Profile format (v4)

One JSON object with optional sections. Paste just the part you are changing.

```json
{
  "app": "tally",
  "version": 4,
  "profile": { "name": "Sam" },
  "settings": {
    "name": "Sam",
    "units": { "weight": "lb" },
    "targets": { "kcal": 2600, "protein": 170, "carbs": 0, "fat": 0 },
    "goal": { "weight": 180, "bodyFat": 12, "note": "", "band": [178, 182],
              "milestones": [{ "label": "Month 4", "bodyFat": 13.5, "weight": 181, "lean": 157, "fat": 24 }] },
    "mealSlots": ["Breakfast", "Lunch", "Dinner", "Snacks"],
    "habits": [{ "name": "Water", "target": 8, "unit": "glasses" }, "Steps", "Stretch"],
    "exercises": [{ "id": "push-up", "name": "Push-up", "category": "Strength", "cues": "Elbows at 45°", "perSide": false, "unit": "reps",
                    "image": "https://example.com/push-up.gif", "video": "https://www.youtube.com/results?search_query=push+up",
                    "gate": { "id": "wrist", "at": 3 } }],
    "routines": [{ "id": "morning", "name": "Morning mobility", "days": ["mon", "wed", "fri"], "alertAt": null, "alertText": "",
                   "items": [{ "name": "Cat-cow", "target": "10", "exerciseId": "cat-cow" }] }],
    "sessionKinds": ["Strength", "Cardio"],
    "sessionTypes": [{ "id": "upper", "name": "Upper body", "kind": "strength", "minutes": 45, "kcal": 300,
                       "plan": [{ "label": "A", "items": [{ "exerciseId": "push-up", "sets": 4, "reps": "8-12", "rir": "1", "rest": "60 s" },
                                                          { "exerciseId": "one-arm-row", "sets": 4, "reps": "10-12", "perSide": true }] }] }],
    "calendar": [{ "days": ["mon", "fri"], "start": "17:30", "end": "18:15", "kind": "session", "typeId": "upper" },
                 { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "17:00", "kind": "work", "title": "Work" },
                 { "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "23:00", "end": "07:00", "kind": "sleep", "title": "Sleep" }],
    "gates": [{ "id": "wrist", "name": "Wrist", "stages": ["Phase 1", "Phase 2", "Phase 3"], "current": 1 }],
    "wave": { "start": "2026-09-21", "pattern": ["ramp", "ramp", "full", "deload"] },
    "rank": { "enabled": true, "system": "BJJ belt", "levels": ["White", "Blue", "Purple", "Brown", "Black"], "level": "White",
              "sublevelName": "stripe", "sublevel": 2, "maxSublevel": 4,
              "phases": [{ "name": "Phase I", "minSublevel": 0 }, { "name": "Phase II", "minSublevel": 3 }],
              "history": [{ "date": "2026-03-01", "level": "White", "sublevel": 2 }] }
  },
  "foods": [{ "name": "Chicken breast, cooked", "category": "Proteins", "serving": "100 g", "kcal": 165, "p": 31, "c": 0, "f": 3.6, "note": "" }],
  "templates": [{ "name": "Oats and whey", "slot": "breakfast", "kcal": 420, "p": 34, "c": 55, "f": 6 }],
  "days": [{ "date": "2026-09-01", "habits": { "water": 6, "steps": true }, "checks": { "morning": ["cat-cow"] },
             "meals": [{ "slot": "breakfast", "name": "Oats and whey", "kcal": 420, "p": 34, "c": 55, "f": 6 }],
             "sessions": [{ "typeId": "upper", "name": "Upper body", "kind": "strength", "minutes": 45, "kcal": 300,
                            "sets": [{ "ex": "Push-up", "exerciseId": "push-up", "wt": null, "reps": 12 }, { "ex": "One-arm row", "wt": 50, "reps": 10, "reps2": 9 }] }],
             "weight": 181.4, "measures": { "waist": 84, "chest": 104 }, "note": "" }]
}
```

Notes:

- Ids are optional; they are derived from names (`Water` → `water`). Keep them stable if you edit files by hand.
- A habit with a `target` counts up (tap adds one); without one it is a checkbox. `day.habits` holds `true` or the count.
- `routines[].days` limits a routine to those weekdays; empty or missing means every day. `alertAt` turns a routine into a check-in: when that many items are ticked, Today shows `alertText`.
- `exercises[].image` can be a direct image or GIF link (shown inline) or any page (opened in a tab). `video` is a link. `perSide` logs left and right reps and flags a gap over 10%. `gate` hides nothing but marks the exercise locked until that gate reaches the stage `at`.
- `sessionTypes[].plan` is a list of blocks (supersets); `items` reference exercises by `exerciseId` or by `name`. Logging a session of that type pre-fills the sets.
- `calendar` blocks build the ideal week: `kind` is `session`, `routine`, `meal`, `sleep`, `work`, `rest` or `other`, with `typeId`, `routineId` or `slotId` for the linked thing. Times are `HH:MM`, optional; a block that ends before it starts runs overnight. A session block with times scales the type's calories to the block length. The old `schedule` object is still accepted and becomes untimed session blocks.
- `wave.pattern` repeats from `wave.start`; values are `ramp`, `full` or `deload`. `gates[].current` is 1-based.
- `day.measures` keys: `waist`, `chest`, `arm`, `thigh`, `calf`, `neck`, `bodyFat`.
- `p`, `c`, `f` also accept `protein`, `carbs`, `fat`. `slot` also accepts `window`.
- A bare list is accepted too (`[{ "name": "Oat milk", ... }]`); the import panel asks which section it belongs to.
- Exports from earlier versions (Mettle 2.x, Matbook 1.x) and the original artifact import unchanged; local data from those versions migrates automatically on first open.

Remove example:

```json
{ "foods": ["banana"], "days": ["2026-09-01"], "settings": { "habits": ["water"], "routineItems": { "morning": ["cat-cow"] } } }
```

`public/examples/starter-profile.json` is the built-in example in English: four meal slots, four habits, a morning routine, twelve exercises, four session types (two with workouts), a timed week and 72 whole foods with reference values.

Sync adds nothing to this format: the outbox and cursor are kept per device and never appear in exports. The cloud backup is a normal v4 export.

## API

Same origin as the app, JSON in and out, errors as `{ "error": "..." }`.

| Route | Auth | Body | Result |
|---|---|---|---|
| `POST /api/vault` | invite code | `{ invite }` | `201 { key }`, `403` on a wrong code |
| `POST /api/sync` | `Authorization: Bearer <key>` | `{ cursor, changes: [{ path, doc, updatedAt, deleted }] }` | `200 { cursor, changes, more, serverTime }` |
| `GET /api/export` | Bearer | | `200` a v4 export |
| `DELETE /api/vault` | Bearer | | `204`, the vault and all its documents are gone |

An unknown key is `401`. `updatedAt` is milliseconds; more than 2 minutes in the future is clamped to server time.

## Languages

The interface follows the browser language when we have it, otherwise English; the dropdown in the top bar overrides it. Only the interface is translated: your own habit, food and routine names stay as you typed them, and the example profile loads in the selected language. Dictionaries live in `public/js/i18n/`; copy `en.js`, translate the values, add the file to `public/index.html` and `public/sw.js`, and run `node scripts/check-i18n.mjs`.

## Layout

```
public/                      the app, served as static files
  index.html                 shell and script order
  styles.css                 theme tokens (light/dark), layout, components
  js/ui.js                   DOM helpers, dates, sheets, charts (rings, bars, trend, heat)
  js/i18n.js                 language detection and t()
  js/i18n/<lang>.js          dictionaries
  js/schema.js               defaults, normalization, migration, import planning, export, starter profile
  js/store.js                IndexedDB store: profiles, outbox, pulled changes, tabs, migration from earlier names
  js/sync.js                 cloud sync loop, vault create/link/unlink
  js/app.js                  pages, routing, import/export, sync UI, boot
  sw.js                      offline cache and share target
  manifest.webmanifest       install metadata, share target, file handler
  examples/                  starter profile
worker/index.js              API: vaults, sync, export, share fallback
migrations/                  D1 schema
wrangler.jsonc               Worker, assets and D1 config
scripts/check-i18n.mjs       dictionary parity check
test/worker/                 API tests (Workers runtime)
test/client/                 app tests (jsdom, fake IndexedDB, real Worker)
```

The app name lives in `MB.APP` (`public/js/schema.js`) plus `manifest.webmanifest`, `index.html`, `sw.js` and the rail label in `styles.css`. Earlier names (Mettle 2.x, Matbook 1.x) appear only in the one-time migration in `store.js`.

## License

MIT
