/* Tally — profile schema: defaults, normalization, migration, import planning, export, starter profile. */
window.MB = window.MB || {};
(() => {
  'use strict';
  MB.APP = { id: 'tally', name: 'Tally', version: '2.2.0' };
  const { uid, clone, num, slug, isDate } = MB.ui;
  const VERSION = 4;
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const KINDS = ['session', 'routine', 'meal', 'sleep', 'work', 'rest', 'other'];
  const WAVE = ['ramp', 'full', 'deload'];
  const UNITS = ['reps', 'sec', 'm'];
  const CAT_KEYS = ['proteins', 'dairy', 'grains', 'fruit', 'veg', 'fats', 'drinks', 'supp'];
  const MEASURES = ['waist', 'chest', 'arm', 'thigh', 'calf', 'neck', 'bodyFat'];
  const BELT_COLORS = { white: '#F4F2EA', yellow: '#E8C547', orange: '#E07A2F', green: '#2E8B57', blue: '#2A56A6', purple: '#6B3FA0', brown: '#6E4A2B', black: '#141414', red: '#B4423C', coral: '#E8735A' };

  const DEFAULT_SETTINGS = {
    name: '', units: { weight: 'lb' },
    targets: { kcal: 2000, protein: 150, carbs: 0, fat: 0 },
    goal: { weight: null, bodyFat: null, note: '', band: null, milestones: [] },
    mealSlots: [], habits: [], routines: [],
    sessionKinds: [], sessionTypes: [],
    calendar: [], exercises: [], gates: [],
    wave: { start: null, pattern: [] },
    rank: { enabled: false, system: '', levels: [], level: '', sublevelName: 'stripe', sublevel: 0, maxSublevel: 4, history: [], phases: [] },
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
  const dayList = v => Array.isArray(v) ? v.map(x => String(x).toLowerCase().slice(0, 3)).filter(x => DAYS.includes(x)) : [];
  const optNum = v => (v == null || v === '') ? null : num(v);

  function normalizeRank(r) {
    const base = clone(DEFAULT_SETTINGS.rank);
    if (!isObj(r)) return base;
    base.enabled = !!r.enabled;
    if (typeof r.system === 'string') base.system = r.system;
    if (Array.isArray(r.levels)) base.levels = r.levels.map(String).filter(Boolean);
    if (typeof r.level === 'string') base.level = r.level;
    if (typeof r.sublevelName === 'string' && r.sublevelName) base.sublevelName = r.sublevelName;
    if (r.sublevel != null) base.sublevel = Math.max(0, Math.round(num(r.sublevel)));
    if (r.maxSublevel != null) base.maxSublevel = Math.max(0, Math.round(num(r.maxSublevel)));
    if (Array.isArray(r.history)) base.history = ensureIds(r.history.filter(x => isObj(x) && isDate(x.date)), 'date')
      .map(x => ({ id: x.id, date: x.date, level: x.level == null ? '' : String(x.level), sublevel: x.sublevel == null ? null : Math.round(num(x.sublevel)) }));
    if (Array.isArray(r.phases)) base.phases = r.phases.filter(p => isObj(p) && p.name).map(p => ({ name: String(p.name), minSublevel: Math.max(0, Math.round(num(p.minSublevel))) }));
    if (base.level && !base.levels.includes(base.level)) base.levels.push(base.level);
    return base;
  }
  /* exercises are referenced by id, or by name when a file was written by hand */
  function resolveExercise(ref, exercises) {
    if (!ref) return null;
    const id = String(ref); const byId = exercises.find(e => e.id === id); if (byId) return byId;
    const lc = id.trim().toLowerCase(); return exercises.find(e => e.name.toLowerCase() === lc) || exercises.find(e => e.id === slug(id)) || null;
  }
  function normalizeSettings(d) {
    d = isObj(d) ? d : {};
    const s = clone(DEFAULT_SETTINGS);
    if (typeof d.name === 'string') s.name = d.name;
    if (isObj(d.units) && (d.units.weight === 'kg' || d.units.weight === 'lb')) s.units.weight = d.units.weight;
    if (isObj(d.targets)) for (const k of ['kcal', 'protein', 'carbs', 'fat']) if (d.targets[k] != null) s.targets[k] = num(d.targets[k]);
    if (isObj(d.goal)) {
      s.goal.weight = optNum(d.goal.weight); s.goal.bodyFat = optNum(d.goal.bodyFat);
      if (typeof d.goal.note === 'string') s.goal.note = d.goal.note;
      if (Array.isArray(d.goal.band) && d.goal.band.length === 2 && d.goal.band.every(x => x != null && x !== '')) s.goal.band = [num(d.goal.band[0]), num(d.goal.band[1])].sort((a, b) => a - b);
      if (Array.isArray(d.goal.milestones)) s.goal.milestones = d.goal.milestones.filter(isObj).map(m => ({ label: String(m.label || ''), bodyFat: optNum(m.bodyFat), weight: optNum(m.weight), lean: optNum(m.lean), fat: optNum(m.fat), date: isDate(m.date) ? m.date : '' }));
    }
    if (Array.isArray(d.mealSlots)) s.mealSlots = ensureIds(named(d.mealSlots)).map(x => ({ id: x.id, name: x.name }));
    if (Array.isArray(d.habits)) s.habits = ensureIds(named(d.habits)).map(x => ({ id: x.id, name: x.name, target: x.target == null || x.target === '' || num(x.target) <= 0 ? null : Math.round(num(x.target)), unit: x.unit == null ? '' : String(x.unit) }));
    if (Array.isArray(d.exercises)) s.exercises = ensureIds(named(d.exercises)).map(e => ({ id: e.id, name: e.name, category: String(e.category || ''), image: String(e.image || ''), video: String(e.video || ''), cues: String(e.cues || e.note || ''),
      perSide: !!e.perSide, unit: UNITS.includes(e.unit) ? e.unit : 'reps', gate: isObj(e.gate) && e.gate.id ? { id: String(e.gate.id), at: Math.max(1, Math.round(num(e.gate.at) || 1)) } : null }));
    if (Array.isArray(d.gates)) s.gates = ensureIds(named(d.gates)).map(g => { const stages = Array.isArray(g.stages) ? g.stages.map(String).filter(Boolean) : []; return { id: g.id, name: g.name, stages, current: Math.min(Math.max(1, Math.round(num(g.current) || 1)), Math.max(1, stages.length)) }; });
    if (Array.isArray(d.routines)) s.routines = ensureIds(named(d.routines)).map(r => ({ id: r.id, name: r.name,
      items: ensureIds(named(r.items)).map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); return { id: it.id, name: it.name, target: it.target == null ? '' : String(it.target), exerciseId: ex ? ex.id : '' }; }),
      days: dayList(r.days), alertAt: r.alertAt == null || r.alertAt === '' ? null : Math.max(1, Math.round(num(r.alertAt))), alertText: String(r.alertText || '') }));
    if (Array.isArray(d.sessionKinds)) s.sessionKinds = ensureIds(named(d.sessionKinds)).map(k => ({ id: k.id, name: k.name }));
    if (Array.isArray(d.sessionTypes)) s.sessionTypes = ensureIds(named(d.sessionTypes)).map(t => ({ id: t.id, name: t.name,
      kind: t.kind ? String(t.kind) : (s.sessionKinds[0] ? s.sessionKinds[0].id : ''), minutes: num(t.minutes), kcal: num(t.kcal), note: String(t.note || ''),
      plan: Array.isArray(t.plan) ? ensureIds(t.plan.filter(isObj).map(b => ({ ...b, name: b.label || b.name || 'block' })), 'name').map(b => ({ id: b.id, label: String(b.label || b.name || ''), note: String(b.note || ''),
        items: ensureIds((Array.isArray(b.items) ? b.items : []).filter(isObj).map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); const name = String(it.name || (ex ? ex.name : it.exercise || '')).trim(); return { ...it, name }; }).filter(it => it.name), 'name')
          .map(it => { const ex = resolveExercise(it.exerciseId || it.exercise, s.exercises); return { id: it.id, exerciseId: ex ? ex.id : '', name: it.name, sets: Math.max(0, Math.round(num(it.sets))), reps: String(it.reps == null ? '' : it.reps), perSide: it.perSide == null ? !!(ex && ex.perSide) : !!it.perSide, rir: String(it.rir == null ? '' : it.rir), rest: String(it.rest || ''), note: String(it.note || '') }; }) })) : [] }));
    for (const t of s.sessionTypes) if (t.kind && !s.sessionKinds.some(k => k.id === t.kind)) s.sessionKinds.push({ id: t.kind, name: t.kind.charAt(0).toUpperCase() + t.kind.slice(1) });
    let cal = Array.isArray(d.calendar) ? d.calendar : [];
    if (!cal.length && isObj(d.schedule)) for (const day of DAYS) if (Array.isArray(d.schedule[day])) for (const id of d.schedule[day]) cal.push({ days: [day], kind: 'session', typeId: String(id) });
    s.calendar = ensureIds(cal.filter(isObj).map(b => ({ ...b, name: b.title || b.typeId || b.routineId || b.slotId || b.kind || 'block' })), 'name').map(b => {
      const type = b.typeId ? s.sessionTypes.find(x => x.id === String(b.typeId)) : null, routine = b.routineId ? s.routines.find(x => x.id === String(b.routineId)) : null, slot = b.slotId ? s.mealSlots.find(x => x.id === String(b.slotId)) : null;
      let kind = KINDS.includes(b.kind) ? b.kind : (type ? 'session' : routine ? 'routine' : slot ? 'meal' : 'other');
      if (kind === 'session' && !type) kind = 'other'; if (kind === 'routine' && !routine) kind = 'other'; if (kind === 'meal' && !slot) kind = 'other';
      return { id: b.id, days: dayList(b.days), start: padT(b.start), end: padT(b.end), kind, title: String(b.title || ''), note: String(b.note || ''), typeId: type ? type.id : '', routineId: routine ? routine.id : '', slotId: slot ? slot.id : '' };
    }).filter(b => b.days.length);
    if (isObj(d.wave)) s.wave = { start: isDate(d.wave.start) ? d.wave.start : null, pattern: Array.isArray(d.wave.pattern) ? d.wave.pattern.map(String).filter(x => WAVE.includes(x)) : [] };
    s.rank = normalizeRank(d.rank);
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
  const gateOpen = (s, gate) => !gate || !gate.id || ((s.gates.find(g => g.id === gate.id) || { current: 1 }).current >= gate.at);

  const emptyDay = date => ({ date, habits: {}, checks: {}, meals: [], sessions: [], weight: null, measures: {}, note: '', updatedAt: null });
  function normalizeDay(d, date) {
    const e = emptyDay(date || (isObj(d) ? d.date : ''));
    if (!isObj(d)) return e;
    e.habits = habitMap(d.habits);
    if (isObj(d.checks)) for (const k of Object.keys(d.checks)) e.checks[k] = boolMap(d.checks[k]);
    if (isObj(d.morning) && Object.keys(d.morning).length) e.checks.morning = boolMap(d.morning);
    if (isObj(d.pt) && Object.keys(d.pt).length) e.checks.pt = boolMap(d.pt);
    if (Array.isArray(d.meals)) e.meals = d.meals.filter(isObj).map(m => ({ id: String(m.id || uid()), slot: String(m.slot || m.window || ''), name: String(m.name || 'Meal'),
      kcal: num(m.kcal), p: num(m.p != null ? m.p : m.protein), c: num(m.c != null ? m.c : m.carbs), f: num(m.f != null ? m.f : m.fat) }));
    if (Array.isArray(d.sessions)) e.sessions = d.sessions.filter(isObj).map(s => ({ id: String(s.id || uid()), typeId: String(s.typeId || ''), name: String(s.name || 'Session'),
      kind: String(s.kind || ''), minutes: num(s.minutes), kcal: num(s.kcal), done: s.done !== false, notes: String(s.notes || ''),
      sets: Array.isArray(s.sets) ? s.sets.filter(isObj).map(x => ({ ex: String(x.ex || ''), exerciseId: String(x.exerciseId || ''), wt: optNum(x.wt), reps: optNum(x.reps), reps2: optNum(x.reps2) })) : [] }));
    const w = d.weight != null ? d.weight : d.weightLb;
    e.weight = (w == null || w === '') ? null : num(w);
    if (isObj(d.measures)) for (const k of MEASURES) { const v = optNum(d.measures[k]); if (v != null) e.measures[k] = v; }
    e.note = typeof d.note === 'string' ? d.note : '';
    if (d.updatedAt) e.updatedAt = d.updatedAt;
    return e;
  }
  function normalizeFood(f) {
    if (!isObj(f) || !String(f.name || '').trim()) return null;
    return { id: String(f.id || slug(f.name)), name: String(f.name).trim(), category: String(f.category || ''), serving: String(f.serving || ''),
      kcal: num(f.kcal), p: num(f.p != null ? f.p : f.protein), c: num(f.c != null ? f.c : f.carbs), f: num(f.f != null ? f.f : f.fat), note: String(f.note || ''), updatedAt: f.updatedAt || null };
  }
  function normalizeTemplate(t, slots) {
    if (!isObj(t) || !String(t.name || '').trim()) return null;
    const slot = String(t.slot || t.window || '');
    return { id: String(t.id || slug(t.name)), name: String(t.name).trim(), slot: slots.some(s => s.id === slot) ? slot : (slots[0] ? slots[0].id : ''),
      kcal: num(t.kcal), p: num(t.p != null ? t.p : t.protein), c: num(t.c != null ? t.c : t.carbs), f: num(t.f != null ? t.f : t.fat), updatedAt: t.updatedAt || null };
  }
  const habitDone = (hb, v) => hb.target ? num(v) >= hb.target : !!v;

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
  const LIST_KEYS = ['mealSlots', 'habits', 'sessionKinds', 'sessionTypes', 'exercises', 'gates', 'calendar'];
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
      else if (['targets', 'goal', 'units', 'wave'].includes(k) && isObj(v)) { Object.assign(out[k], v); changed.push(k); }
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
      else if (k === 'rank' && isObj(v)) { out.rank = { ...out.rank, ...v, history: Array.isArray(v.history) ? mergeById(out.rank.history, v.history, 'date') : out.rank.history }; changed.push('rank'); }
      else if (!['app', 'version', 'exportedAt', 'updatedAt'].includes(k)) warnings.push({ code: 'unknownField', vars: { key: k } });
    }
    if (changed.length) summary.push({ code: 'settingsUpdated', vars: { what: changed.join(', ') } });
    return normalizeSettings(out);
  }

  const TARGETS = ['foods', 'templates', 'days', 'settings.exercises', 'settings.calendar', 'settings.habits', 'settings.mealSlots', 'settings.sessionKinds', 'settings.sessionTypes', 'settings.routines'];
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
    const KNOWN = ['app', 'version', 'exportedAt', 'profile', 'settings', 'foods', 'templates', 'days'];
    Object.keys(data).forEach(k => { if (!KNOWN.includes(k)) warnings.push({ code: 'unknownSection', vars: { key: k } }); });
    if (!['settings', 'foods', 'templates', 'days'].some(k => k in data)) { errors.push({ code: 'nothing' }); return result; }
    const plan = { mode, settings: null, foods: { upsert: [], remove: [] }, templates: { upsert: [], remove: [] }, days: { upsert: [], remove: [] } };
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
      if (isObj(data.settings)) {
        const s = clone(cur.settings); const changed = [];
        for (const k of Object.keys(data.settings)) {
          const v = data.settings[k];
          if ([...LIST_KEYS, 'routines'].includes(k)) { const ids = idsOf(v); const before = s[k].length; s[k] = s[k].filter(x => !ids.includes(x.id)); if (s[k].length !== before) changed.push(`${k} -${before - s[k].length}`); }
          else if (k === 'routineItems' && isObj(v)) { for (const rid of Object.keys(v)) { const r = s.routines.find(x => x.id === rid); if (!r) { warnings.push({ code: 'unknownIds', vars: { section: 'routines', n: 1, ids: rid } }); continue; } const ids = idsOf(v[rid]); const before = r.items.length; r.items = r.items.filter(x => !ids.includes(x.id)); if (r.items.length !== before) changed.push(`${rid} -${before - r.items.length}`); } }
          else if (k === 'rank' && isObj(v) && Array.isArray(v.history)) { const ids = idsOf(v.history); const before = s.rank.history.length; s.rank.history = s.rank.history.filter(x => !ids.includes(x.id) && !ids.includes(x.date)); if (s.rank.history.length !== before) changed.push('rank.history'); }
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
        const curById = new Map(cur[key].map(r => [r[idKey], r]));
        const ALIAS = { protein: 'p', carbs: 'c', fat: 'f', window: 'slot' };
        let added = 0, updated = 0, kept = 0;
        for (const { n, raw } of rows) {
          const ex = curById.get(n[idKey]);
          if (ex && mode === 'merge' && ex.updatedAt && n.updatedAt && String(n.updatedAt) < String(ex.updatedAt)) { kept++; continue; }
          if (ex && mode === 'merge' && key !== 'days') {
            const patch = {}; Object.keys(raw).forEach(k => { const kk = ALIAS[k] || k; if (kk in n && kk !== 'id') patch[kk] = n[kk]; });
            plan[key].upsert.push({ ...ex, ...patch, id: ex.id, updatedAt: n.updatedAt || null }); updated++; continue;
          }
          if (ex) updated++; else added++;
          plan[key].upsert.push(n);
        }
        if (mode === 'replace') { const inc = new Set(rows.map(r => r.n[idKey])); plan[key].remove = cur[key].filter(r => !inc.has(r[idKey])).map(r => r[idKey]); }
        summary.push({ code: 'rows', vars: { section: key, added, updated, kept, removed: plan[key].remove.length } });
      };
      rowsSection('foods', normalizeFood, 'id');
      rowsSection('templates', t => normalizeTemplate(t, settingsForSlots().mealSlots), 'id');
      rowsSection('days', d => (isObj(d) && isDate(d.date)) ? normalizeDay(d, d.date) : null, 'date');
    }
    const touches = !!plan.settings || ['foods', 'templates', 'days'].some(k => plan[k].upsert.length || plan[k].remove.length);
    if (!errors.length && !touches) warnings.push({ code: 'noChange' });
    result.ok = !errors.length && touches;
    result.plan = plan;
    return result;
  }

  function exportProfile(cur, scope) {
    scope = scope || {};
    const out = { app: MB.APP.id, version: VERSION, exportedAt: new Date().toISOString(), profile: { name: cur.profileName || '' } };
    if (scope.kind !== 'days') { out.settings = cur.settings; out.foods = cur.foods; out.templates = cur.templates; }
    if (scope.kind !== 'setup') out.days = scope.since ? cur.days.filter(d => d.date >= scope.since) : cur.days;
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
  function starterProfile() {
    const { t } = MB.i18n;
    const ex = (id, key, extra) => ({ id, name: t('ex.' + key), image: demoImage(t('ex.' + key)), video: demoVideo(t('ex.' + key)), ...(extra || {}) });
    return {
      app: MB.APP.id, version: VERSION,
      settings: {
        name: '', units: { weight: 'lb' },
        targets: { kcal: 2400, protein: 160, carbs: 0, fat: 0 },
        goal: { weight: null, bodyFat: null, note: '', band: null, milestones: [] },
        mealSlots: [{ id: 'breakfast', name: t('st.breakfast') }, { id: 'lunch', name: t('st.lunch') }, { id: 'dinner', name: t('st.dinner') }, { id: 'snacks', name: t('st.snacks') }],
        habits: [{ id: 'water', name: t('st.water'), target: 8, unit: t('st.glasses') }, { id: 'steps', name: t('st.steps') }, { id: 'sleep', name: t('st.sleep') }, { id: 'stretch', name: t('st.stretch') }],
        exercises: [ex('cat-cow', 'catcow'), ex('hip-circles', 'hips', { perSide: true }), ex('squat', 'squats'), ex('push-up', 'pushups'), ex('one-arm-row', 'row', { perSide: true }), ex('db-press', 'press'),
          ex('lateral-raise', 'lateral'), ex('goblet-squat', 'goblet'), ex('rdl', 'rdl'), ex('split-squat', 'split', { perSide: true }), ex('calf-raise', 'calf'), ex('plank', 'plank', { unit: 'sec' })],
        routines: [{ id: 'morning', name: t('st.morning'), days: [], items: [{ id: 'cat-cow', name: t('st.catcow'), target: '10', exerciseId: 'cat-cow' }, { id: 'hip-circles', name: t('st.hips'), target: t('st.eachWay'), exerciseId: 'hip-circles' }, { id: 'squats', name: t('st.squats'), target: '15', exerciseId: 'squat' }, { id: 'push-ups', name: t('st.pushups'), target: '10', exerciseId: 'push-up' }] }],
        sessionKinds: [{ id: 'strength', name: t('st.strength') }, { id: 'cardio', name: t('st.cardio') }, { id: 'mobility', name: t('st.mobility') }],
        sessionTypes: [
          { id: 'upper', name: t('st.upper'), kind: 'strength', minutes: 45, kcal: 300, plan: [{ label: 'A', items: [{ exerciseId: 'push-up', sets: 4, reps: '8-12', rir: '1', rest: '60 s' }, { exerciseId: 'one-arm-row', sets: 4, reps: '10-12', rir: '1', rest: '60 s' }] }, { label: 'B', items: [{ exerciseId: 'db-press', sets: 3, reps: '8-12', rir: '1' }, { exerciseId: 'lateral-raise', sets: 3, reps: '12-15', rir: '1' }] }] },
          { id: 'lower', name: t('st.lower'), kind: 'strength', minutes: 45, kcal: 320, plan: [{ label: 'A', items: [{ exerciseId: 'goblet-squat', sets: 4, reps: '8-12', rir: '2', rest: '90 s' }, { exerciseId: 'rdl', sets: 3, reps: '10-12', rir: '2' }] }, { label: 'B', items: [{ exerciseId: 'split-squat', sets: 3, reps: '8-10', rir: '2' }, { exerciseId: 'calf-raise', sets: 3, reps: '12-15' }, { exerciseId: 'plank', sets: 3, reps: '30' }] }] },
          { id: 'run', name: t('st.run'), kind: 'cardio', minutes: 30, kcal: 350 }, { id: 'yoga', name: t('st.yoga'), kind: 'mobility', minutes: 45, kcal: 150 }],
        calendar: [
          { id: 'sleep', days: DAYS, start: '23:00', end: '07:00', kind: 'sleep', title: t('st.sleepBlock') },
          { id: 'work', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00', kind: 'work', title: t('st.work') },
          { id: 'morning', days: DAYS, start: '07:00', end: '07:10', kind: 'routine', routineId: 'morning' },
          { id: 'breakfast', days: DAYS, start: '07:30', end: '08:00', kind: 'meal', slotId: 'breakfast' }, { id: 'lunch', days: DAYS, start: '12:30', end: '13:00', kind: 'meal', slotId: 'lunch' },
          { id: 'snacks', days: DAYS, start: '16:00', end: '16:15', kind: 'meal', slotId: 'snacks' }, { id: 'dinner', days: DAYS, start: '19:00', end: '19:45', kind: 'meal', slotId: 'dinner' },
          { id: 'upper', days: ['mon', 'fri'], start: '17:30', end: '18:15', kind: 'session', typeId: 'upper' }, { id: 'lower', days: ['wed'], start: '17:30', end: '18:15', kind: 'session', typeId: 'lower' },
          { id: 'run', days: ['tue', 'sat'], start: '07:15', end: '07:45', kind: 'session', typeId: 'run' }, { id: 'yoga', days: ['thu'], start: '19:00', end: '19:45', kind: 'session', typeId: 'yoga' },
          { id: 'rest', days: ['sun'], start: '', end: '', kind: 'rest', title: t('st.rest') }],
        gates: [], wave: { start: null, pattern: [] },
        rank: { enabled: false, system: '', levels: [], level: '', sublevelName: 'stripe', sublevel: 0, maxSublevel: 4, history: [], phases: [] }
      },
      foods: FOODS.map(([id, cat, qty, unit, g, kcal, p, c, f]) => ({ id, name: t('food.' + id), category: t('cat.' + cat), serving: serving(qty, unit, g), kcal, p, c, f, note: cat === 'supp' ? t('u.checkLabel') : '' })),
      templates: [{ id: 'oats-and-whey', name: t('st.oats'), slot: 'breakfast', kcal: 420, p: 34, c: 55, f: 6 }, { id: 'chicken-rice-bowl', name: t('st.bowl'), slot: 'lunch', kcal: 650, p: 55, c: 75, f: 12 }]
    };
  }

  /* Field reference shown on Get started (English; the README has the same) */
  const DOCS = [
    { key: 'settings', fields: ['name', 'units.weight', 'targets', 'goal', 'mealSlots', 'habits', 'exercises', 'routines', 'sessionKinds', 'sessionTypes', 'calendar', 'gates', 'wave', 'rank'],
      sample: { units: { weight: 'kg' }, targets: { kcal: 2600, protein: 170 }, goal: { weight: 78, band: [77, 79], milestones: [{ label: 'Month 4', bodyFat: 13.5 }] }, mealSlots: ['Breakfast', 'Lunch', 'Dinner'], habits: [{ name: 'Water', target: 8, unit: 'glasses' }, 'Steps'],
        exercises: [{ id: 'push-up', name: 'Push-up', image: 'https://example.com/push-up.gif', video: 'https://youtube.com/...', cues: 'Elbows 45°', perSide: false, gate: { id: 'wrist', at: 3 } }],
        routines: [{ id: 'morning', name: 'Morning mobility', days: ['mon', 'wed', 'fri'], items: [{ name: 'Cat-cow', target: '10' }] }], sessionKinds: ['Strength', 'Cardio'],
        sessionTypes: [{ id: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, plan: [{ label: 'A', items: [{ exerciseId: 'push-up', sets: 4, reps: '8-12', rir: '1', rest: '60 s' }] }] }],
        calendar: [{ days: ['mon'], start: '07:15', end: '08:00', kind: 'session', typeId: 'upper' }, { days: ['mon', 'tue'], start: '23:00', end: '07:00', kind: 'sleep', title: 'Sleep' }],
        gates: [{ id: 'wrist', name: 'Wrist', stages: ['Phase 1', 'Phase 2', 'Phase 3'], current: 1 }], wave: { start: '2026-09-21', pattern: ['ramp', 'ramp', 'full', 'deload'] }, rank: { enabled: false } } },
    { key: 'foods', fields: ['name', 'category', 'serving', 'kcal', 'p', 'c', 'f', 'note'], sample: [{ name: 'Chicken breast, cooked', category: 'Proteins', serving: '100 g', kcal: 165, p: 31, c: 0, f: 3.6 }] },
    { key: 'templates', fields: ['name', 'slot', 'kcal', 'p', 'c', 'f'], sample: [{ name: 'Oats and whey', slot: 'breakfast', kcal: 420, p: 34, c: 55, f: 6 }] },
    { key: 'days', fields: ['date', 'habits', 'checks', 'meals', 'sessions', 'weight', 'measures', 'note'],
      sample: [{ date: '2026-09-01', habits: { water: 6, steps: true }, checks: { morning: ['cat-cow'] }, meals: [{ slot: 'breakfast', name: 'Oats and whey', kcal: 420, p: 34, c: 55, f: 6 }], sessions: [{ typeId: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, sets: [{ ex: 'Push-up', wt: null, reps: 12 }, { ex: 'One-arm row', wt: 50, reps: 10, reps2: 9 }] }], weight: 79.4, measures: { waist: 84 } }] }
  ];
  const REMOVE_SAMPLE = { foods: ['banana'], days: ['2026-09-01'], settings: { habits: ['water'], exercises: ['plank'], routineItems: { morning: ['cat-cow'] } } };

  MB.schema = { VERSION, DAYS, KINDS, WAVE, UNITS, MEASURES, CAT_KEYS, BELT_COLORS, DEFAULT_SETTINGS, normalizeSettings, normalizeRank, emptyDay, normalizeDay, normalizeFood, normalizeTemplate, habitDone,
    isLegacy, migrateLegacy, planImport, exportProfile, convertWeight, TARGETS, DOCS, REMOVE_SAMPLE, starterProfile, FOODS, isObj, blockTitle, hm, duration, blocksFor, plannedFor, waveWeek, gateOpen, resolveExercise, demoImage, demoVideo };
})();
