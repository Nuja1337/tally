# Tally 2.3 spec

Goal: anyone can track almost anything, and Tally turns what they log into clear views. Status colors get finer, deletes can be undone, cards fold and user-made lists reorder, and past days keep the colors they earned.

Data format goes from v4 to v5. v1–v4 files still import.

## 1. Five-step status scale

Every status (rings, macros, tallies, tracker tiles, calendar cells, rates, charts) uses one scale.

| Grade | Color | Under target (at least / about) | Over target (at most / about) |
|---|---|---|---|
| `met` | green | met (about: within ±10%) | at most: at or under |
| `good` | light green | within 10% short (about: 80–90%) | within 10% over (about: 110–120%) |
| `half` | yellow | at least half | up to 1.5× |
| `low` | orange | something, under half | up to 2× |
| `miss` | red | nothing | 2× or more |

- A day that is still going shows `progress` (neutral) while it is short. Going over counts at once, since it cannot be undone.
- A day's fractions (items checked, share of trackers done) use the "at least" column with 100% as the target.
- Rates over weeks, months and years (days a habit was done, planned sessions done) use their own steps, so a habit kept 80% of the month reads as close, not halfway: 95% met, 75% close, 50% halfway, 25% started, less is missed.
- Legend: a five-color bar from "Missed" to "Met".
- Color-blind option (Settings > App, per device): blue for met, light blue, yellow, orange, dark orange for missed.

## 2. Undo, folding, reordering

- **Undo**: every delete, and every save from a setup sheet, shows a toast with Undo for 10 seconds. Deleting no longer asks first, except erasing a profile, deleting a profile and deleting the cloud copy.
- **Folding**: every card except the summary folds by tapping its title. A folded card shows a one-line summary. Fold state is per device.
- **Auto-fold**: habit, routine and training cards fold once everything in them is done (a short moment after the last tap). Opening one keeps it open for that day. Setting "Fold finished cards", on by default, per device.
- **Reordering**: anything the user creates can be dragged into order (handle, or arrow keys on the handle). This covers tracker sections and trackers, routines and their items, meal slots, workouts and their exercises, categories and their fields, nutrients, tags, milestones and progressions. The order is saved in the profile, so it syncs and exports. Built-in cards (Summary, Plan, Meals, Routines, Training, Day) keep their places.

## 3. Trackers (replace habits and measurements)

`settings.trackers`: one list for everything you log daily or now and then.

```json
{ "id": "sleep", "name": "Sleep", "type": "duration", "unit": "", "target": 480, "aim": "min",
  "freq": "daily", "days": [], "perWeek": null, "group": "recovery", "archived": false }
```

| type | value in `days[].values` | input on Today | status against a target |
|---|---|---|---|
| `check` | `true` | tap | done or not |
| `count` | number | tap +1, − | target and aim |
| `number` | number | number field | target and aim |
| `rating` | 1–5 | five buttons | steps away from target: 0 met, 1 good, 2 half, 3 low, 4 miss |
| `duration` | minutes | hours and minutes | target and aim |
| `time` | `"HH:MM"` | time field | minutes off: 0 met, ≤15 good, ≤30 half, ≤60 low, more miss (`max` = by, `min` = at or after, `near` = ±15 min is met) |
| `text` | string | text field | none |
| `weight` | `days[].weight` | number field in the profile's unit | none (goal and trend live on Progress) |

- `freq`: `daily`, `days` (the weekdays in `days`), `weekly` (`perWeek` times a week) or `any` (log when you like, never counted as missed).
- A tracker is **expected** on a day when its frequency says so. Expected trackers count in tallies, rates and streaks. Done means met (with a target) or logged (without one).
- `settings.groups` `[{id, name}]`: the sections on Today, one card each, in order. Defaults: Habits, Body.
- Archived trackers leave Today and keep their history on Progress. Restore from the section's edit sheet.
- Only one `weight` tracker. Body fat for the goal is the tracker with id `bodyFat` (or `body-fat`).

**Input on Today**: each section is a card of tiles, one per tracker. Checks and counts work as habits do now; number, time, duration and text tiles have their field in the tile; ratings have five buttons. Tiles of expected trackers show the last 7 days as graded dots; the others show the last value. The section's Edit opens its trackers (drag to reorder, tap to edit, add, archive, delete) and the section list.

**From v4**: habits become `check` (no target) or `count` (target) trackers in Habits. Weight becomes the `weight` tracker in Body. The seven tape measurements become `number` trackers in Body with ids `m_waist`, `m_chest`, `m_arm`, `m_thigh`, `m_calf`, `m_neck` and `bodyFat`. Measurements never logged start archived. `days[].habits` and `days[].measures` are read into `values`.

## 4. More fields

