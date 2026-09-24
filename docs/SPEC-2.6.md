# Tally 2.6 spec

Goal: every exercise has a real page inside the app, and day tags tell you something.

## 1. The exercise library

- About 400 exercises written for Tally (`public/js/exlib.js`, English): strength, core, power and speed, conditioning,
  mobility, stretching, prehab and rehab (wrist, finger, neck, shoulder, knee, ankle, hip), and solo drills for grappling
  and striking. No third-party text or photos.
- Each has: aliases, category, movement pattern, gear, level, how it is counted (reps, seconds, meters), per side,
  primary and secondary muscles, what it is, steps, cues, common mistakes, a safety note, a starting dose, and links to
  easier and harder versions and swaps. `node scripts/check-exlib.mjs` checks every entry and link.

## 2. Exercise pages

- `#exercise/<id>` under Library: a front and back muscle map (primary in the accent color, secondary lighter), what it
  is, the starting dose, how to do it, cues, mistakes, safety; variations (easier, harder, swaps) that open their pages;
  your side: notes, your video or image links, the progression gate, the workouts and routines it is in, records (1-rep
  max estimate only for strength lifts, else the top weight), a chart and recent sessions.
- From Today (a checklist's info button), a workout's sheet or Progress records, the same content opens as a sheet on
  top of what is open, with "Open page".
- Add to…: puts it in a workout (last block) or a routine with the library's starting dose.

## 3. Your exercises

- A profile exercise stands on a library entry by `base`, else the same id, else its name or an alias (your 115
  exercises all link by name). Its page shows the library's how-to under your name, unit and notes.
- Edit on a library exercise makes your version (same id); "Remove your changes" drops it.
- Add exercise: a name, optionally "based on" a library entry. Without one, muscles (tap once primary, twice
  secondary) and steps (one per line). New ids never take a library id they do not stand on.
- Format: `exercises[].base`, `pm`, `sm`, `steps`, `eq` (optional). Plan items, routine items and sets may point
  at a library id with no copy in `exercises`; `resolveExercise` finds library entries by id or name.

## 4. Picking exercises

- The plan editor's exercise control is a button that opens a picker (search, categories; yours first, then the
  library). A new item takes the picked exercise's starting dose until its sets or reps are typed.
- A routine gets "+ From the library"; a session being logged gets its extra exercises the same way.
- "Add your own" at the end of the picker creates one and picks it.

## 5. Library › Exercises

- Search (names, aliases, muscles, gear, category), category chips (All, Yours, the 8 categories), a muscle and a
  gear filter. Yours first, then the library entries none of yours stands on. Rows show category, primary muscles, gear.

## 6. Sheets that stack

- `openSheet(title, body, { stack: true })` keeps the open sheet underneath and brings it back when the top one closes.
  Opening an exercise while logging a workout no longer loses the log.

## 7. Day tags

- Today: "+ New tag" types a tag in place (Enter adds it to the day; an existing name is reused). "Details ›" opens every
  tag with how often it came up and what goes with it.
- A tag's page: this month, the last 12 months, the last time; its days on a year calendar; what differs on those days
  and on the day after against days without it (and without a skip tag), over the last 12 months: calories, protein,
  training time, effort, how much got done, and every tracker. Only differences of a third of the usual spread or more,
  from 3 days up, strongest first, colored better or worse where the target says which way is better. Recent tagged
  days open that day. Edit: name, color, leave out of averages, delete.
- Progress › Tagged days: a row per tag with its strongest one or two differences; a tap opens the tag.
- Progress › Data: show all days, one tag's days, or days with no tag.

2.6 keeps data format v5 and sync protocol 2; the new exercise fields are optional and older files import unchanged.
