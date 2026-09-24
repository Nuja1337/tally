# Tally

A local-first training and nutrition log: meals and nutrients, trackers for anything (checks, counts, numbers, ratings, durations, times, notes, bodyweight), routines, workouts with per-side logging, effort and custom fields, an ideal-week calendar, one-off events (tournaments, trips, appointments), an exercise library with history and records, progressions and day tags. Your data lives in your browser and the app works fully offline. Optional sync keeps a profile the same on your phone and your laptop.

- Works offline once opened, installs to the home screen like an app
- Five pages: Today, Plan (what is coming up, the training cycle and the ideal week with its training total), Progress (a week, a month, a year, or the data as a table), Library (workouts, routines, exercises, foods and saved meals), Settings (profile, language, theme, status colors, folding, sync, data). Targets, nutrients, tracker sections, meals of the day and tags are edited on Today; the goal and its checkpoints on Progress.
- Five-step status colors from missed to met (with a color-blind option); past days keep the colors their setup gave them
- Cards fold, finished ones by themselves; everything you create drags into order; deletes can be undone
- US or metric units (switching converts what you logged); a day can start after midnight
- Workouts: repeat last time with a tap, a rest timer, warm-up blocks that stay out of the log; category fields charted on Progress
- Quick add on Today: a meal, a workout, an event, a note or your weight
- Calm by default: one highlighted action per card, a workout that ended without a log gets a Log tag instead of a mark, and a new profile starts clean (days before it are not counted)
- Starter packs: General, BJJ athlete, Runner, Fat loss
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

Every edit is saved to IndexedDB first and queued in an outbox. The app uploads the queue a few seconds after edits, on start, when back online or in the foreground, and on Sync now, and pulls other devices' changes in the same request. Each document (the settings, each food, template, event and day) syncs on its own; deletes travel as tombstones. The server refuses a copy from a device that has not seen that document's latest version; the device merges and sends again. A day or the settings edited on two devices are merged entry by entry against the last synced copy (the device keeps it while an edit waits to upload): meals, sessions and other listed things by id, values and checks by key, tags as a set. What one side changed wins over what the other left alone, something removed on one side and untouched on the other stays removed, and a value changed on both takes the newer copy's. Any other document keeps the newer copy. Offline nothing is lost; the outbox waits. Linking a device that already has data merges both sides the same way. Open tabs share data live; only the active profile syncs. Unlinking or erasing a profile never deletes the cloud copy; Settings › Sync › **Delete cloud copy** does.

The dot next to the name shows the state: green synced, amber waiting to upload (with a count), gray offline, red error (tap for the message).

On iPhone the home-screen app has its own storage, separate from Safari, so link inside the installed app.

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

Everything lives in the browser's IndexedDB (localStorage if that is blocked). Progress › Data exports a month, or every day, as CSV. Clearing site data deletes it; a synced profile can be restored by linking again, but export now and then either way. Today shows a reminder after seven unexported days. Settings › Sync › **Download cloud backup** saves the cloud copy as a normal export.

**Export** (Settings › Export): everything, setup only (settings, foods, templates), or days and events since a date. Download, share, or copy the JSON.

**Import** (Get started, or Settings › Import): drop a file, choose one, paste from the clipboard, or paste text. Preview shows what will change before you apply. On Android you can also share a `.json` file straight into the installed app; on desktop the installed app opens `.json` files.

Modes:

- **Merge**: adds and updates. Nothing is deleted. Rows and settings carry `updatedAt`; older copies do not overwrite newer ones.
- **Replace**: each section in the file replaces yours. Sections not in the file are untouched. Replaced rows count as edited now, so on a synced profile a restored backup wins on every device.
- **Remove**: deletes the listed ids or dates.

Import into the current profile or into a new one.

## Profile format (v5)

One JSON object with optional sections. Paste just the part you are changing.

