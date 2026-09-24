# Tally 2.4 spec

Goal: nothing logged gets lost between devices, units fit the person, and logging and reading take fewer taps and less scrolling.

## 1. Units: US or metric

- `settings.units = { system: 'us' | 'metric', weight }`; weight follows the system (lb or kg). Settings › Profile › Units.
- Switching converts, both ways: the goal (weight, band, checkpoints), every day's weight, every set's load, number trackers and category fields whose unit is lb, in, mi, fl oz or °F (kg, cm, km, ml, °C), their targets and the targets in setup history. Other units stay as typed.
- Files with only `units.weight` read kg as metric and lb as US; files with neither take the device's region (US, Liberia, Myanmar or plain English: US). Starter packs use the profile's system (tape in cm or in, distance in km or mi).

## 2. The day start

- `settings.dayStart` (`HH:MM`, 00:00 to 06:00). Until then, "today" is still the day before: a meal at 00:30 lands on the evening it belongs to, and Today's plan counts past midnight as the same day.

## 3. Sync that keeps both sides

- The server refuses a copy (not a delete) when the row changed after the request's cursor, lists it in `rejected`, and returns the newer row. Sync protocol 2 (`x-tally-sync: 2`); older apps get 426.
- A day or the settings edited on two devices are merged against the last synced copy, which the device keeps (`m/base:<profile>/<path>`) from the first edit until the upload: lists by id (meals, sessions, trackers…), maps by key (values, checks), string lists as sets. Changed on one side wins over untouched; removed on one side and untouched on the other stays removed; changed on both takes the newer document's value. Then the merged copy is uploaded.
- Other documents (foods, templates, events, history) keep the newer copy; a newer local copy is sent again.
- A device's own upload coming back while it has edited again becomes the new base, so nothing deleted in between comes back.

## 4. Logging a workout

- "Same as last time" per exercise and "Fill in from last time" for the whole session copy the last session's sets.
- A plan block with `log: false` (warm-up, cool-down) stays in the workout but gets no set rows. Plan editor: "Log sets" per block.
- An item's rest (`60 s`, `90`, `2 min`, `1:30`) shows a rest button; it starts a countdown pill that buzzes at zero; tap to stop.
- Set inputs say seconds or meters for timed and distance exercises.

## 5. Today

- The plan card on a long day (more than 7 items) shows untimed items plus the last one that ended and the next few; "Whole day (n)" shows everything and is remembered per device.
- A floating + (Quick add): a meal of the day, a workout, an event, a note, the weight.
- Meals added from a food keep `foodId` and `qty`; from a saved meal, `tplId`.

## 6. Progress

- Tracker charts become tiles: the latest value, the average and a small line; a tap opens the full chart (the consistency detail when the tracker is expected).
- A Workout fields card (Month and Year): each category's number, rating and duration fields and effort as tiles; numbers with a unit show their total. A tap opens the full line.
- Data gets an Effort column (the day's highest) and a column per category number or duration field (the day's sum).

## 7. Smaller things

- Small chips are 36 px tall; the language picker leaves the phone header (it is in Settings).
- 2.4 keeps data format v5; the new fields are optional and older files import unchanged.