- **Categories get fields**: `sessionKinds[].fields` `[{id, name, type: number|text|rating|duration, unit}]`. A logged session keeps `fields: {id: value}`.
- **Effort**: every session gets optional `effort` (1–10). Load = effort × minutes. Progress compares a week's load with the 4 weeks before and warns when it jumps by more than 50%.
- **Extra nutrients**: `settings.nutrients` `[{id, name, unit, target, aim}]`. Foods, saved meals and logged meals keep `n: {id: amount}`. They show under carbs and fat on Today and in the food table.
- **Day tags**: `settings.tags` `[{id, name, color, skip}]`, `days[].tags` `[id]`. `skip` leaves those days out of averages and rates (sick, travel). Progress compares tagged days with the rest.

## 5. Setup history

Past days are judged by the setup they had. `history/<date>` documents hold what judging needs, in effect from that date:

```json
{ "date": "2026-09-23", "targets": {…}, "nutrients": [{"id","target","aim"}],
  "trackers": [{"id","type","target","aim","freq","days","perWeek","archived"}],
  "routines": [{"id","days","items":["id"],"alertAt"}],
  "calendar": [{"id","days","start","end","typeId"}], "types": [{"id","kind","minutes","kcal"}] }
```

- Saving setup writes today's entry when it differs from the one in effect.
- A day uses the latest entry on or before it; days before the first entry use the first one. Names, units and colors always come from the current setup.
- Something created later does not count on earlier days. Something deleted leaves history.
- Exports carry `history`; imports merge it by date like days.

## 6. Progress, rebuilt

- **Week**: days table; summary; nutrition; training plan vs actual (each planned session done, missed or still to come, plus extras), load vs the 4 weeks before, hours by category; habits and routines day by day with graded cells; tracker charts; weight.
- **Month**: calendar; summary; nutrition; weight; training by week (hours by category, % of plan, load) and records set; consistency rates with the weekday most missed; tracker charts; tags compared; body.
- **Year**: summary; highlights; weight; nutrition by month; training hours by month and category with running totals per category and records; the year's events (big ones first); consistency as one grid (a row per tracker and routine, a column per month, graded with %, year total). A tap on a row opens its detail: a year calendar, current and best streak, best and worst month, weekday most missed. Also tracker averages by month, tags, the goal.
- **Data**: a fourth tab. A month as a table: a row per day, a column per number (calories, macros, nutrients, weight, trackers, routines, training, load, tags, note). Sort by any column, choose columns, tap a row to open the day, export CSV.

## 7. Exercise history and records

- Logging sets shows what you did last time for each exercise.
- An exercise's card lists recent sessions and records: heaviest weight, most reps, best estimated 1-rep max (Epley), with a chart.
- Month and Year list the records set in that period.

## 8. Starter packs

Get started offers packs instead of one example: General, BJJ athlete, Runner, Fat loss, plus Blank and Import. Each is a full profile (sections, trackers, categories with fields, workouts, week, targets, tags) to adjust.

## 9. Sync

- Clients send `x-tally-format: 5`. The Worker refuses sync without it (HTTP 426, "update the app"), so an app that has not reloaded yet cannot overwrite v5 data with v4 copies.
- Cloud export writes v5 with `history` and `events`.

## 10. Events

One-off things on a date: a tournament, a trip, an appointment, an injury, a test, a promotion. Anything that is not a daily log or part of the ideal week.

```json
{ "id": "fall-open", "date": "2026-10-18", "end": "", "time": "09:00", "title": "Fall Open", "tag": "competition",
  "big": true, "offPlan": true, "result": "2 wins, bronze", "note": "" }
```

- Stored as `events/<id>` (synced like foods), exported as a top-level `events` list; merge by id, remove by id. "Setup only" exports leave them out; "since a date" keeps the ones that end on or after it.
- `end` (inclusive) makes an event span days. `tag` is a day tag: its days count as tagged, so a Sick or Travel event leaves them out of averages without tagging each day.
- **Big** (the significant facet): a starred chip on Today, a countdown on Today to the next big one (up to 180 days ahead), a ring on the Progress month calendar and the year calendar in a row's detail, bold in lists.
- **Replaces the plan** (`offPlan`): planned training on those days is not expected, so it is neither to do nor missed (a tournament, a trip).
- Where: a chip strip on Today (tap to edit), "Add event" in the Day card, "Coming up" on Plan, an Events card on Progress Month and Year (big ones first when there are many), a line under the day in the Week table, a column in Data.
- Moving a progression up adds an event dated today; big when no exercise waits on that progression (a belt). Undo takes both back.

## 11. Removed and combined

- **Rank is gone.** An old `settings.rank` becomes a progression (a stage per level and sub-level, "White · stripe 2") and each promotion in its history becomes a big event. Rank phases are dropped. Stored data converts once when the app opens; files convert on import. The BJJ pack's belt is a progression.
- **Milestones are part of the goal.** One Goal sheet holds target weight and body fat, the band, a note and dated checkpoints. The Goal card on Progress (Month and Year) shows now, each checkpoint and the target, with lean and fat mass worked out; stored `lean` and `fat` are dropped.
- **Plan no longer repeats the workouts list**; workouts live in Library.
