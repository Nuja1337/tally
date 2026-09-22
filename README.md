# Tally

A local-first training and nutrition log. Meals, habits, routines, workouts with per-side logging, an ideal-week calendar, an exercise library with images and video, bodyweight, tape measurements and rank, stored in your browser. No accounts, no server, nothing leaves your device unless you export it.

- Works offline once opened, installs to the home screen like an app
- Five pages: Today, Plan (the ideal week, workouts, training wave, gates), Progress, Library (exercises and foods), Settings
- English, Spanish, French, Portuguese, German, Japanese, Korean, Chinese
- Light and dark themes
- Several profiles on one device
- Export and import as plain JSON

## Host it

One Cloudflare Worker serves the files in `public/` as static assets. Run it locally with `npx wrangler dev`. The site is plain HTML, CSS and JavaScript with no build step.

## Install

- iPhone: Safari › Share › Add to Home Screen
- Android: Chrome menu › Install app
- Desktop: the install icon in the address bar

Installed copies keep working offline and get updates on the next open.

## Your data

Everything lives in the browser's IndexedDB (localStorage if that is blocked). Clearing site data deletes it, so export now and then; Today shows a reminder after seven unexported days.

**Export** (Settings → Export): everything, setup only (settings, foods, templates), or days since a date. Download, share, or copy the JSON.

**Import** (Get started, or Settings → Import): drop a file, choose one, paste from the clipboard, or paste text. Preview shows what will change before you apply. On Android you can also share a `.json` file straight into the installed app; on desktop the installed app opens `.json` files.

Modes:

- **Merge** — adds and updates. Nothing is deleted. Rows and settings carry `updatedAt`; older copies do not overwrite newer ones.
- **Replace** — each section in the file replaces yours. Sections not in the file are untouched.
- **Remove** — deletes the listed ids or dates.

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

## Languages

The interface follows the browser language when we have it, otherwise English; the dropdown in the top bar overrides it. Only the interface is translated: your own habit, food and routine names stay as you typed them, and the example profile loads in the selected language. Dictionaries live in `public/js/i18n/`; copy `en.js`, translate the values, and add the file to `public/index.html` and `public/sw.js`.

## Updating

Edit, then bump `VERSION` in `public/sw.js` so installed copies fetch the new files. Open copies show a "New version ready" toast.

## Layout

```
public/                      the app, served as static files
  index.html                 shell and script order
  styles.css                 theme tokens (light/dark), layout, components
  js/ui.js                   DOM helpers, dates, sheets, charts (rings, bars, trend, heat)
  js/i18n.js                 language detection and t()
  js/i18n/<lang>.js          dictionaries
  js/schema.js               defaults, normalization, migration, import planning, export, starter profile
  js/store.js                IndexedDB store with profiles and migration from earlier names
  js/app.js                  pages, routing, import/export, boot
  sw.js                      offline cache and share target
  manifest.webmanifest       install metadata, share target, file handler
  examples/                  starter profile
scripts/check-i18n.mjs       dictionary parity check
wrangler.jsonc               Worker config
```

The app name lives in `MB.APP` (`public/js/schema.js`) plus `manifest.webmanifest`, `index.html`, `sw.js` and the rail label in `styles.css`.

## License

MIT
