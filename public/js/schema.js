/* Tally — profile schema: defaults, normalization, migration, import planning, export, starter profile. */
window.MB = window.MB || {};
(() => {
  'use strict';
  MB.APP = { id: 'tally', name: 'Tally', version: '2.6.0' };
  const { uid, clone, num, slug, isDate } = MB.ui;
  const VERSION = 5;
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const KINDS = ['session', 'routine', 'meal', 'sleep', 'work', 'rest', 'other'];
  const WAVE = ['ramp', 'full', 'deload'];
  const UNITS = ['reps', 'sec', 'm'];
  /* muscles on the map and gear, shared with the exercise library (exercises.js) */
  const MUSCLES = ['neck', 'traps', 'shoulders', 'rear-delts', 'rotator-cuff', 'chest', 'upper-back', 'lats', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'lower-back',
    'hip-flexors', 'glutes', 'abductors', 'adductors', 'quads', 'hamstrings', 'calves', 'shins'];
  const EQUIPMENT = ['none', 'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'band', 'bench', 'rack', 'bar', 'rings', 'suspension', 'box', 'plate', 'medball', 'slamball', 'sled',
    'rower', 'bike', 'skierg', 'rope', 'battlerope', 'bag', 'landmine', 'ezbar', 'trapbar', 'roller', 'dowel', 'wall', 'partner', 'mat', 'sandbag', 'abwheel', 'sliders', 'towel', 'ball',
    'step', 'harness', 'strap', 'other'];
  const CAT_KEYS = ['proteins', 'dairy', 'grains', 'fruit', 'veg', 'fats', 'drinks', 'supp'];
  /* v4 tape measurements; v5 keeps them as number trackers with these ids */
  const MEASURES = ['waist', 'chest', 'arm', 'thigh', 'calf', 'neck', 'bodyFat'];
  const MEASURE_IDS = { waist: 'm_waist', chest: 'm_chest', arm: 'm_arm', thigh: 'm_thigh', calf: 'm_calf', neck: 'm_neck', bodyFat: 'bodyFat' };
  /* how a daily target counts as met: at least it, about it (within 10%), or at most it */
  const AIMS = ['min', 'near', 'max'];
  const DEFAULT_AIM = { kcal: 'near', protein: 'min', carbs: 'near', fat: 'near' };
  /* trackers: what a value is, and how often it is expected */
  const TRACKER_TYPES = ['check', 'count', 'number', 'rating', 'duration', 'time', 'text', 'weight'];
  const FREQS = ['daily', 'days', 'weekly', 'any'];
  const FIELD_TYPES = ['number', 'text', 'rating', 'duration'];
  /* colors a session kind or tag can take; kinds without one get the next unused color in this order */
  const KIND_COLORS = ['blue', 'violet', 'teal', 'orange', 'pink', 'gold', 'slate', 'olive'];
  /* Progress cards a profile can hide ('body' is the goal card) */
  const PROGRESS_CARDS = ['nutrition', 'weight', 'training', 'fields', 'habits', 'trackers', 'tags', 'events', 'body'];
  /* Units: US (lb, in, mi, fl oz, °F) or metric (kg, cm, km, ml, °C). Bodyweight and set loads follow the system; a tracker
     or category field whose unit names one of these converts with it. [US, metric, factor, decimals to metric, decimals to US] */
  const SYSTEMS = ['us', 'metric'];
  const UNIT_PAIRS = [['lb', 'kg', 0.45359237, 1, 1], ['in', 'cm', 2.54, 1, 1], ['mi', 'km', 1.609344, 2, 2], ['fl oz', 'ml', 29.5735, 0, 1]];
  const roundTo = (x, dp) => { const k = Math.pow(10, dp); return Math.round(x * k) / k; };
  /* the device's region: US, Liberia and Myanmar use US units; plain English counts as US too */
  const defaultSystem = () => { try { const l = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en'); return /-(US|LR|MM)\b/i.test(l) || /^en$/i.test(l) ? 'us' : 'metric'; } catch (e) { return 'us'; } };
  /* a value in a unit, moved to the other system: { unit, v }, or null when the unit is not one that converts */
  function convertUnit(v, unit, to) {
    const lu = String(unit || '').trim().toLowerCase(), val = x => x == null || x === '' || !Number.isFinite(+x) ? x : null;
    for (const [us, m, k, dm, du] of UNIT_PAIRS) {
      if (to === 'metric' && lu === us) return { unit: m, v: val(v) !== null ? v : roundTo(+v * k, dm) };
      if (to === 'us' && lu === m) return { unit: us, v: val(v) !== null ? v : roundTo(+v / k, du) };
    }
    if (to === 'metric' && (lu === '°f' || lu === 'f')) return { unit: '°C', v: val(v) !== null ? v : roundTo((+v - 32) * 5 / 9, 1) };
    if (to === 'us' && (lu === '°c' || lu === 'c')) return { unit: '°F', v: val(v) !== null ? v : roundTo(+v * 9 / 5 + 32, 1) };
    return null;
  }

  const DEFAULT_SETTINGS = {
    name: '', units: { system: 'us', weight: 'lb' }, dayStart: '00:00',
    targets: { kcal: 2000, protein: 150, carbs: 0, fat: 0, aim: { ...DEFAULT_AIM } },
    nutrients: [],
    goal: { weight: null, bodyFat: null, note: '', band: null, milestones: [] },
    mealSlots: [], groups: [], trackers: [], routines: [],
    sessionKinds: [], sessionTypes: [],
    calendar: [], exercises: [], gates: [], tags: [],
    wave: { start: null, pattern: [] },
    progress: { hide: [] },
    updatedAt: null
  };

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const isTime = s => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
  const padT = s => isTime(s) ? s.split(':').map((x, i) => i === 0 ? String(+x).padStart(2, '0') : x).join(':') : '';
  const named = arr => (arr || []).filter(x => typeof x === 'string' ? x.trim() : (isObj(x) && String(x.name || '').trim()))
    .map(x => typeof x === 'string' ? { name: x.trim() } : { ...x, name: String(x.name).trim() });
  function ensureIds(arr, key) {
    const seen = new Set();
    return arr.map(it => {
      let id = String(it.id || slug(it[key || 'name'] || '')); const base = id; let n = 2;
      while (seen.has(id)) id = base + '-' + n++;
      seen.add(id);
      return { ...it, id };
    });
  }
  const boolMap = m => { const out = {}; if (Array.isArray(m)) m.forEach(k => { out[String(k)] = true; }); else if (isObj(m)) for (const k of Object.keys(m)) if (m[k]) out[k] = true; return out; };
  /* habits map keeps counts: true or a number */
  const habitMap = m => { const out = {}; if (Array.isArray(m)) m.forEach(k => { out[String(k)] = true; }); else if (isObj(m)) for (const k of Object.keys(m)) { const v = m[k]; if (v === true) out[k] = true; else if (typeof v === 'number' && v > 0) out[k] = v; else if (typeof v === 'string' && num(v) > 0) out[k] = num(v); } return out; };
  const dayList = v => Array.isArray(v) ? [...new Set(v.map(x => String(x).toLowerCase().slice(0, 3)).filter(x => DAYS.includes(x)))] : [];
  const optNum = v => (v == null || v === '') ? null : num(v);
  const optPos = v => (v == null || v === '' || !(num(v) > 0)) ? null : num(v);
  /* numbers only (extra nutrients) */
  const numMap = m => { const out = {}; if (isObj(m)) for (const k of Object.keys(m)) { const v = m[k]; if (v !== '' && v != null && Number.isFinite(+v)) out[k] = +v; } return out; };
  /* tracker values and session fields: true, a number or a short text; times are kept as HH:MM */
  const valueMap = m => {
    const out = {};
    if (isObj(m)) for (const k of Object.keys(m)) {
      const v = m[k];
      if (v === true) out[k] = true;
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'string' && v.trim()) out[k] = isTime(v.trim()) ? padT(v.trim()) : v.trim().slice(0, 2000);
    }
    return out;
  };
  const strList = v => Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : [];
  const muscles = v => strList(v).filter(m => MUSCLES.includes(m)).slice(0, 6);
  const tr = (key, fallback) => { const s = MB.i18n ? MB.i18n.t(key) : key; return s === key ? fallback : s; };

  /* ---------- trackers ---------- */
  const defaultFreq = type => ['number', 'text', 'weight'].includes(type) ? 'any' : 'daily';
  const defaultAim = type => type === 'time' ? 'max' : 'min';
  function normalizeTracker(x) {
    const type = TRACKER_TYPES.includes(x.type) ? x.type : (optPos(x.target) ? 'count' : 'check');
    let target = null;
    if (type === 'time') target = isTime(x.target) ? padT(x.target) : null;
    else if (type === 'rating') target = optPos(x.target) ? Math.min(5, Math.max(1, Math.round(num(x.target)))) : null;
    else if (type === 'count') target = optPos(x.target) ? Math.round(num(x.target)) : null;
    else if (['number', 'duration'].includes(type)) target = optPos(x.target);
    let freq = FREQS.includes(x.freq) ? x.freq : defaultFreq(type);
    const days = dayList(x.days);
    if (freq === 'days' && !days.length) freq = 'daily';
    return { id: x.id, name: x.name, type, unit: ['check', 'rating', 'time', 'text', 'weight', 'duration'].includes(type) ? '' : String(x.unit == null ? '' : x.unit),
      target, aim: AIMS.includes(x.aim) ? x.aim : defaultAim(type), freq, days: freq === 'days' ? days : [],
      perWeek: freq === 'weekly' ? Math.min(7, Math.max(1, Math.round(num(x.perWeek)) || 3)) : null, group: String(x.group || ''), archived: !!x.archived };
  }
  const habitToTracker = (x, group) => { const target = optPos(x.target) ? Math.round(num(x.target)) : null; return { id: x.id, name: x.name, type: target ? 'count' : 'check', unit: x.unit == null ? '' : String(x.unit), target, aim: 'min', freq: 'daily', group }; };
  /* v4 had habits, a weight field and seven tape measurements; v5 makes them trackers in two sections. Measurements
     start archived (upgradeSettings restores the ones that have data). */
  function trackersFromV4(d) {
    const habits = Array.isArray(d.habits) ? ensureIds(named(d.habits)).map(x => habitToTracker(x, 'habits')) : [];
    const body = [{ id: 'weight', name: tr('m.weight', 'Weight'), type: 'weight', group: 'body' },
      ...MEASURES.map(k => ({ id: MEASURE_IDS[k], name: tr('m.' + k, k), type: 'number', unit: k === 'bodyFat' ? '%' : '', freq: 'any', group: 'body', archived: true }))];
    return { groups: [{ id: 'habits', name: tr('t.habits', 'Habits') }, { id: 'body', name: tr('t.body', 'Body') }], trackers: ensureIds([...habits, ...body]) };
  }
  function normalizeTrackers(s, groups, trackers) {
    s.groups = ensureIds(named(groups)).map(g => ({ id: g.id, name: g.name }));
    let weight = false;
    s.trackers = ensureIds(named(trackers)).map(normalizeTracker).filter(x => x.type !== 'weight' || (!weight && (weight = true)));
    if (s.trackers.some(x => !s.groups.some(g => g.id === x.group))) {
      if (!s.groups.length) s.groups.push({ id: 'habits', name: tr('t.habits', 'Habits') });
      for (const x of s.trackers) if (!s.groups.some(g => g.id === x.group)) x.group = s.groups[0].id;
    }
  }
  /* measurement trackers that have values somewhere come back from the archive */
  function unarchiveUsed(s, days) {
    const ids = new Set(Object.values(MEASURE_IDS));
    for (const x of s.trackers) if (x.archived && ids.has(x.id) && days.some(d => d && d.values && d.values[x.id] != null)) x.archived = false;
    return s;
  }
  const isV4Settings = d => !isObj(d) || !Array.isArray(d.trackers);
  function upgradeSettings(raw, days) { const s = normalizeSettings(raw); return isV4Settings(raw) ? unarchiveUsed(s, days || []) : s; }

  /* ---------- events ---------- */
  /* One-off things on a date: a tournament, a trip, an appointment, an injury, a test. end (inclusive) makes it span
     days; tag makes its days count as tagged; big makes it stand out; offPlan means planned training is not expected. */
  function normalizeEvent(e) {
    if (!isObj(e) || !isDate(e.date)) return null;
    const title = String(e.title || e.name || '').trim().slice(0, 200); if (!title) return null;
    return { id: String(e.id || slug(title) + '-' + e.date), date: e.date, end: isDate(e.end) && e.end > e.date ? e.end : '', time: isTime(e.time) ? padT(e.time) : '', title,
      tag: String(e.tag || ''), big: !!e.big, offPlan: !!e.offPlan, result: String(e.result || '').slice(0, 500), note: String(e.note || '').slice(0, 2000), updatedAt: e.updatedAt || null };
  }
  const eventOn = (e, date) => date >= e.date && date <= (e.end || e.date);

  /* v4 files (and early v5 ones) had a rank: levels, sub-levels and promotions. It is a progression now (a stage per
     level and sub-level), and each past promotion becomes a big event. Phases are dropped. */
  const rankMax = r => Math.min(6, Math.max(0, Math.round(num(r.maxSublevel == null ? 4 : r.maxSublevel))));
  const rankStage = (r, level, n) => n > 0 ? `${level} · ${String(r.sublevelName || 'stripe')} ${n}` : String(level);
  function rankToProgression(r) {
    if (!isObj(r) || !r.enabled) return null;
    const levels = Array.isArray(r.levels) ? r.levels.map(String).filter(Boolean) : [];
    if (r.level && !levels.includes(String(r.level))) levels.push(String(r.level));
    if (!levels.length) return null;
    const max = rankMax(r), stages = levels.flatMap(l => [...Array(max + 1)].map((_, n) => rankStage(r, l, n)));
    const at = stages.indexOf(rankStage(r, r.level || levels[0], Math.min(max, Math.max(0, Math.round(num(r.sublevel))))));
    const name = String(r.system || '').trim() || 'Rank';
    return { id: slug(name) || 'rank', name, stages, current: at >= 0 ? at + 1 : 1 };
  }
  function rankEvents(r) {
    if (!isObj(r) || !Array.isArray(r.history)) return [];
    const seen = new Set(), max = rankMax(r);
    return r.history.filter(x => isObj(x) && isDate(x.date)).map(x => {
      let id = 'rank-' + x.date, n = 2; while (seen.has(id)) id = 'rank-' + x.date + '-' + n++; seen.add(id);
      const stage = rankStage(r, x.level || r.level || '', Math.min(max, Math.max(0, Math.round(num(x.sublevel)))));
      return normalizeEvent({ id, date: x.date, title: (r.system ? r.system + ': ' : '') + stage, big: true });
    }).filter(Boolean);
  }
  /* exercises are referenced by id, or by name when a file was written by hand; the profile's own first, then the
     built-in library (an entry there needs no copy in the profile) */
  function resolveExercise(ref, exercises) {
    if (!ref) return null;
    const id = String(ref); const byId = exercises.find(e => e.id === id); if (byId) return byId;
    const lc = id.trim().toLowerCase(), own = exercises.find(e => e.name.toLowerCase() === lc) || exercises.find(e => e.id === slug(id));
    if (own) return own;
    const L = MB.exercises, lib = L && (L.get(id) || L.match(id));
    return lib ? { id: lib.id, name: lib.name, perSide: !!lib.side, unit: lib.unit } : null;
  }
  function normalizeSettings(d) {
    d = isObj(d) ? d : {};
    const s = clone(DEFAULT_SETTINGS);
    if (typeof d.name === 'string') s.name = d.name;
    /* the system; files from before it had only a weight unit */
    const sys = isObj(d.units) && SYSTEMS.includes(d.units.system) ? d.units.system : isObj(d.units) && (d.units.weight === 'kg' || d.units.weight === 'lb') ? (d.units.weight === 'kg' ? 'metric' : 'us') : defaultSystem();
    s.units = { system: sys, weight: sys === 'metric' ? 'kg' : 'lb' };
    /* when a new day begins: logging after midnight still counts for the day before until then (up to 6:00) */
    if (isTime(d.dayStart) && hm(padT(d.dayStart)) <= 360) s.dayStart = padT(d.dayStart);
    if (isObj(d.targets)) {
      for (const k of ['kcal', 'protein', 'carbs', 'fat']) if (d.targets[k] != null) s.targets[k] = num(d.targets[k]);
      if (isObj(d.targets.aim)) for (const k of Object.keys(DEFAULT_AIM)) if (AIMS.includes(d.targets.aim[k])) s.targets.aim[k] = d.targets.aim[k];
    }
    if (isObj(d.goal)) {
      s.goal.weight = optNum(d.goal.weight); s.goal.bodyFat = optNum(d.goal.bodyFat);
      if (typeof d.goal.note === 'string') s.goal.note = d.goal.note;
      if (Array.isArray(d.goal.band) && d.goal.band.length === 2 && d.goal.band.every(x => x != null && x !== '')) s.goal.band = [num(d.goal.band[0]), num(d.goal.band[1])].sort((a, b) => a - b);
      /* checkpoints on the way; lean and fat mass are worked out from weight and body fat, so older files' copies are dropped */
      if (Array.isArray(d.goal.milestones)) s.goal.milestones = d.goal.milestones.filter(isObj).map(m => ({ label: String(m.label || ''), date: isDate(m.date) ? m.date : '', weight: optNum(m.weight), bodyFat: optNum(m.bodyFat) }))
        .filter(m => m.label.trim() || m.weight != null || m.bodyFat != null);
    }
    if (Array.isArray(d.nutrients)) s.nutrients = ensureIds(named(d.nutrients)).map(n => ({ id: n.id, name: n.name, unit: String(n.unit == null ? 'g' : n.unit), target: optPos(n.target), aim: AIMS.includes(n.aim) ? n.aim : 'min' }));
    if (Array.isArray(d.mealSlots)) s.mealSlots = ensureIds(named(d.mealSlots)).map(x => ({ id: x.id, name: x.name }));
    if (isV4Settings(d)) { const v = trackersFromV4(d); normalizeTrackers(s, v.groups, v.trackers); }
    else normalizeTrackers(s, Array.isArray(d.groups) ? d.groups : [], d.trackers);
    if (Array.isArray(d.tags)) s.tags = ensureIds(named(d.tags)).map(x => ({ id: x.id, name: x.name, color: KIND_COLORS.includes(x.color) ? x.color : '', skip: !!x.skip }));
    if (Array.isArray(d.exercises)) s.exercises = ensureIds(named(d.exercises)).map(e => ({ id: e.id, name: e.name, category: String(e.category || ''), image: String(e.image || ''), video: String(e.video || ''), cues: String(e.cues || e.note || ''),
      perSide: !!e.perSide, unit: UNITS.includes(e.unit) ? e.unit : 'reps', gate: isObj(e.gate) && e.gate.id ? { id: String(e.gate.id), at: Math.max(1, Math.round(num(e.gate.at) || 1)) } : null,
      base: typeof e.base === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(e.base) ? e.base : '', pm: muscles(e.pm), sm: muscles(e.sm).filter(m => !muscles(e.pm).includes(m)),
      steps: strList(e.steps).map(x => x.trim()).filter(Boolean).slice(0, 12), eq: strList(e.eq).filter(q => EQUIPMENT.includes(q)) }));
    if (Array.isArray(d.gates)) s.gates = ensureIds(named(d.gates)).map(g => { const stages = Array.isArray(g.stages) ? g.stages.map(String).filter(Boolean) : []; return { id: g.id, name: g.name, stages, current: Math.min(Math.max(1, Math.round(num(g.current) || 1)), Math.max(1, stages.length)) }; });
    if (Array.isArray(d.routines)) s.routines = ensureIds(named(d.routines)).map(r => ({ id: r.id, name: r.name,
      items: ensureIds(named(r.items)).map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); return { id: it.id, name: it.name, target: it.target == null ? '' : String(it.target), exerciseId: ex ? ex.id : '' }; }),
      days: dayList(r.days), alertAt: r.alertAt == null || r.alertAt === '' ? null : Math.max(1, Math.round(num(r.alertAt))), alertText: String(r.alertText || '') }));
    if (Array.isArray(d.sessionKinds)) s.sessionKinds = ensureIds(named(d.sessionKinds)).map(k => ({ id: k.id, name: k.name, color: KIND_COLORS.includes(k.color) ? k.color : '',
      fields: ensureIds(named(k.fields)).map(f => ({ id: f.id, name: f.name, type: FIELD_TYPES.includes(f.type) ? f.type : 'number', unit: f.type === 'number' || !FIELD_TYPES.includes(f.type) ? String(f.unit || '') : '' })) }));
    if (Array.isArray(d.sessionTypes)) s.sessionTypes = ensureIds(named(d.sessionTypes)).map(t => ({ id: t.id, name: t.name,
      kind: t.kind ? String(t.kind) : (s.sessionKinds[0] ? s.sessionKinds[0].id : ''), minutes: num(t.minutes), kcal: num(t.kcal), note: String(t.note || ''),
      plan: Array.isArray(t.plan) ? ensureIds(t.plan.filter(isObj).map(b => ({ ...b, name: b.label || b.name || 'block' })), 'name').map(b => ({ id: b.id, label: String(b.label || b.name || ''), note: String(b.note || ''), log: b.log !== false,
        items: ensureIds((Array.isArray(b.items) ? b.items : []).filter(isObj).map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); const name = String(it.name || (ex ? ex.name : it.exercise || '')).trim(); return { ...it, name }; }).filter(it => it.name), 'name')
          .map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); return { id: it.id, exerciseId: ex ? ex.id : '', name: it.name, sets: Math.max(0, Math.round(num(it.sets))), reps: String(it.reps == null ? '' : it.reps), perSide: it.perSide == null ? !!(ex && ex.perSide) : !!it.perSide, rir: String(it.rir == null ? '' : it.rir), rest: String(it.rest || ''), note: String(it.note || '') }; }) })) : [] }));
    for (const t of s.sessionTypes) if (t.kind && !s.sessionKinds.some(k => k.id === t.kind)) s.sessionKinds.push({ id: t.kind, name: t.kind.charAt(0).toUpperCase() + t.kind.slice(1), color: '', fields: [] });
    let cal = Array.isArray(d.calendar) ? d.calendar : [];
    if (!cal.length && isObj(d.schedule)) for (const day of DAYS) if (Array.isArray(d.schedule[day])) for (const id of d.schedule[day]) cal.push({ days: [day], kind: 'session', typeId: String(id) });
    s.calendar = ensureIds(cal.filter(isObj).map(b => ({ ...b, name: b.title || b.typeId || b.routineId || b.slotId || b.kind || 'block' })), 'name').map(b => {
      const type = b.typeId ? s.sessionTypes.find(x => x.id === String(b.typeId)) : null, routine = b.routineId ? s.routines.find(x => x.id === String(b.routineId)) : null, slot = b.slotId ? s.mealSlots.find(x => x.id === String(b.slotId)) : null;
      let kind = KINDS.includes(b.kind) ? b.kind : (type ? 'session' : routine ? 'routine' : slot ? 'meal' : 'other');
      if (kind === 'session' && !type) kind = 'other'; if (kind === 'routine' && !routine) kind = 'other'; if (kind === 'meal' && !slot) kind = 'other';
      return { id: b.id, days: dayList(b.days), start: padT(b.start), end: padT(b.end), kind, title: String(b.title || ''), note: String(b.note || ''), typeId: type ? type.id : '', routineId: routine ? routine.id : '', slotId: slot ? slot.id : '' };
    }).filter(b => b.days.length);
    if (isObj(d.wave)) s.wave = { start: isDate(d.wave.start) ? d.wave.start : null, pattern: Array.isArray(d.wave.pattern) ? d.wave.pattern.map(String).filter(x => WAVE.includes(x)) : [] };
    const rp = rankToProgression(d.rank); if (rp && !s.gates.some(g => g.id === rp.id)) s.gates.push(rp);
    if (isObj(d.progress) && Array.isArray(d.progress.hide)) s.progress.hide = [...new Set(d.progress.hide.filter(k => PROGRESS_CARDS.includes(k)))];
    if (d.updatedAt) s.updatedAt = d.updatedAt;
    return s;
  }
  const blockTitle = (b, s) => b.title || (b.typeId && (s.sessionTypes.find(x => x.id === b.typeId) || {}).name) || (b.routineId && (s.routines.find(x => x.id === b.routineId) || {}).name) || (b.slotId && (s.mealSlots.find(x => x.id === b.slotId) || {}).name) || '';
  const hm = t => isTime(t) ? t.split(':').reduce((a, x, i) => a + (i ? +x : +x * 60), 0) : null;
  const duration = b => { const a = hm(b.start), z = hm(b.end); if (a == null || z == null) return null; return z >= a ? z - a : z + 1440 - a; };
  const blocksFor = (s, day) => s.calendar.filter(b => b.days.includes(day)).sort((a, b) => (hm(a.start) == null ? -1 : hm(a.start)) - (hm(b.start) == null ? -1 : hm(b.start)));
  /* planned sessions for a weekday: session blocks; minutes and kcal scale with the block length when it has times */
  function plannedFor(s, day) {
    return blocksFor(s, day).filter(b => b.kind === 'session' && b.typeId).map(b => { const type = s.sessionTypes.find(x => x.id === b.typeId); const min = duration(b); const minutes = min || num(type.minutes);
      const kcal = type.minutes > 0 && min ? Math.round(num(type.kcal) * min / num(type.minutes)) : num(type.kcal); return { block: b, type, minutes, kcal }; });
  }
  function waveWeek(wave, date) {
    if (!wave || !wave.start || !wave.pattern.length || date < wave.start) return null;
    const days = Math.round((new Date(date.replace(/-/g, '/')) - new Date(wave.start.replace(/-/g, '/'))) / 86400000);
    const n = Math.floor(days / 7), i = n % wave.pattern.length;
    return { week: i + 1, of: wave.pattern.length, phase: wave.pattern[i], cycle: Math.floor(n / wave.pattern.length) + 1 };
  }
  /* a kind's color: its own, else the next palette color no other kind has taken */
  function kindColors(kinds) {
    const taken = new Set(kinds.map(k => k.color).filter(Boolean)), free = KIND_COLORS.filter(c => !taken.has(c)), out = {};
    let i = 0;
    for (const k of kinds) out[k.id] = k.color || free[i++ % Math.max(1, free.length)] || KIND_COLORS[0];
    return out;
  }
  /* ---------- the five-step scale ---------- */
  /* miss (red) · low (orange) · half (yellow) · good (light green) · met (green); progress = the day is still going */
  const GRADES = ['miss', 'low', 'half', 'good', 'met'];
  const GRADE_VALUE = { miss: 0, low: 0.3, half: 0.65, good: 0.9, met: 1 };
  /* a fraction done: all of it is met, 90% close, half halfway, anything started */
  const gradeOf = r => r == null || !Number.isFinite(r) ? null : r >= 1 ? 'met' : r >= 0.9 ? 'good' : r >= 0.5 ? 'half' : r > 0 ? 'low' : 'miss';
  /* how often over a stretch of days or weeks: done every time is met, 3 in 4 close, half halfway, 1 in 4 started */
  const rateGrade = r => r == null || !Number.isFinite(r) ? null : r >= 0.95 ? 'met' : r >= 0.75 ? 'good' : r >= 0.5 ? 'half' : r >= 0.25 ? 'low' : 'miss';
  /* how far past a limit: r is value / limit */
  const overGrade = (r, good) => r <= good ? 'good' : r <= 1.5 ? 'half' : r < 2 ? 'low' : 'miss';
  /* How a day's total compares with its target. final: the day is over, so falling short counts. Going over counts at
     once, since it cannot be undone. null when there is no target. */
  function targetStatus(value, target, aim, final) {
    if (!(target > 0)) return null;
    const r = num(value) / target;
    if (aim === 'max') return r <= 1 ? (final ? 'met' : 'progress') : overGrade(r, 1.1);
    if (aim === 'near') {
      if (r > 1.1) return overGrade(r, 1.2);
      if (r >= 0.9) return 'met';
      if (!final) return 'progress';
      return r >= 0.8 ? 'good' : r >= 0.5 ? 'half' : r > 0 ? 'low' : 'miss';
    }
    if (r >= 1) return 'met';
    return final ? gradeOf(r) : 'progress';
  }
  const minutesOf = hm;
  /* a tracker's value on a day (weight lives in its own field) */
  const trackerValue = (x, day) => !day ? undefined : x.type === 'weight' ? day.weight : (day.values || {})[x.id];
  function hasValue(x, v) {
    if (v == null || v === '' || v === false) return false;
    if (x.type === 'check') return v === true || v === 1;
    if (x.type === 'count') return num(v) > 0;
    if (x.type === 'text') return typeof v === 'string' && !!v.trim();
    if (x.type === 'time') return isTime(String(v));
    return Number.isFinite(+v);
  }
  /* expected on this date by its frequency (weekly ones are judged per week) */
  const expectedOn = (x, date) => !x.archived && (x.freq === 'daily' || (x.freq === 'days' && x.days.includes(MB.ui.dow(date))));
  const judged = x => x.type === 'check' || x.target != null || x.freq !== 'any';
  /* A tracker's grade for one day. Counts start at zero, so "at most" is met with nothing logged; other types need a
     value. Ratings and times are graded by steps or minutes off; the rest by the target scale. */
  function trackerGrade(x, v, final) {
    const has = hasValue(x, v);
    if (x.type === 'count' && x.target) return targetStatus(has ? num(v) : 0, x.target, x.aim, final);
    if (!has) return final ? 'miss' : 'progress';
    if (x.target == null) return 'met';
    if (x.type === 'rating') { const d = x.aim === 'max' ? num(v) - x.target : x.aim === 'near' ? Math.abs(num(v) - x.target) : x.target - num(v); return GRADES[Math.max(0, 4 - Math.max(0, Math.round(d)))]; }
    if (x.type === 'time') {
      const diff = ((minutesOf(String(v)) - minutesOf(x.target) + 720 + 1440) % 1440) - 720;
      const off = x.aim === 'max' ? Math.max(0, diff) : x.aim === 'min' ? Math.max(0, -diff) : Math.max(0, Math.abs(diff) - 15);
      return off === 0 ? 'met' : off <= 15 ? 'good' : off <= 30 ? 'half' : off <= 60 ? 'low' : 'miss';
    }
    return targetStatus(num(v), x.target, x.aim, final);
  }
  const trackerDone = (x, v) => trackerGrade(x, v, true) === 'met';
  /* routines: the share of items checked */
  const routineRatio = (r, day) => r.items.length ? r.items.filter(i => ((day && day.checks[r.id]) || {})[i.id]).length / r.items.length : null;

  /* ---------- setup history ---------- */
  /* what judging a day needs, kept per date in history/<date> */
  function snapshot(s) {
    return { targets: clone(s.targets), nutrients: s.nutrients.map(n => ({ id: n.id, target: n.target, aim: n.aim })),
      trackers: s.trackers.map(x => ({ id: x.id, type: x.type, target: x.target, aim: x.aim, freq: x.freq, days: x.days, perWeek: x.perWeek, archived: x.archived })),
      routines: s.routines.map(r => ({ id: r.id, days: r.days, items: r.items.map(i => i.id), alertAt: r.alertAt })),
      calendar: s.calendar.filter(b => b.kind === 'session' && b.typeId).map(b => ({ id: b.id, days: b.days, start: b.start, end: b.end, typeId: b.typeId })),
      types: s.sessionTypes.map(x => ({ id: x.id, kind: x.kind, minutes: x.minutes, kcal: x.kcal })) };
  }
  function normalizeHistory(x, date) {
    if (!isObj(x)) return null;
    const list = k => Array.isArray(x[k]) ? x[k].filter(isObj) : [];
    const s = normalizeSettings({ targets: x.targets, nutrients: list('nutrients').map(n => ({ ...n, name: n.id || 'n' })), groups: [{ id: 'g', name: 'g' }],
      trackers: list('trackers').map(t => ({ ...t, name: t.id || 't', group: 'g' })), sessionKinds: [],
      routines: list('routines').map(r => ({ ...r, name: r.id || 'r', items: (Array.isArray(r.items) ? r.items : []).map(i => ({ id: String(isObj(i) ? i.id : i), name: String(isObj(i) ? i.id : i) })) })),
      sessionTypes: list('types').map(t => ({ ...t, name: t.id || 't' })), calendar: list('calendar').map(b => ({ ...b, kind: 'session' })) });
    return { date, ...snapshot(s), updatedAt: x.updatedAt || null };
  }
  /* The setup a past day is judged by: the snapshot's targets, frequencies and plan, with today's names. Things created
     later are left out; things deleted since are gone. */
  function settingsOn(cur, snap) {
    const byId = (list, id) => list.find(x => x.id === id);
    const out = { ...cur, targets: { ...snap.targets, aim: { ...DEFAULT_AIM, ...(snap.targets.aim || {}) } } };
    out.nutrients = cur.nutrients.map(n => { const x = byId(snap.nutrients, n.id); return x ? { ...n, target: x.target, aim: x.aim } : { ...n, target: null }; });
    out.trackers = cur.trackers.map(x => { const y = byId(snap.trackers, x.id); return y && y.type === x.type ? { ...x, target: y.target, aim: y.aim, freq: y.freq, days: y.days, perWeek: y.perWeek, archived: y.archived } : null; }).filter(Boolean);
    out.routines = snap.routines.map(y => { const r = byId(cur.routines, y.id); return r ? { ...r, days: y.days, alertAt: y.alertAt, items: r.items.filter(i => y.items.includes(i.id)) } : null; }).filter(Boolean);
    out.sessionTypes = cur.sessionTypes.map(t => { const y = byId(snap.types, t.id); return y ? { ...t, kind: y.kind || t.kind, minutes: y.minutes, kcal: y.kcal } : t; });
    out.calendar = [...cur.calendar.filter(b => b.kind !== 'session'),
      ...snap.calendar.filter(b => byId(cur.sessionTypes, b.typeId)).map(b => ({ ...b, kind: 'session', title: '', note: '', routineId: '', slotId: '' }))];
    return out;
  }
  /* ---------- two edits of one document (sync) ---------- */
  /* A day or the setup changed on two devices since they last synced: merge them against that last synced copy (base).
     Per key and per list item (by id): a side that left it as it was takes the other side's; both changed it, the newer
     document's value wins (remoteWins); removed on one side and untouched on the other, it goes. Lists of plain strings merge as sets.
     No base (never synced): the union. */
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const isIdList = a => Array.isArray(a) && a.every(x => isObj(x) && x.id != null);
  const isStrList = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  function merge3(b, l, r, remoteWins) {
    if (same(l, r)) return l;
    if (b !== undefined && same(l, b)) return r;
    if (b !== undefined && same(r, b)) return l;
    /* added on one side only, with nothing to compare against: keep it */
    if (b === undefined) { if (l === undefined) return r; if (r === undefined) return l; }
    if (isIdList(l) && isIdList(r) && (b == null || isIdList(b))) {
      const bm = new Map((b || []).map(x => [String(x.id), x])), lm = new Map(l.map(x => [String(x.id), x])), rm = new Map(r.map(x => [String(x.id), x])), out = [];
      const one = id => { const bx = bm.get(id), lx = lm.get(id), rx = rm.get(id);
        if (bx !== undefined && (!lx || !rx)) { const kept = lx || rx; return kept && !same(kept, bx) ? kept : null; }
        return !lx ? rx : !rx ? lx : merge3(bx, lx, rx, remoteWins); };
      for (const x of l) { const v = one(String(x.id)); if (v) out.push(v); }
      for (const x of r) if (!lm.has(String(x.id))) { const v = one(String(x.id)); if (v) out.push(v); }
      return out;
    }
    if (isStrList(l) && isStrList(r) && (b == null || isStrList(b))) {
      const bs = new Set(b || []), ls = new Set(l), rs = new Set(r);
      return [...new Set([...l, ...r])].filter(x => (ls.has(x) && rs.has(x)) || (ls.has(x) && !bs.has(x)) || (rs.has(x) && !bs.has(x)));
    }
    if (isObj(l) && isObj(r) && (b == null || isObj(b))) {
      const out = {}, bb = b || {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) { const v = merge3(b == null ? undefined : bb[k], l[k], r[k], remoteWins); if (v !== undefined) out[k] = v; }
      return out;
    }
    return remoteWins ? r : l;
  }
  const mergeable = path => path === 'settings/main' || /^days\//.test(path);
  function mergeDoc(path, base, local, remote) {
    const newer = !!remote && !!local && String(remote.updatedAt || '') > String(local.updatedAt || '');
    if (/^days\//.test(path)) { const date = path.slice(5), n = x => x == null ? x : normalizeDay(x, date); return merge3(n(base), n(local), n(remote), newer); }
    const n = x => x == null ? x : upgradeSettings(x);
    return merge3(n(base), n(local), n(remote), newer);
  }
  const gateOpen = (s, gate) => !gate || !gate.id || ((s.gates.find(g => g.id === gate.id) || { current: 1 }).current >= gate.at);

  const emptyDay = date => ({ date, values: {}, checks: {}, meals: [], sessions: [], weight: null, tags: [], note: '', updatedAt: null });
  function normalizeDay(d, date) {
    const e = emptyDay(date || (isObj(d) ? d.date : ''));
    if (!isObj(d)) return e;
    e.values = valueMap(d.values);
    /* v4: habits and tape measurements */
    const hab = habitMap(d.habits); for (const k of Object.keys(hab)) if (!(k in e.values)) e.values[k] = hab[k];
    if (isObj(d.measures)) for (const k of MEASURES) { const v = optNum(d.measures[k]); if (v != null && !(MEASURE_IDS[k] in e.values)) e.values[MEASURE_IDS[k]] = v; }
    if (isObj(d.checks)) for (const k of Object.keys(d.checks)) e.checks[k] = boolMap(d.checks[k]);
    if (isObj(d.morning) && Object.keys(d.morning).length) e.checks.morning = boolMap(d.morning);
    if (isObj(d.pt) && Object.keys(d.pt).length) e.checks.pt = boolMap(d.pt);
    if (Array.isArray(d.meals)) e.meals = d.meals.filter(isObj).map(m => {
      const out = { id: String(m.id || uid()), slot: String(m.slot || m.window || ''), name: String(m.name || 'Meal'),
        kcal: num(m.kcal), p: num(m.p != null ? m.p : m.protein), c: num(m.c != null ? m.c : m.carbs), f: num(m.f != null ? m.f : m.fat) };
      const n = numMap(m.n); if (Object.keys(n).length) out.n = n;
      /* where it came from: a food and how many servings, or a saved meal */
      if (m.foodId) out.foodId = String(m.foodId);
      if (m.qty != null && num(m.qty) > 0) out.qty = num(m.qty);
      if (m.tplId) out.tplId = String(m.tplId);
      return out;
    });
    if (Array.isArray(d.sessions)) e.sessions = d.sessions.filter(isObj).map(s => {
      const effort = optPos(s.effort);
      return { id: String(s.id || uid()), typeId: String(s.typeId || ''), name: String(s.name || 'Session'),
        kind: String(s.kind || ''), minutes: num(s.minutes), kcal: num(s.kcal), done: s.done !== false, notes: String(s.notes || ''),
        effort: effort == null ? null : Math.min(10, Math.max(1, Math.round(effort))), fields: valueMap(s.fields),
        sets: Array.isArray(s.sets) ? s.sets.filter(isObj).map(x => ({ ex: String(x.ex || ''), exerciseId: String(x.exerciseId || ''), wt: optNum(x.wt), reps: optNum(x.reps), reps2: optNum(x.reps2) })) : [] };
    });
    const w = d.weight != null ? d.weight : d.weightLb;
    e.weight = (w == null || w === '') ? null : num(w);
    e.tags = strList(d.tags);
    e.note = typeof d.note === 'string' ? d.note : '';
    if (d.updatedAt) e.updatedAt = d.updatedAt;
    return e;
  }
  const withN = (out, n) => { const m = numMap(n); if (Object.keys(m).length) out.n = m; return out; };
  function normalizeFood(f) {
    if (!isObj(f) || !String(f.name || '').trim()) return null;
    return withN({ id: String(f.id || slug(f.name)), name: String(f.name).trim(), category: String(f.category || ''), serving: String(f.serving || ''),
      kcal: num(f.kcal), p: num(f.p != null ? f.p : f.protein), c: num(f.c != null ? f.c : f.carbs), f: num(f.f != null ? f.f : f.fat), note: String(f.note || ''), updatedAt: f.updatedAt || null }, f.n);
  }
  function normalizeTemplate(t, slots) {
    if (!isObj(t) || !String(t.name || '').trim()) return null;
    const slot = String(t.slot || t.window || '');
    return withN({ id: String(t.id || slug(t.name)), name: String(t.name).trim(), slot: slots.some(s => s.id === slot) ? slot : (slots[0] ? slots[0].id : ''),
      kcal: num(t.kcal), p: num(t.p != null ? t.p : t.protein), c: num(t.c != null ? t.c : t.carbs), f: num(t.f != null ? t.f : t.fat), updatedAt: t.updatedAt || null }, t.n);
  }

  /* v1 (Claude artifact) exports */
  function isLegacy(data) {
    const s = data && data.settings;
    return !!(isObj(s) && (Array.isArray(s.windows) || isObj(s.belt) || Array.isArray(s.morning) || Array.isArray(s.pt)));
  }
  function migrateLegacy(data) {
    const s = clone(data.settings || {}); const n = {};
    n.name = s.name || ''; n.units = { weight: 'lb' }; n.targets = s.targets;
    n.goal = { weight: s.goal ? s.goal.weightLb : null, bodyFat: s.goal ? s.goal.bodyFat : null };
    n.mealSlots = s.windows || s.mealSlots; n.habits = s.habits;
    n.routines = Array.isArray(s.routines) ? s.routines : [];
    if (Array.isArray(s.morning) && s.morning.length) n.routines.push({ id: 'morning', name: 'Morning', items: s.morning });
    if (Array.isArray(s.pt) && s.pt.length) n.routines.push({ id: 'pt', name: 'PT', items: s.pt });
    const KN = { bjj: 'BJJ', strength: 'Strength', other: 'Other' };
    const kinds = []; (s.sessionTypes || []).forEach(t => { if (t.kind && !kinds.includes(t.kind)) kinds.push(t.kind); });
    n.sessionKinds = kinds.map(k => ({ id: k, name: KN[k] || k }));
    n.sessionTypes = s.sessionTypes; n.schedule = s.schedule;
    if (isObj(s.belt)) n.rank = { enabled: true, system: 'BJJ belt', levels: ['White', 'Blue', 'Purple', 'Brown', 'Black'], level: s.belt.rank || 'White', sublevelName: 'stripe',
      sublevel: s.belt.stripes || 0, maxSublevel: 4, history: (s.belt.promotions || []).map(p => ({ id: p.id, date: p.date, level: s.belt.rank || 'White', sublevel: p.stripes })),
      phases: (s.phases || []).map(p => ({ name: p.name, minSublevel: p.minStripes })) };
    if (s.updatedAt) n.updatedAt = s.updatedAt;
    Object.keys(n).forEach(k => { if (n[k] === undefined) delete n[k]; });
    const out = { app: MB.APP.id, version: VERSION, settings: n };
    if (Array.isArray(data.foods)) out.foods = data.foods;
    if (Array.isArray(data.templates)) out.templates = data.templates.map(t => ({ ...t, slot: t.slot || t.window }));
    if (Array.isArray(data.days)) out.days = data.days;
    return out;
  }

  /* merging */
  function mergeById(cur, inc, key) {
    const out = clone(cur || []);
    for (const it of ensureIds(named(inc), key)) {
      const i = out.findIndex(x => x.id === it.id);
      if (i >= 0) Object.assign(out[i], it); else out.push(it);
    }
    return out;
  }
  const LIST_KEYS = ['mealSlots', 'groups', 'trackers', 'nutrients', 'tags', 'sessionKinds', 'sessionTypes', 'exercises', 'gates', 'calendar'];
  function mergeSettings(cur, inc, warnings, summary, opts) {
    opts = opts || {};
    if (inc.updatedAt && !opts.partial) {
      if (cur.updatedAt && String(inc.updatedAt) <= String(cur.updatedAt)) { summary.push({ code: 'settingsKept' }); return cur; }
      summary.push({ code: 'settingsNewer' }); return normalizeSettings(inc);
    }
    const out = clone(cur); const changed = [];
    for (const k of Object.keys(inc)) {
      const v = inc[k];
      if (k === 'name' && typeof v === 'string') { out.name = v; changed.push('name'); }
      /* a v4 habits list becomes trackers in the first section */
      else if (k === 'habits' && Array.isArray(v)) {
        const group = (out.groups.find(g => g.id === 'habits') || out.groups[0] || { id: 'habits' }).id;
        const list = ensureIds(named(v)).map(x => habitToTracker(x, group));
        if (!out.groups.some(g => g.id === group)) out.groups.push({ id: group, name: tr('t.habits', 'Habits') });
        out.trackers = opts.replaceLists ? [...out.trackers.filter(x => x.group !== group), ...list] : mergeById(out.trackers, list);
        changed.push(`trackers (${v.length})`);
      }
      else if (['targets', 'goal', 'units', 'wave', 'progress'].includes(k) && isObj(v)) { Object.assign(out[k], v); changed.push(k); }
      else if (k === 'schedule' && isObj(v)) { const blocks = []; for (const day of DAYS) for (const id of (Array.isArray(v[day]) ? v[day] : [])) blocks.push({ id: `sched-${day}-${id}`, days: [day], kind: 'session', typeId: String(id) }); out.calendar = opts.replaceLists ? blocks : mergeById(out.calendar, blocks.map(b => ({ ...b, name: b.id }))); changed.push('schedule'); }
      else if (k === 'calendar' && Array.isArray(v)) { const blocks = v.filter(isObj).map(b => ({ ...b, name: b.title || b.typeId || b.routineId || b.slotId || b.kind || 'block' })); out.calendar = opts.replaceLists ? blocks : mergeById(out.calendar, blocks); changed.push(`calendar (${v.length})`); }
      else if (LIST_KEYS.includes(k) && Array.isArray(v)) { out[k] = opts.replaceLists ? ensureIds(named(v)) : mergeById(out[k], v); changed.push(`${k} (${v.length})`); }
      else if (k === 'routines' && Array.isArray(v)) {
        if (opts.replaceLists) out.routines = v;
        else for (const r of ensureIds(named(v))) {
          const i = out.routines.findIndex(x => x.id === r.id);
          if (i >= 0) { const cur = out.routines[i]; cur.name = r.name || cur.name; if (Array.isArray(r.items)) cur.items = mergeById(cur.items, r.items); if (Array.isArray(r.days)) cur.days = r.days; if ('alertAt' in r) cur.alertAt = r.alertAt; if ('alertText' in r) cur.alertText = r.alertText; }
          else out.routines.push(r);
        }
        changed.push(`routines (${v.length})`);
      }
      /* an old rank becomes a progression (its promotions become events, in planImport) */
      else if (k === 'rank' && isObj(v)) { const rp = rankToProgression(v); if (rp) { out.gates = mergeById(out.gates, [rp]); changed.push('gates'); } }
      else if (!['app', 'version', 'exportedAt', 'updatedAt'].includes(k)) warnings.push({ code: 'unknownField', vars: { key: k } });
    }
    if (changed.length) summary.push({ code: 'settingsUpdated', vars: { what: changed.join(', ') } });
    return normalizeSettings(out);
  }

  const TARGETS = ['foods', 'templates', 'days', 'events', 'history', 'settings.exercises', 'settings.calendar', 'settings.trackers', 'settings.habits', 'settings.mealSlots', 'settings.sessionKinds', 'settings.sessionTypes', 'settings.routines', 'settings.nutrients', 'settings.tags'];
  function wrapArray(target, arr) { return target.startsWith('settings.') ? { settings: { [target.slice(9)]: arr } } : { [target]: arr }; }
  const idsOf = v => (Array.isArray(v) ? v : []).map(x => typeof x === 'string' ? x : (isObj(x) ? String(x.id || x.date || (x.name ? slug(x.name) : '')) : '')).filter(Boolean);

  /* Turn parsed JSON into a plan against the current data. current = {settings, hasSettings, foods, templates, days}.
     Messages are {code, vars} so the app can translate them. */
  function planImport(raw, opts) {
    const mode = opts.mode || 'merge', cur = opts.current, target = opts.target;
    const errors = [], warnings = [], summary = [];
    const result = { ok: false, errors, warnings, summary, plan: null, profileName: null };
    let data = raw, partial = false;
    if (Array.isArray(data)) {
      if (!target) { errors.push({ code: 'needTarget' }); return result; }
      data = wrapArray(target, data); partial = target.startsWith('settings.');
    }
    if (!isObj(data)) { errors.push({ code: 'needObject' }); return result; }
    if (mode !== 'remove' && isLegacy(data)) { data = migrateLegacy(data); warnings.push({ code: 'legacy' }); }
    if (isObj(data.profile) && typeof data.profile.name === 'string') result.profileName = data.profile.name;
    const KNOWN = ['app', 'version', 'exportedAt', 'profile', 'settings', 'foods', 'templates', 'days', 'events', 'history'];
    Object.keys(data).forEach(k => { if (!KNOWN.includes(k)) warnings.push({ code: 'unknownSection', vars: { key: k } }); });
    if (!['settings', 'foods', 'templates', 'days', 'events', 'history'].some(k => k in data)) { errors.push({ code: 'nothing' }); return result; }
    const plan = { mode, settings: null, foods: { upsert: [], remove: [] }, templates: { upsert: [], remove: [] }, days: { upsert: [], remove: [] }, events: { upsert: [], remove: [] }, history: { upsert: [], remove: [] } };
    const settingsForSlots = () => plan.settings || cur.settings;
    const S = k => ({ section: k });

    if (mode === 'remove') {
      const rm = (key, curRows, keyName) => {
        const want = idsOf(data[key]); const have = new Set(curRows.map(r => r[keyName]));
        plan[key].remove = want.filter(id => have.has(id));
        const missing = want.filter(id => !have.has(id));
        if (missing.length) warnings.push({ code: 'unknownIds', vars: { section: key, n: missing.length, ids: missing.slice(0, 5).join(', ') + (missing.length > 5 ? ', ...' : '') } });
        if (plan[key].remove.length) summary.push({ code: 'removed', vars: { section: key, n: plan[key].remove.length } });
      };
      if ('foods' in data) rm('foods', cur.foods, 'id');
      if ('templates' in data) rm('templates', cur.templates, 'id');
      if ('days' in data) rm('days', cur.days, 'date');
      if ('events' in data) rm('events', cur.events || [], 'id');
      if ('history' in data) rm('history', cur.history || [], 'date');
      if (isObj(data.settings)) {
        const s = clone(cur.settings); const changed = [];
        for (const k of Object.keys(data.settings)) {
          const v = data.settings[k], key = k === 'habits' ? 'trackers' : k;
          if ([...LIST_KEYS, 'routines'].includes(key)) { const ids = idsOf(v); const before = s[key].length; s[key] = s[key].filter(x => !ids.includes(x.id)); if (s[key].length !== before) changed.push(`${key} -${before - s[key].length}`); }
          else if (k === 'routineItems' && isObj(v)) { for (const rid of Object.keys(v)) { const r = s.routines.find(x => x.id === rid); if (!r) { warnings.push({ code: 'unknownIds', vars: { section: 'routines', n: 1, ids: rid } }); continue; } const ids = idsOf(v[rid]); const before = r.items.length; r.items = r.items.filter(x => !ids.includes(x.id)); if (r.items.length !== before) changed.push(`${rid} -${before - r.items.length}`); } }
          else warnings.push({ code: 'notRemovable', vars: { key: k } });
        }
        if (changed.length) { plan.settings = normalizeSettings(s); summary.push({ code: 'settingsRemoved', vars: { what: changed.join(', ') } }); }
      }
    } else {
      if ('settings' in data) {
        if (!isObj(data.settings)) errors.push({ code: 'settingsObject' });
        else if (mode === 'replace' && !partial) { plan.settings = normalizeSettings(data.settings); summary.push({ code: 'settingsReplaced' }); }
        else if (cur.hasSettings === false && !partial) { plan.settings = normalizeSettings(data.settings); summary.push({ code: 'settingsFresh' }); }
        else plan.settings = mergeSettings(cur.settings, data.settings, warnings, summary, { partial, replaceLists: mode === 'replace' });
      }
      const rowsSection = (key, normalize, idKey) => {
        if (!(key in data)) return;
        if (!Array.isArray(data[key])) { errors.push({ code: 'mustBeList', vars: S(key) }); return; }
        const rows = []; const seen = new Set();
        data[key].forEach((r, i) => {
          const n = normalize(r);
          if (!n) { errors.push({ code: key === 'days' ? 'needsDate' : 'needsName', vars: { section: key, i } }); return; }
          if (seen.has(n[idKey])) { warnings.push({ code: 'duplicate', vars: { section: key, id: n[idKey] } }); const j = rows.findIndex(x => x.n[idKey] === n[idKey]); rows.splice(j, 1); }
          seen.add(n[idKey]); rows.push({ n, raw: r });
        });
        const curRows = cur[key] || [], curById = new Map(curRows.map(r => [r[idKey], r]));
        const ALIAS = { protein: 'p', carbs: 'c', fat: 'f', window: 'slot' };
        let added = 0, updated = 0, kept = 0;
        for (const { n, raw } of rows) {
          const ex = curById.get(n[idKey]);
          if (ex && mode === 'merge' && ex.updatedAt && n.updatedAt && String(n.updatedAt) < String(ex.updatedAt)) { kept++; continue; }
          if (ex && mode === 'merge' && key !== 'days' && key !== 'history') {
            const patch = {}; Object.keys(raw).forEach(k => { const kk = ALIAS[k] || k; if (kk in n && kk !== 'id') patch[kk] = n[kk]; });
            plan[key].upsert.push({ ...ex, ...patch, id: ex.id, updatedAt: n.updatedAt || null }); updated++; continue;
          }
          if (ex) updated++; else added++;
          plan[key].upsert.push(n);
        }
        if (mode === 'replace') { const inc = new Set(rows.map(r => r.n[idKey])); plan[key].remove = curRows.filter(r => !inc.has(r[idKey])).map(r => r[idKey]); }
        summary.push({ code: 'rows', vars: { section: key, added, updated, kept, removed: plan[key].remove.length } });
      };
      rowsSection('foods', normalizeFood, 'id');
      rowsSection('templates', t => normalizeTemplate(t, settingsForSlots().mealSlots), 'id');
      rowsSection('days', d => (isObj(d) && isDate(d.date)) ? normalizeDay(d, d.date) : null, 'date');
      rowsSection('events', normalizeEvent, 'id');
      rowsSection('history', x => (isObj(x) && isDate(x.date)) ? normalizeHistory(x, x.date) : null, 'date');
      /* an old rank's promotions become events */
      if (isObj(data.settings) && isObj(data.settings.rank)) {
        const have = new Set([...plan.events.upsert.map(e => e.id), ...(cur.events || []).map(e => e.id)]);
        const moved = rankEvents(data.settings.rank).filter(e => !have.has(e.id));
        plan.events.upsert.push(...moved);
        if (moved.length || rankToProgression(data.settings.rank)) summary.push({ code: 'rankMoved', vars: { n: moved.length } });
      }
      /* a v4 file: measurement trackers with values come back from the archive */
      if (plan.settings && isObj(data.settings) && isV4Settings(data.settings)) unarchiveUsed(plan.settings, [...plan.days.upsert, ...cur.days]);
    }
    const touches = !!plan.settings || ['foods', 'templates', 'days', 'events', 'history'].some(k => plan[k].upsert.length || plan[k].remove.length);
    if (!errors.length && !touches) warnings.push({ code: 'noChange' });
    result.ok = !errors.length && touches;
    result.plan = plan;
    return result;
  }

  function exportProfile(cur, scope) {
    scope = scope || {};
    const out = { app: MB.APP.id, version: VERSION, exportedAt: new Date().toISOString(), profile: { name: cur.profileName || '' } };
    if (scope.kind !== 'days') { out.settings = cur.settings; out.foods = cur.foods; out.templates = cur.templates; }
    if (scope.kind !== 'setup') {
      out.days = scope.since ? cur.days.filter(d => d.date >= scope.since) : cur.days;
      const evs = cur.events || []; out.events = scope.since ? evs.filter(e => (e.end || e.date) >= scope.since) : evs;
    }
    /* the setup each stretch of days was judged by */
    out.history = cur.history || [];
    return out;
  }
  const convertWeight = (v, from, to) => (v == null || from === to) ? v : Math.round((from === 'lb' ? v * 0.45359237 : v / 0.45359237) * 10) / 10;

  /* Starter foods: whole and basic foods with reference values (USDA FoodData Central, rounded). Servings: qty + unit + grams. */
  const FOODS = [
    ['chicken-breast', 'proteins', 100, 'g', 100, 165, 31, 0, 3.6], ['chicken-thigh', 'proteins', 100, 'g', 100, 209, 26, 0, 11], ['ground-beef-85', 'proteins', 100, 'g', 100, 246, 26, 0, 15.5],
    ['ground-beef-93', 'proteins', 100, 'g', 100, 182, 25, 0, 8.7], ['ground-turkey', 'proteins', 100, 'g', 100, 176, 23, 0, 9], ['sirloin', 'proteins', 100, 'g', 100, 206, 29, 0, 9],
    ['pork-loin', 'proteins', 100, 'g', 100, 196, 29, 0, 8], ['salmon', 'proteins', 100, 'g', 100, 206, 22, 0, 12], ['cod', 'proteins', 100, 'g', 100, 105, 23, 0, 0.9],
    ['shrimp', 'proteins', 100, 'g', 100, 99, 24, 0, 0.3], ['tuna-can', 'proteins', 100, 'g', 100, 116, 26, 0, 0.8], ['tofu-firm', 'proteins', 100, 'g', 100, 144, 17, 3, 9], ['deli-turkey', 'proteins', 100, 'g', 100, 104, 17, 4, 2],
    ['egg', 'dairy', 1, 'large', 50, 72, 6.3, 0.4, 4.8], ['egg-whites', 'dairy', 100, 'g', 100, 52, 11, 0.7, 0.2], ['greek-yogurt-0', 'dairy', 170, 'g', 170, 100, 17, 6, 0.7], ['greek-yogurt-2', 'dairy', 170, 'g', 170, 124, 17, 7, 3],
    ['cottage-cheese', 'dairy', 1, 'cup', 226, 190, 25, 10, 5], ['milk-whole', 'dairy', 1, 'cup', 244, 149, 8, 12, 8], ['milk-2', 'dairy', 1, 'cup', 244, 122, 8, 12, 5], ['milk-skim', 'dairy', 1, 'cup', 245, 83, 8, 12, 0.2],
    ['cheddar', 'dairy', 28, 'g', 28, 114, 6.4, 0.9, 9.4], ['mozzarella', 'dairy', 28, 'g', 28, 72, 7, 0.8, 4.5], ['parmesan', 'dairy', 1, 'tbsp', 5, 21, 1.4, 0.2, 1.4], ['butter', 'dairy', 1, 'tbsp', 14, 102, 0.1, 0, 11.5],
    ['white-rice', 'grains', 1, 'cup', 158, 205, 4.3, 45, 0.4], ['brown-rice', 'grains', 1, 'cup', 195, 216, 5, 45, 1.8], ['quinoa', 'grains', 1, 'cup', 185, 222, 8, 39, 3.6], ['oats', 'grains', 40, 'g', 40, 152, 5.3, 27, 2.6],
    ['pasta', 'grains', 1, 'cup', 140, 221, 8, 43, 1.3], ['sweet-potato', 'grains', 1, 'medium', 114, 103, 2.3, 24, 0.2], ['potato', 'grains', 1, 'medium', 173, 164, 4.6, 37, 0.2], ['wheat-bread', 'grains', 1, 'slice', 32, 82, 4, 14, 1.1],
    ['white-bread', 'grains', 1, 'slice', 28, 75, 2.5, 14, 1], ['corn-tortilla', 'grains', 1, 'piece', 26, 60, 1.5, 12, 0.8], ['flour-tortilla', 'grains', 1, 'piece', 45, 146, 4, 24, 3.6], ['black-beans', 'grains', 1, 'cup', 172, 227, 15, 41, 0.9],
    ['chickpeas', 'grains', 1, 'cup', 164, 269, 14.5, 45, 4.2], ['lentils', 'grains', 1, 'cup', 198, 230, 18, 40, 0.8], ['edamame', 'grains', 1, 'cup', 155, 188, 18.5, 14, 8],
    ['banana', 'fruit', 1, 'medium', 118, 105, 1.3, 27, 0.4], ['apple', 'fruit', 1, 'medium', 182, 95, 0.5, 25, 0.3], ['orange', 'fruit', 1, 'medium', 131, 62, 1.2, 15, 0.2], ['blueberries', 'fruit', 1, 'cup', 148, 84, 1.1, 21, 0.5],
    ['strawberries', 'fruit', 1, 'cup', 152, 49, 1, 12, 0.5], ['grapes', 'fruit', 1, 'cup', 151, 104, 1.1, 27, 0.2], ['mango', 'fruit', 1, 'cup', 165, 99, 1.4, 25, 0.6], ['watermelon', 'fruit', 1, 'cup', 152, 46, 0.9, 11.5, 0.2],
    ['avocado', 'fruit', 1, 'half', 68, 114, 1.3, 6, 10.5],
    ['broccoli', 'veg', 1, 'cup', 156, 55, 3.7, 11, 0.6], ['spinach', 'veg', 2, 'cup', 60, 14, 1.7, 2.2, 0.2], ['carrot', 'veg', 1, 'medium', 61, 25, 0.6, 6, 0.1], ['bell-pepper', 'veg', 1, 'medium', 119, 37, 1.2, 7, 0.4],
    ['tomato', 'veg', 1, 'medium', 123, 22, 1.1, 4.8, 0.2], ['cucumber', 'veg', 1, 'cup', 104, 16, 0.7, 3.8, 0.1], ['onion', 'veg', 1, 'medium', 110, 44, 1.2, 10, 0.1], ['kimchi', 'veg', 1, 'cup', 150, 22, 1.7, 3.6, 0.8],
    ['olive-oil', 'fats', 1, 'tbsp', 14, 119, 0, 0, 13.5], ['almonds', 'fats', 28, 'g', 28, 164, 6, 6, 14], ['walnuts', 'fats', 28, 'g', 28, 185, 4.3, 3.9, 18.5], ['peanut-butter', 'fats', 2, 'tbsp', 32, 188, 8, 7, 16],
    ['chia', 'fats', 2, 'tbsp', 28, 138, 4.7, 12, 8.7], ['dark-chocolate', 'fats', 28, 'g', 28, 170, 2.2, 13, 12],
    ['coffee', 'drinks', 240, 'ml', 240, 2, 0.3, 0, 0], ['oj', 'drinks', 1, 'cup', 248, 112, 1.7, 26, 0.5], ['wine', 'drinks', 150, 'ml', 150, 123, 0.1, 4, 0], ['beer', 'drinks', 355, 'ml', 355, 153, 1.6, 13, 0],
    ['whey', 'supp', 1, 'scoop', 30, 120, 24, 3, 1.5], ['casein', 'supp', 1, 'scoop', 33, 120, 24, 3, 1], ['pea-protein', 'supp', 1, 'scoop', 33, 120, 24, 1, 2], ['collagen', 'supp', 1, 'scoop', 20, 70, 18, 0, 0], ['creatine', 'supp', 5, 'g', 5, 0, 0, 0, 0]
  ];
  const fmtQty = q => q === 0.5 ? '½' : q === 0.25 ? '¼' : q === 0.75 ? '¾' : String(q);
  function serving(qty, unit, g) {
    const { unit: u } = MB.i18n;
    if (unit === 'g' || unit === 'ml') return `${qty} ${unit}`;
    return `${fmtQty(qty)} ${u('u.' + unit, qty)} (${g} g)`;
  }
  const demoImage = name => 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(name + ' exercise gif');
  const demoVideo = name => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' exercise form');
  /* Starter packs: a whole profile to adjust. general is the old example; the others add sections, trackers,
     categories with fields, workouts, a week, targets and tags for one kind of person. */
  const PACKS = ['general', 'bjj', 'runner', 'fatloss'];
  const addMin = (hhmm, n) => { const m = (hm(hhmm) + n) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  function starterProfile(pack, system) {
    const { t } = MB.i18n;
    pack = PACKS.includes(pack) ? pack : 'general';
    system = SYSTEMS.includes(system) ? system : defaultSystem();
    const US = system === 'us', LEN = US ? 'in' : 'cm', DIST = US ? 'mi' : 'km';
    const ex = (id, key, extra) => ({ id, name: t('ex.' + key), image: demoImage(t('ex.' + key)), video: demoVideo(t('ex.' + key)), ...(extra || {}) });
    const T = (id, name, type, group, extra) => ({ id, name, type, group, ...(extra || {}) });
    const B = (id, days, start, end, kind, extra) => ({ id, days, start, end, kind, ...(extra || {}) });
    const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const upperPlan = [{ label: 'A', items: [{ exerciseId: 'push-up', sets: 4, reps: '8-12', rir: '1', rest: '60 s' }, { exerciseId: 'one-arm-row', sets: 4, reps: '10-12', rir: '1', rest: '60 s' }] }, { label: 'B', items: [{ exerciseId: 'db-press', sets: 3, reps: '8-12', rir: '1' }, { exerciseId: 'lateral-raise', sets: 3, reps: '12-15', rir: '1' }] }];
    const lowerPlan = [{ label: 'A', items: [{ exerciseId: 'goblet-squat', sets: 4, reps: '8-12', rir: '2', rest: '90 s' }, { exerciseId: 'rdl', sets: 3, reps: '10-12', rir: '2' }] }, { label: 'B', items: [{ exerciseId: 'split-squat', sets: 3, reps: '8-10', rir: '2' }, { exerciseId: 'calf-raise', sets: 3, reps: '12-15' }, { exerciseId: 'plank', sets: 3, reps: '30' }] }];
    const groups = { habits: { id: 'habits', name: t('t.habits') }, recovery: { id: 'recovery', name: t('pk.recovery') }, body: { id: 'body', name: t('t.body') } };
    const tr = {
      water: T('water', t('st.water'), 'count', 'habits', { target: 8, unit: t('st.glasses') }),
      steps: T('steps', t('st.steps'), 'number', 'habits', { target: 10000, aim: 'min', unit: t('pk.stepsUnit'), freq: 'daily' }),
      stepsCheck: T('steps', t('st.steps'), 'check', 'habits'),
      stretch: T('stretch', t('st.stretch'), 'check', 'habits'),
      sleep: g => T('sleep', t('pk.sleep'), 'duration', g, { target: g === 'recovery' ? 480 : 450, aim: 'min' }),
      soreness: T('soreness', t('pk.soreness'), 'rating', 'recovery', { target: 2, aim: 'max' }),
      energy: T('energy', t('pk.energy'), 'rating', 'recovery', { target: 4, aim: 'min' }),
      rhr: T('rhr', t('pk.restingHr'), 'number', 'recovery', { unit: t('pk.bpm'), freq: 'any' }),
      veggies: T('veggies', t('pk.veggies'), 'count', 'habits', { target: 5, unit: t('pk.servings') }),
      noLate: T('no-late-snacks', t('pk.noLate'), 'check', 'habits'),
      weight: extra => T('weight', t('m.weight'), 'weight', 'body', extra),
      waist: extra => T('m_waist', t('m.waist'), 'number', 'body', { unit: LEN, freq: 'any', ...(extra || {}) }),
      bodyFat: T('bodyFat', t('m.bodyFat'), 'number', 'body', { unit: '%', freq: 'any' })
    };
    const kinds = {
      strength: { id: 'strength', name: t('st.strength') },
      cardio: { id: 'cardio', name: t('st.cardio'), fields: [{ id: 'distance', name: t('pk.distance'), type: 'number', unit: DIST }] },
      mobility: { id: 'mobility', name: t('st.mobility') },
      bjj: { id: 'bjj', name: t('pk.bjjKind'), fields: [{ id: 'rounds', name: t('pk.rounds'), type: 'number' }, { id: 'focus', name: t('pk.focus'), type: 'text' }] },
      run: { id: 'run', name: t('pk.running'), fields: [{ id: 'distance', name: t('pk.distance'), type: 'number', unit: DIST }, { id: 'pace', name: t('pk.pace'), type: 'text' }] }
    };
    const types = {
      upper: { id: 'upper', name: t('st.upper'), kind: 'strength', minutes: 45, kcal: 300, plan: upperPlan },
      lower: { id: 'lower', name: t('st.lower'), kind: 'strength', minutes: 45, kcal: 320, plan: lowerPlan },
      run: { id: 'run', name: t('st.run'), kind: 'cardio', minutes: 30, kcal: 350 },
      yoga: { id: 'yoga', name: t('st.yoga'), kind: 'mobility', minutes: 45, kcal: 150 },
      bjjClass: { id: 'bjj-class', name: t('pk.class'), kind: 'bjj', minutes: 90, kcal: 750 },
      openMat: { id: 'open-mat', name: t('pk.openMat'), kind: 'bjj', minutes: 60, kcal: 500 },
      easy: { id: 'easy-run', name: t('pk.easyRun'), kind: 'run', minutes: 40, kcal: 420 },
      intervals: { id: 'intervals', name: t('pk.intervals'), kind: 'run', minutes: 45, kcal: 520 },
      long: { id: 'long-run', name: t('pk.longRun'), kind: 'run', minutes: 90, kcal: 950 },
      fullA: { id: 'full-a', name: t('pk.fullA'), kind: 'strength', minutes: 45, kcal: 300, plan: upperPlan },
      fullB: { id: 'full-b', name: t('pk.fullB'), kind: 'strength', minutes: 45, kcal: 320, plan: lowerPlan },
      walk: { id: 'walk', name: t('pk.walk'), kind: 'cardio', minutes: 45, kcal: 220 }
    };
    const tags = { sick: { id: 'sick', name: t('pk.sick'), color: 'slate', skip: true }, travel: { id: 'travel', name: t('pk.travel'), color: 'blue', skip: true },
      competition: { id: 'competition', name: t('pk.competition'), color: 'gold' }, race: { id: 'race', name: t('pk.race'), color: 'gold' }, social: { id: 'eating-out', name: t('pk.social'), color: 'orange' } };
    const day = (dinner, morning) => [
      B('sleep', DAYS, '23:00', '07:00', 'sleep', { title: t('st.sleepBlock') }), B('work', WEEKDAYS, '09:00', '17:00', 'work', { title: t('st.work') }),
      B('morning', DAYS, morning || '07:00', addMin(morning || '07:00', 10), 'routine', { routineId: 'morning' }),
      B('breakfast', DAYS, '07:30', '08:00', 'meal', { slotId: 'breakfast' }), B('lunch', DAYS, '12:30', '13:00', 'meal', { slotId: 'lunch' }),
      B('snacks', DAYS, '16:00', '16:15', 'meal', { slotId: 'snacks' }), B('dinner', DAYS, dinner || '19:00', addMin(dinner || '19:00', 45), 'meal', { slotId: 'dinner' })];
    const S = (id, days, start, end) => B(id, days, start, end, 'session', { typeId: id });
    const P = {
      general: { targets: { kcal: 2400, protein: 160 }, groups: ['habits', 'body'],
        trackers: [tr.water, tr.stepsCheck, tr.sleep('habits'), tr.stretch, tr.weight(), tr.waist(), tr.bodyFat], kinds: ['strength', 'cardio', 'mobility'], types: ['upper', 'lower', 'run', 'yoga'],
        calendar: [...day(), S('upper', ['mon', 'fri'], '17:30', '18:15'), S('lower', ['wed'], '17:30', '18:15'), S('run', ['tue', 'sat'], '07:15', '07:45'), S('yoga', ['thu'], '19:00', '19:45'),
          B('rest', ['sun'], '', '', 'rest', { title: t('st.rest') })], tags: ['sick', 'travel'] },
      bjj: { targets: { kcal: 2600, protein: 180 }, groups: ['habits', 'recovery', 'body'],
        trackers: [tr.water, tr.stretch, tr.sleep('recovery'), tr.soreness, tr.energy, tr.weight(), tr.bodyFat], kinds: ['bjj', 'strength', 'mobility'], types: ['bjjClass', 'openMat', 'upper', 'lower', 'yoga'],
        calendar: [...day('20:15'), S('bjj-class', ['mon', 'wed', 'fri'], '18:30', '20:00'), S('open-mat', ['sat'], '11:00', '12:00'), S('upper', ['tue'], '07:15', '08:00'), S('lower', ['thu'], '07:15', '08:00'), S('yoga', ['sun'], '10:00', '10:45')],
        tags: ['competition', 'sick', 'travel'],
        gates: [{ id: 'belt', name: t('pk.belt'), stages: t('pk.belts').split(',').map(x => x.trim()).filter(Boolean), current: 1 }] },
      runner: { targets: { kcal: 2600, protein: 140, carbs: 320 }, groups: ['habits', 'recovery', 'body'],
        trackers: [tr.water, tr.stretch, tr.sleep('recovery'), tr.rhr, tr.soreness, tr.weight()], kinds: ['run', 'strength', 'mobility'], types: ['easy', 'intervals', 'long', 'lower', 'yoga'],
        calendar: [...day(null, '06:45'), S('easy-run', ['tue', 'thu'], '07:00', '07:40'), S('intervals', ['wed'], '17:30', '18:15'), S('long-run', ['sun'], '08:00', '09:30'), S('lower', ['mon', 'fri'], '17:30', '18:15'), S('yoga', ['sat'], '09:00', '09:45')],
        tags: ['race', 'sick', 'travel'] },
      fatloss: { targets: { kcal: 2000, protein: 160, aim: { kcal: 'max' } }, groups: ['habits', 'body'],
        trackers: [tr.steps, tr.water, tr.veggies, tr.noLate, tr.sleep('habits'), tr.weight({ freq: 'daily' }), tr.waist({ freq: 'weekly', perWeek: 1 })], kinds: ['strength', 'cardio'], types: ['fullA', 'fullB', 'walk'],
        calendar: [...day(), S('full-a', ['mon', 'fri'], '17:30', '18:15'), S('full-b', ['wed'], '17:30', '18:15'), S('walk', ['tue', 'thu'], '18:00', '18:45'), S('walk', ['sat', 'sun'], '10:00', '10:45')],
        tags: ['social', 'sick', 'travel'] }
    }[pack];
    const cal = P.calendar.map((b, i) => ({ ...b, id: P.calendar.findIndex(x => x.id === b.id) === i ? b.id : b.id + '-' + i }));
    return {
      app: MB.APP.id, version: VERSION, profile: { name: '' },
      settings: {
        name: '', units: { system, weight: US ? 'lb' : 'kg' }, dayStart: '00:00',
        targets: { kcal: P.targets.kcal, protein: P.targets.protein, carbs: P.targets.carbs || 0, fat: 0, aim: { ...DEFAULT_AIM, ...(P.targets.aim || {}) } },
        nutrients: [], goal: { weight: null, bodyFat: null, note: '', band: null, milestones: [] },
        mealSlots: [{ id: 'breakfast', name: t('st.breakfast') }, { id: 'lunch', name: t('st.lunch') }, { id: 'dinner', name: t('st.dinner') }, { id: 'snacks', name: t('st.snacks') }],
        groups: P.groups.map(g => groups[g]), trackers: P.trackers,
        exercises: [ex('cat-cow', 'catcow'), ex('hip-circles', 'hips', { perSide: true }), ex('squat', 'squats'), ex('push-up', 'pushups'), ex('one-arm-row', 'row', { perSide: true }), ex('db-press', 'press'),
          ex('lateral-raise', 'lateral'), ex('goblet-squat', 'goblet'), ex('rdl', 'rdl'), ex('split-squat', 'split', { perSide: true }), ex('calf-raise', 'calf'), ex('plank', 'plank', { unit: 'sec' })],
        routines: [{ id: 'morning', name: t('st.morning'), days: [], items: [{ id: 'cat-cow', name: t('st.catcow'), target: '10', exerciseId: 'cat-cow' }, { id: 'hip-circles', name: t('st.hips'), target: t('st.eachWay'), exerciseId: 'hip-circles' }, { id: 'squats', name: t('st.squats'), target: '15', exerciseId: 'squat' }, { id: 'push-ups', name: t('st.pushups'), target: '10', exerciseId: 'push-up' }] }],
        sessionKinds: P.kinds.map(k => kinds[k]), sessionTypes: P.types.map(k => types[k]), calendar: cal,
        gates: P.gates || [], wave: { start: null, pattern: [] }, tags: P.tags.map(k => tags[k]),
        progress: { hide: [] }
      },
      foods: FOODS.map(([id, cat, qty, unit, g, kcal, p, c, f]) => ({ id, name: t('food.' + id), category: t('cat.' + cat), serving: serving(qty, unit, g), kcal, p, c, f, note: cat === 'supp' ? t('u.checkLabel') : '' })),
      templates: [{ id: 'oats-and-whey', name: t('st.oats'), slot: 'breakfast', kcal: 420, p: 34, c: 55, f: 6 }, { id: 'chicken-rice-bowl', name: t('st.bowl'), slot: 'lunch', kcal: 650, p: 55, c: 75, f: 12 }]
    };
  }

  /* Field reference shown on Get started (English; the README has the same) */
  const DOCS = [
    { key: 'settings', fields: ['name', 'units.system', 'dayStart', 'targets', 'targets.aim', 'nutrients', 'goal', 'goal.milestones', 'mealSlots', 'groups', 'trackers', 'exercises', 'routines', 'sessionKinds', 'sessionKinds.fields', 'sessionTypes', 'calendar', 'gates', 'wave', 'tags', 'progress.hide'],
      sample: { units: { system: 'metric' }, dayStart: '03:00', targets: { kcal: 2600, protein: 170, aim: { kcal: 'near', protein: 'min' } }, nutrients: [{ name: 'Fiber', unit: 'g', target: 30, aim: 'min' }],
        goal: { weight: 78, bodyFat: 12, band: [77, 79], milestones: [{ label: 'Month 4', date: '2027-01-15', weight: 78, bodyFat: 13.5 }] }, mealSlots: ['Breakfast', 'Lunch', 'Dinner'],
        groups: [{ id: 'habits', name: 'Habits' }, { id: 'recovery', name: 'Recovery' }],
        trackers: [{ id: 'water', name: 'Water', type: 'count', target: 8, unit: 'glasses', group: 'habits' }, { name: 'Stretch', type: 'check', freq: 'days', days: ['mon', 'wed', 'fri'], group: 'habits' },
          { id: 'sleep', name: 'Sleep', type: 'duration', target: 480, aim: 'min', group: 'recovery' }, { name: 'Soreness', type: 'rating', target: 2, aim: 'max', group: 'recovery' },
          { name: 'Bedtime', type: 'time', target: '23:00', aim: 'max', group: 'recovery' }, { name: 'Weight', type: 'weight', group: 'recovery' }, { id: 'm_waist', name: 'Waist', type: 'number', unit: 'cm', freq: 'weekly', perWeek: 1, group: 'recovery' }],
        exercises: [{ id: 'push-up', name: 'Push-up', cues: 'Elbows 45°', perSide: false, gate: { id: 'wrist', at: 3 } },
          { name: 'Banded shoulder ER, slow', base: 'band-external-rotation', unit: 'reps', perSide: true, cues: 'Light band, 3 s down' },
          { name: 'Wall neck bridge', pm: ['neck'], sm: ['traps'], steps: ['Stand facing a wall, forehead on a folded towel.', 'Lean in and hold, chin tucked.'], eq: ['wall', 'towel'], unit: 'sec', video: 'https://youtube.com/...' }],
        routines: [{ id: 'morning', name: 'Morning mobility', days: ['mon', 'wed', 'fri'], items: [{ name: 'Cat-cow', target: '10' }] }],
        sessionKinds: [{ id: 'bjj', name: 'BJJ', color: 'blue', fields: [{ id: 'rounds', name: 'Rounds', type: 'number' }, { name: 'Focus', type: 'text' }] }, 'Strength'],
        sessionTypes: [{ id: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, plan: [{ label: 'Warm-up', log: false, items: [{ exerciseId: 'cat-cow', sets: 1, reps: '10' }] }, { label: 'A', items: [{ exerciseId: 'push-up', sets: 4, reps: '8-12', rir: '1', rest: '60 s' }] }] }],
        calendar: [{ days: ['mon'], start: '07:15', end: '08:00', kind: 'session', typeId: 'upper' }, { days: ['mon', 'tue'], start: '23:00', end: '07:00', kind: 'sleep', title: 'Sleep' }],
        gates: [{ id: 'wrist', name: 'Wrist', stages: ['Phase 1', 'Phase 2', 'Phase 3'], current: 1 }, { id: 'belt', name: 'BJJ belt', stages: ['White', 'Blue', 'Purple', 'Brown', 'Black'], current: 1 }],
        wave: { start: '2026-09-21', pattern: ['ramp', 'ramp', 'full', 'deload'] },
        tags: [{ id: 'sick', name: 'Sick', color: 'slate', skip: true }, { id: 'travel', name: 'Travel', color: 'olive', skip: true }, { id: 'competition', name: 'Competition', color: 'gold' }] } },
    { key: 'foods', fields: ['name', 'category', 'serving', 'kcal', 'p', 'c', 'f', 'n', 'note'], sample: [{ name: 'Chicken breast, cooked', category: 'Proteins', serving: '100 g', kcal: 165, p: 31, c: 0, f: 3.6, n: { fiber: 0 } }] },
    { key: 'templates', fields: ['name', 'slot', 'kcal', 'p', 'c', 'f', 'n'], sample: [{ name: 'Oats and whey', slot: 'breakfast', kcal: 420, p: 34, c: 55, f: 6, n: { fiber: 6 } }] },
    { key: 'days', fields: ['date', 'values', 'checks', 'meals', 'sessions', 'sessions.effort', 'sessions.fields', 'weight', 'tags', 'note'],
      sample: [{ date: '2026-09-01', values: { water: 6, stretch: true, sleep: 450, soreness: 2, m_waist: 84 }, checks: { morning: ['cat-cow'] },
        meals: [{ slot: 'breakfast', name: 'Oats and whey', kcal: 420, p: 34, c: 55, f: 6, n: { fiber: 6 }, tplId: 'oats-and-whey' }, { slot: 'lunch', name: 'Banana ×2', kcal: 210, p: 2.6, c: 54, f: 0.8, foodId: 'banana', qty: 2 }],
        sessions: [{ typeId: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, effort: 7, sets: [{ ex: 'Push-up', wt: null, reps: 12 }, { ex: 'One-arm row', wt: 50, reps: 10, reps2: 9 }] },
          { name: 'BJJ class', kind: 'bjj', minutes: 90, effort: 8, fields: { rounds: 6, focus: 'Guard retention' } }], weight: 79.4, tags: ['competition'] }] },
    { key: 'events', fields: ['id', 'date', 'end', 'time', 'title', 'tag', 'big', 'offPlan', 'result', 'note'],
      sample: [{ id: 'fall-open', date: '2026-10-18', time: '09:00', title: 'Fall Open', tag: 'competition', big: true, offPlan: true, result: '2 wins, bronze' },
        { date: '2026-11-25', end: '2026-11-29', title: 'Thanksgiving trip', tag: 'travel' }, { date: '2026-09-29', time: '16:00', title: 'Physio: wrist', note: 'Ask about Phase 2' }] },
    { key: 'history', fields: ['date', 'targets', 'nutrients', 'trackers', 'routines', 'calendar', 'types'],
      sample: [{ date: '2026-09-01', targets: { kcal: 2400, protein: 160, carbs: 0, fat: 0, aim: { kcal: 'near', protein: 'min', carbs: 'near', fat: 'near' } },
        trackers: [{ id: 'water', type: 'count', target: 8, aim: 'min', freq: 'daily' }], routines: [{ id: 'morning', days: [], items: ['cat-cow'] }],
        calendar: [{ id: 'upper', days: ['mon'], start: '07:15', end: '08:00', typeId: 'upper' }], types: [{ id: 'upper', kind: 'strength', minutes: 45, kcal: 300 }] }] }
  ];
  const REMOVE_SAMPLE = { foods: ['banana'], days: ['2026-09-01'], events: ['fall-open'], settings: { trackers: ['water'], exercises: ['plank'], routineItems: { morning: ['cat-cow'] } } };

  MB.schema = { VERSION, DAYS, KINDS, PROGRESS_CARDS, MUSCLES, EQUIPMENT, SYSTEMS, UNIT_PAIRS, defaultSystem, convertUnit, merge3, mergeable, mergeDoc, AIMS, DEFAULT_AIM, KIND_COLORS, kindColors, WAVE, UNITS, MEASURES, MEASURE_IDS, CAT_KEYS, DEFAULT_SETTINGS,
    TRACKER_TYPES, FREQS, FIELD_TYPES, GRADES, GRADE_VALUE, gradeOf, rateGrade, targetStatus, trackerValue, hasValue, expectedOn, judged, trackerGrade, trackerDone, routineRatio,
    snapshot, normalizeHistory, settingsOn, normalizeSettings, upgradeSettings, isV4Settings, unarchiveUsed, normalizeTracker, normalizeEvent, eventOn, rankToProgression, rankEvents, emptyDay, normalizeDay, normalizeFood, normalizeTemplate,
    isLegacy, migrateLegacy, planImport, exportProfile, convertWeight, TARGETS, DOCS, REMOVE_SAMPLE, PACKS, starterProfile, FOODS, isObj, isTime, blockTitle, hm, duration, blocksFor, plannedFor, waveWeek, gateOpen, resolveExercise, demoImage, demoVideo };
})();