```json
{
  "app": "tally",
  "version": 5,
  "profile": { "name": "Sam" },
  "settings": {
    "name": "Sam",
    "units": { "system": "us" },
    "dayStart": "00:00",
    "targets": { "kcal": 2600, "protein": 170, "carbs": 0, "fat": 0, "aim": { "kcal": "near", "protein": "min", "carbs": "near", "fat": "near" } },
    "nutrients": [{ "id": "fiber", "name": "Fiber", "unit": "g", "target": 30, "aim": "min" }],
    "goal": { "weight": 180, "bodyFat": 12, "note": "", "band": [178, 182],
              "milestones": [{ "label": "Month 4", "date": "2027-01-15", "weight": 181, "bodyFat": 13.5 }] },
    "mealSlots": ["Breakfast", "Lunch", "Dinner", "Snacks"],
    "groups": [{ "id": "habits", "name": "Habits" }, { "id": "recovery", "name": "Recovery" }, { "id": "body", "name": "Body" }],
    "trackers": [{ "id": "water", "name": "Water", "type": "count", "target": 8, "unit": "glasses", "group": "habits" },
                 { "id": "stretch", "name": "Stretch", "type": "check", "freq": "days", "days": ["mon", "wed", "fri"], "group": "habits" },
                 { "id": "sleep", "name": "Sleep", "type": "duration", "target": 480, "aim": "min", "group": "recovery" },
                 { "id": "soreness", "name": "Soreness", "type": "rating", "target": 2, "aim": "max", "group": "recovery" },
                 { "id": "bedtime", "name": "Bedtime", "type": "time", "target": "23:00", "aim": "max", "group": "recovery" },
                 { "id": "weight", "name": "Weight", "type": "weight", "group": "body" },
                 { "id": "m_waist", "name": "Waist", "type": "number", "unit": "in", "freq": "weekly", "perWeek": 1, "group": "body" }],
    "exercises": [{ "id": "push-up", "name": "Push-up", "category": "Strength", "cues": "Elbows at 45°", "perSide": false, "unit": "reps",
                    "image": "https://example.com/push-up.gif", "video": "https://www.youtube.com/results?search_query=push+up",
                    "gate": { "id": "wrist", "at": 3 } }],
    "routines": [{ "id": "morning", "name": "Morning mobility", "days": ["mon", "wed", "fri"], "alertAt": null, "alertText": "",
                   "items": [{ "name": "Cat-cow", "target": "10", "exerciseId": "cat-cow" }] }],
    "sessionKinds": [{ "id": "bjj", "name": "BJJ", "color": "blue", "fields": [{ "id": "rounds", "name": "Rounds", "type": "number" }, { "id": "focus", "name": "Focus", "type": "text" }] },
                     { "name": "Strength" }],
    "sessionTypes": [{ "id": "upper", "name": "Upper body", "kind": "strength", "minutes": 45, "kcal": 300,
                       "plan": [{ "label": "Warm-up", "log": false, "items": [{ "exerciseId": "cat-cow", "sets": 1, "reps": "10" }] },
                                { "label": "A", "items": [{ "exerciseId": "push-up", "sets": 4, "reps": "8-12", "rir": "1", "rest": "60 s" },
                                                          { "exerciseId": "one-arm-row", "sets": 4, "reps": "10-12", "perSide": true }] }] }],
    "calendar": [{ "days": ["mon", "fri"], "start": "17:30", "end": "18:15", "kind": "session", "typeId": "upper" },
                 { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "17:00", "kind": "work", "title": "Work" },
                 { "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "23:00", "end": "07:00", "kind": "sleep", "title": "Sleep" }],
    "gates": [{ "id": "wrist", "name": "Wrist", "stages": ["Phase 1", "Phase 2", "Phase 3"], "current": 1 },
              { "id": "belt", "name": "BJJ belt", "stages": ["White", "Blue", "Purple", "Brown", "Black"], "current": 1 }],
    "wave": { "start": "2026-09-21", "pattern": ["ramp", "ramp", "full", "deload"] },
    "tags": [{ "id": "sick", "name": "Sick", "color": "slate", "skip": true }, { "id": "travel", "name": "Travel", "color": "olive", "skip": true },
             { "id": "competition", "name": "Competition", "color": "gold" }],
    "progress": { "hide": [] }
  },
  "foods": [{ "name": "Chicken breast, cooked", "category": "Proteins", "serving": "100 g", "kcal": 165, "p": 31, "c": 0, "f": 3.6, "n": { "fiber": 0 }, "note": "" }],
  "templates": [{ "name": "Oats and whey", "slot": "breakfast", "kcal": 420, "p": 34, "c": 55, "f": 6, "n": { "fiber": 6 } }],
  "days": [{ "date": "2026-09-01", "values": { "water": 6, "stretch": true, "sleep": 450, "soreness": 2, "bedtime": "23:20", "m_waist": 34.5 },
             "checks": { "morning": ["cat-cow"] },
             "meals": [{ "slot": "breakfast", "name": "Oats and whey", "kcal": 420, "p": 34, "c": 55, "f": 6, "n": { "fiber": 6 } }],
             "sessions": [{ "typeId": "upper", "name": "Upper body", "kind": "strength", "minutes": 45, "kcal": 300, "effort": 7,
                            "sets": [{ "ex": "Push-up", "exerciseId": "push-up", "wt": null, "reps": 12 }, { "ex": "One-arm row", "wt": 50, "reps": 10, "reps2": 9 }] },
                          { "name": "BJJ class", "kind": "bjj", "minutes": 90, "effort": 8, "fields": { "rounds": 6, "focus": "Guard retention" } }],
             "weight": 181.4, "tags": ["competition"], "note": "" }],
  "events": [{ "id": "fall-open", "date": "2026-10-18", "time": "09:00", "title": "Fall Open", "tag": "competition", "big": true, "offPlan": true, "result": "2 wins, bronze" },
             { "id": "thanksgiving", "date": "2026-11-25", "end": "2026-11-29", "title": "Thanksgiving trip", "tag": "travel" },
             { "date": "2026-09-29", "time": "16:00", "title": "Physio: wrist", "note": "Ask about Phase 2" }],
  "history": [{ "date": "2026-08-01", "targets": { "kcal": 2400, "protein": 160, "carbs": 0, "fat": 0, "aim": { "kcal": "near", "protein": "min", "carbs": "near", "fat": "near" } },
                "nutrients": [], "trackers": [{ "id": "water", "type": "count", "target": 8, "aim": "min", "freq": "daily" }],
                "routines": [{ "id": "morning", "days": [], "items": ["cat-cow"] }],
                "calendar": [{ "id": "upper", "days": ["mon", "fri"], "start": "17:30", "end": "18:15", "typeId": "upper" }],
                "types": [{ "id": "upper", "kind": "strength", "minutes": 45, "kcal": 300 }] }]
}
```

