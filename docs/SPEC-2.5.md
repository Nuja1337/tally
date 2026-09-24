# Tally 2.5 spec

Goal: the same information with less on screen. Every card has one obvious next step, nothing looks like a failure that
is not one, and setup lives in one place.

## 1. A new profile starts clean

- The profile's first day is its first setup-history entry or its first logged day, whichever is earlier (`startDate()`).
- Before it, `setupOn(date)` expects nothing: no trackers, checklists or planned training (targets stay the first
  setup's, for a day logged after the fact). A profile started on a Wednesday no longer shows Monday and Tuesday as missed
  in the week, the month grid or the consistency rows.
- Logging a day before the first day moves the first day back to it.

## 2. One clear action per card

- Meals: only one Add is orange. Today it is the empty meal whose time has come, or the next one; on another day the first
  empty meal. The others are plain buttons.
- Training: the same for Log on planned workouts.
- Today's plan: a workout that ended today without a log gets a small Log tag instead of an amber cross. Meals and
  routines that ended get no mark (their cards show it). Past days keep their red cross for a miss. Untimed items no
  longer show a dot where the time goes.

## 3. Deletes and how-tos where they belong

- A logged workout has no delete cross on the card; Remove is in its sheet, with undo.
- Checklist rows check with a tap anywhere, including the name. An exercise's how-to opens from a small info button at
  the end of the row. No more underlined names.
- A workout without an exercise plan and no sets does not show an empty Sets heading.
- Per-side set rows fit a phone: weight, left, right, the gap and the remove button on one line.

## 4. Plan

- The "Training across the week" chart is gone; it repeated the calendar. The Week card's header has the week's total
  (workouts and hours) and the categories with their counts and hours sit under the calendar.

## 5. Progress

- The header shows only the goal (weight and body fat); the goal's note is in the Goal card.
- Workout fields: a total only for units that add up (distance, time, energy, counts). Heart rate, pace and the like
  show their average.
- "Most missed" is plain text, not red.
- Tagged days: the day count sits under the tag's name and the table fits a phone.

## 6. Library and Settings

- Library › Workouts: categories (with their colors), the training cycle and progressions are three rows that open their
  sheets, instead of three cards with Edit buttons.
- Workout rows count blocks and exercises in the right number ("1 block").
- The language picker leaves the header on every screen size; it is in Settings › App.
- Settings › Your data: the storage note sits under the title. The sync introduction is in small text.

## 7. The backup reminder

- Not shown while the profile syncs (the cloud keeps a copy).
- "Later" hides it for two weeks on this device.

## 8. Counts

- Strings with a count are `[singular, plural]` pairs; `t(key, { n })` picks the right one ("1 day", "3 days", "1 set").
  `i18n.unit(key, n)` still returns the bare word.

2.5 keeps data format v5 and sync protocol 2; nothing stored changes.