Notes:

- Ids are optional; they are derived from names (`Water` → `water`). Keep them stable if you edit files by hand.
- **Trackers** replace v4 habits and tape measurements. `type` is `check`, `count`, `number`, `rating` (1–5), `duration` (minutes), `time` (`HH:MM`), `text` or `weight` (one at most; its value is `day.weight`, in the profile unit). `target` and `aim` (`min` at least, `near` about, `max` at most; for times `max` means by, `min` at or after, `near` within 15 minutes) are optional.
- `freq` says when a tracker is expected: `daily`, `days` (the weekdays in `days`), `weekly` (`perWeek` times a week) or `any` (whenever; never counted as missed). Defaults: `any` for number, text and weight, `daily` for the rest. `archived` trackers leave Today and keep their history. `group` is the section (a card on Today); sections and trackers show in list order.
- `day.values` holds each tracker's value by id. Body fat for the goal is the tracker with id `bodyFat`.
- **goal**: target `weight` and `bodyFat`, a `band` to stay in, a `note`, and `milestones` (checkpoints with `label`, `date`, `weight`, `bodyFat`). Progress works out lean and fat mass from weight and body fat; older files' `lean` and `fat` are ignored.
- **events** are one-off things on a date: a tournament, a trip, an appointment, an injury, a test, a promotion. `end` (inclusive) makes one span days, `time` is `HH:MM`, `result` and `note` are free text. `tag` is a tag id: the event's days count as tagged (a `skip` tag leaves them out of averages). `big` makes it stand out on calendars with a countdown on Today. `offPlan` means planned training on those days is not expected. Moving a progression up adds an event.
- **Status colors** have five steps: met (green), close (light green), halfway (yellow), started (orange), missed (red). A day that is still going stays neutral while it is short; going over counts at once. Rates over weeks and months: 95% met, 75% close, 50% halfway, 25% started.
- **units.system** is `us` (lb, in, mi, fl oz, °F) or `metric` (kg, cm, km, ml, °C); bodyweight and set loads follow it. A number tracker or category field whose `unit` is one of these converts with it when you switch in Settings (values, targets and past targets). Files with only `units.weight` read `kg` as metric and `lb` as US; files with neither take the device's region.
- **dayStart** (`HH:MM`, up to `06:00`): until then, logging counts for the day before, so a meal at 00:30 lands on the evening it belongs to.
- `targets.aim` works the same for calories and macros. Missing aims default to `near` for calories, carbs and fat and `min` for protein. `nutrients` adds more (fiber, sodium…); foods, saved meals and logged meals carry them in `n`.
- `sessionKinds[].fields` are what a session of that category logs: `number` (with `unit`), `text`, `rating` or `duration`. Sessions keep them in `fields`, plus `effort` (1–10). Effort × minutes is the session load.
- `tags` mark days; `skip: true` leaves those days out of averages and rates. `day.tags` lists tag ids; an event's tag counts on its days too.
- **history** keeps the setup each stretch of days is judged by: an entry holds what judging needs (targets, nutrient targets, trackers' targets and frequencies, routines, planned sessions) from its `date` on. The app writes one whenever setup changes, so changing a target today leaves last month's colors alone. Days before the first entry use the first one, except days before the profile's first day (its first entry or its first logged day, whichever is earlier): nothing was expected then, so they are not counted as missed.
- Names in the app: `mealSlots` are "Meals of the day", `templates` are "Saved meals", `groups` are "Sections", `sessionKinds` are "Categories", `sessionTypes` are "Workouts", `gates` are "Progressions", `wave` is the "Training cycle" (`ramp` shows as Build, `full` as Peak), `calendar` blocks are plan items.
- `progress.hide` lists Progress cards the profile hides: `nutrition`, `weight`, `training`, `habits` (consistency), `trackers`, `tags`, `events`, `body` (the goal).
- `sessionKinds[].color` and `tags[].color` are one of `blue`, `violet`, `teal`, `orange`, `pink`, `gold`, `slate`, `olive`. Kinds without one take the next unused color.
- `routines[].days` limits a routine to those weekdays; empty or missing means every day. `alertAt` turns a routine into a check-in: when that many items are ticked, Today shows `alertText`.
- `exercises[].image` can be a direct image or GIF link (shown inline) or any page (opened in a tab). `video` is a link. `perSide` logs left and right reps and flags a gap over 10%. `gate` hides nothing but marks the exercise locked until that gate reaches the stage `at`.
- `sessionTypes[].plan` is a list of blocks (supersets); `items` reference exercises by `exerciseId` or by `name`. Logging a session of that type pre-fills the sets and shows what you did last time, with a tap to repeat it; an item's `rest` (`60 s`, `2 min`, `1:30`) starts a rest timer. A block with `log: false` (a warm-up, a cool-down) stays in the workout but out of the log. A set's `reps` holds seconds or meters for exercises whose `unit` is `sec` or `m`.
- A logged meal can say where it came from: `foodId` and `qty` (servings) when added from a food, `tplId` when added from a saved meal.
- `calendar` blocks build the ideal week: `kind` is `session`, `routine`, `meal`, `sleep`, `work`, `rest` or `other`, with `typeId`, `routineId` or `slotId` for the linked thing. Times are `HH:MM`, optional; a block that ends before it starts runs overnight. A session block with times scales the type's calories to the block length. The old `schedule` object is still accepted and becomes untimed session blocks.
- `wave.pattern` repeats from `wave.start`; values are `ramp`, `full` or `deload`. `gates[].current` is 1-based. A progression is any ladder: rehab phases, a belt, a grade.
- `p`, `c`, `f` also accept `protein`, `carbs`, `fat`. `slot` also accepts `window`.
- A bare list is accepted too (`[{ "name": "Oat milk", ... }]`); the import panel asks which section it belongs to.
- **Older files import unchanged.** v4 `settings.habits` become `check` or `count` trackers in a Habits section; the bodyweight becomes the `weight` tracker and the seven tape measurements (`day.measures`: `waist`, `chest`, `arm`, `thigh`, `calf`, `neck`, `bodyFat`) become number trackers `m_waist` … `m_neck` and `bodyFat` in a Body section; ones never logged start archived. `day.habits` and `day.measures` are read into `day.values`. A `settings.rank` (levels, sub-levels, promotions) becomes a progression with a stage per level and sub-level, and each promotion in its `history` becomes a big event; rank phases are dropped. Exports from Mettle 2.x, Matbook 1.x and the original artifact import too, and local data from those versions migrates on first open.

Remove example:

```json
{ "foods": ["banana"], "days": ["2026-09-01"], "events": ["fall-open"], "history": ["2026-08-01"], "settings": { "trackers": ["water"], "routineItems": { "morning": ["cat-cow"] } } }
```

`public/examples/starter-profile.json` is the General starter pack in English: four meal slots, Habits and Body sections, a morning routine, twelve exercises, four workouts (two with plans), a timed week, two tags and 72 whole foods with reference values. Get started also offers BJJ athlete, Runner and Fat loss packs.

Sync adds nothing to this format: the outbox and cursor are kept per device and never appear in exports. The cloud backup is a normal v5 export.

## API

Same origin as the app, JSON in and out, errors as `{ "error": "..." }`.

| Route | Auth | Body | Result |
|---|---|---|---|
| `POST /api/vault` | invite code | `{ invite }` | `201 { key }`, `403` on a wrong code |
| `POST /api/sync` | `Authorization: Bearer <key>`, `x-tally-format: 5`, `x-tally-sync: 2` | `{ cursor, changes: [{ path, doc, updatedAt, deleted }] }` | `200 { cursor, changes, more, serverTime, rejected }` |
| `GET /api/export` | Bearer | | `200` a v5 export |
| `DELETE /api/vault` | Bearer | | `204`, the vault and all its documents are gone |

An unknown key is `401`. `updatedAt` is milliseconds; more than 2 minutes in the future is clamped to server time. A write is applied when its `updatedAt` is newer and, unless it is a delete, the row has not changed since the request's `cursor`; otherwise its path is listed in `rejected` and the newer row comes back in `changes` to be merged. A sync without `x-tally-format: 5` and `x-tally-sync: 2` (an app that has not reloaded since an update) gets `426`, so old copies of the app cannot overwrite newer documents; the app asks you to reload.

## Languages

The interface follows the browser language when we have it, otherwise English; the dropdown in the top bar overrides it. Only the interface is translated: your own habit, food and routine names stay as you typed them, and the starter packs load in the selected language. Dictionaries live in `public/js/i18n/`; copy `en.js`, translate the values, add the file to `public/index.html` and `public/sw.js`, and run `node scripts/check-i18n.mjs`.

## Layout

```
public/                      the app, served as static files
  index.html                 shell and script order
  styles.css                 theme tokens (light/dark), layout, components
  js/ui.js                   DOM helpers, dates, sheets, charts (rings, bars, trend, heat)
  js/i18n.js                 language detection and t()
  js/i18n/<lang>.js          dictionaries
  js/schema.js               data format v5: defaults, normalization, v4 upgrade, the five-step scale, tracker grades,
                             setup history, import planning, export, starter packs
  js/store.js                IndexedDB store: profiles, outbox, pulled changes, tabs, migration from earlier names
  js/sync.js                 cloud sync loop, vault create/link/unlink
  js/app.js                  pages, routing, import/export, sync UI, boot
  sw.js                      offline cache and share target
  manifest.webmanifest       install metadata, share target, file handler
  examples/                  the General starter pack
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
