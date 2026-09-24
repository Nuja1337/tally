/* Tally — pages, routing, import/export and boot. Depends on MB.ui, MB.i18n, MB.schema, MB.store */
(() => {
  'use strict';
  const U = MB.ui, SC = MB.schema, store = MB.store, I = MB.i18n, t = I.t;
  const { $, h, svg, uid, clone, fmt, fmt1, num, byName, today, addDays, dow, DAYS, dayName, fmtLong, fmtShort, fmtDay, fmtTime, weekStart, thumb, isImageUrl,
    openSheet, closeSheet, toast, confirmSheet, section, statCard, numField, textField, selectField, segmented, helpTip, listEditor, ring, bars, stacked, trend, heat, sortable, dragHandle, moveItem } = U;

  const PTABS = ['week', 'month', 'year', 'data'], PTAB_KEY = 'tally:progress';
  const S = { route: 'today', date: today(), pDate: today(), pTab: (() => { try { const v = localStorage.getItem(PTAB_KEY); return PTABS.includes(v) ? v : 'week'; } catch (e) { return 'week'; } })(), settings: SC.normalizeSettings(null),
    history: [], events: [], day: SC.emptyDay(today()), foods: [], templates: [], foodTab: 'All', foodQ: '', foodSort: { key: 'name', dir: 1 }, libTab: 'workouts', exQ: '', planDay: dow(today()),
    refs: {}, openedOn: today(), pendingImport: null, dataSort: { key: 'date', dir: 1 } };
  const unit = () => S.settings.units.weight;
  const kindName = id => { const k = S.settings.sessionKinds.find(x => x.id === id); return k ? k.name : (id || t('c.other')); };
  const allDays = () => store.list('days').map(d => SC.normalizeDay(d, d.date || d.id)).sort((a, b) => a.date < b.date ? -1 : 1);
  function current() { return { settings: S.settings, hasSettings: !!store.get('settings/main'), foods: S.foods, templates: S.templates, days: allDays(), events: S.events, history: S.history, profileName: store.currentProfile().name }; }
  const exById = id => id ? S.settings.exercises.find(e => e.id === id) : null;
  const exFor = item => exById(item.exerciseId) || SC.resolveExercise(item.name, S.settings.exercises);
  const gateLabel = gate => { const g = gate && S.settings.gates.find(x => x.id === gate.id); return g ? `${g.name} · ${g.stages[gate.at - 1] || gate.at}` : ''; };
  const fmtDur = m => m == null ? '' : m < 60 ? `${m} ${t('c.min')}` : (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} ${t('c.min')}` : `${m / 60} h`);
  const KIND_CLASS = { session: 'k-session', routine: 'k-routine', meal: 'k-meal', sleep: 'k-sleep', work: 'k-work', rest: 'k-rest', other: 'k-other' };
  /* per-device preferences in localStorage */
  const pref = (k, d) => { try { const v = localStorage.getItem('tally:' + k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('tally:' + k, v); } catch (e) {} };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem('tally:' + k)) || d; } catch (e) { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem('tally:' + k, JSON.stringify(v)); } catch (e) {} };

  /* ---------- theme ---------- */
  const THEME_KEY = 'tally:theme';
  const themePref = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } };
  const effectiveTheme = () => { const p = themePref(); if (p !== 'auto') return p; return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; };
  function applyTheme(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
    if (pref === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = pref;
    document.querySelectorAll('.theme-btn').forEach(b => { b.innerHTML = effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon; });
    const meta = $('meta[name=theme-color]'); if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? '#15161A' : '#F6F5F1');
  }
  const toggleTheme = () => applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  /* status colors: standard, or blue to orange for color-blind eyes */
  function applyPalette(p) { setPref('palette', p); if (p === 'cb') document.documentElement.dataset.palette = 'cb'; else delete document.documentElement.dataset.palette; }

  /* ---------- status and state ---------- */
  let statusTimer = null;
  function setStatus(text, cls) { document.querySelectorAll('.status').forEach(el => { el.textContent = text; el.dataset.state = cls || ''; }); }
  const storageLabel = () => store.kind() === 'memory' ? t('c.notSaved') : t('c.onDevice');
  function flashSaved() { setStatus(t('c.saved'), 'ok'); clearTimeout(statusTimer); statusTimer = setTimeout(() => setStatus(storageLabel(), ''), 1400); }
  /* stored v4 settings are upgraded on read; the first save writes them as v5 */
  const readSettings = () => { const raw = store.get('settings/main'); return raw && SC.isV4Settings(raw) ? SC.upgradeSettings(raw, allDays()) : SC.normalizeSettings(raw); };
  /* The profile's day start moves "today" (ui.today): until then, the day before is still going. True when the shown day changed. */
  function applyDayStart() {
    const was = today(); U.setDayStart(SC.hm(S.settings.dayStart) || 0);
    const now = today(); if (now === was) return false;
    if (S.openedOn === was) S.openedOn = now; if (S.pDate === was) S.pDate = now;
    if (S.date === was) { S.date = now; return true; }
    return false;
  }
  function hydrate() {
    const raw = store.get('settings/main');
    S.settings = readSettings(); applyDayStart();
    S.foods = store.list('foods').sort(byName);
    S.templates = store.list('templates');
    loadHistory(); loadEvents();
    loadDay(S.date);
    moveRank(raw);
  }
  function loadDay(date) { const d = store.get('days/' + date); S.day = d ? SC.normalizeDay(d, date) : SC.emptyDay(date); }
  function saveDay() { S.day.date = S.date; S.day.updatedAt = store.stamp(); if (S.date < startDate()) startMemo = null; store.setDoc('days/' + S.date, S.day); flashSaved(); }

  /* Events: one-off things on a date (events/<id>). A day's events can add a tag to it and take it off the plan. */
  let evByDate = null;
  function loadEvents() { S.events = store.list('events').map(SC.normalizeEvent).filter(Boolean).sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.time || '') < (b.time || '') ? -1 : 1); evByDate = null; }
  function eventsOn(date) {
    if (!evByDate) { evByDate = new Map(); for (const e of S.events) for (let d = e.date, n = 0; d <= (e.end || e.date) && n < 400; d = addDays(d, 1), n++) { if (!evByDate.has(d)) evByDate.set(d, []); evByDate.get(d).push(e); } }
    return evByDate.get(date) || [];
  }
  const offPlanOn = date => eventsOn(date).some(e => e.offPlan);
  /* planned sessions on a date, unless an event takes that day off the plan */
  const plannedOn = (date, st) => offPlanOn(date) ? [] : SC.plannedFor(st || setupOn(date), dow(date));
  /* a day's tags: its own and those of the events on it */
  const tagIdsOn = (date, day) => { const ids = new Set(day ? day.tags : []); for (const e of eventsOn(date)) if (e.tag) ids.add(e.tag); return [...ids]; };
  /* Stored settings from before events had a rank. It already reads as a progression; its promotions are written as
     events once, together with the settings without the rank, so this runs one time. */
  function moveRank(raw) {
    if (!raw || !SC.isObj(raw.rank) || !(raw.rank.enabled || (Array.isArray(raw.rank.history) && raw.rank.history.length))) return;
    const ups = SC.rankEvents(raw.rank).filter(e => !store.get('events/' + e.id)).map(({ id, ...e }) => ['events/' + id, { ...e, updatedAt: store.stamp() }]);
    store.bulk({ upserts: [...ups, ['settings/main', { ...S.settings, updatedAt: store.stamp() }]] });
    loadEvents();
  }

  /* Setup history: a past day is judged by the setup it had (targets, trackers, routines, planned training). history/<date>
     holds that setup from its date on; the newest entry always matches the current settings, so today uses them directly. */
  let onCache = new Map(), onFor = null, startMemo = null;
  function loadHistory() { S.history = store.list('history').map(x => SC.normalizeHistory(x, x.date || x.id)).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1); onCache = new Map(); startMemo = null; }
  /* The profile's first day: its first setup or its first logged day, whichever is earlier. */
  const startDate = () => { if (startMemo == null) startMemo = [S.history.length ? S.history[0].date : '', ...store.ids('days')].filter(Boolean).sort()[0] || ''; return startMemo; };
  function setupOn(date) {
    const hs = S.history; if (!hs.length || date >= hs[hs.length - 1].date) return S.settings;
    if (onFor !== S.settings) { onCache = new Map(); onFor = S.settings; }
    /* before the first day nothing was expected (no trackers, checklists or planned training), so a new profile does not
       open on a week of misses; the targets are the first setup's, for a day logged after the fact */
    if (date < startDate()) { let m = onCache.get('before'); if (!m) { m = SC.settingsOn(S.settings, { ...hs[0], trackers: [], routines: [], calendar: [] }); onCache.set('before', m); } return m; }
    let snap = hs[0]; for (const x of hs) { if (x.date <= date) snap = x; else break; }
    let m = onCache.get(snap); if (!m) { m = SC.settingsOn(S.settings, snap); onCache.set(snap, m); }
    return m;
  }
  const SNAP_KEYS = ['targets', 'nutrients', 'trackers', 'routines', 'calendar', 'types'];
  const snapKey = x => JSON.stringify(SNAP_KEYS.map(k => x[k]));
  /* entries a settings change needs: today's setup, and with no history yet, the old setup for the days before
     (not for an import: its days go with the settings it brings) */
  function historyWrites(prev, next, imported) {
    const d = today(), snap = SC.snapshot(next), key = snapKey(snap), out = [];
    if (!S.history.length) {
      const before = SC.snapshot(prev); if (snapKey(before) === key) return out;
      const first = allDays().map(x => x.date).find(x => x < d);
      if (first && !imported) out.push(['history/' + first, { date: first, ...before }]);
    } else { const inEffect = [...S.history].reverse().find(x => x.date <= d); if (inEffect && snapKey(inEffect) === key) return out; }
    out.push(['history/' + d, { date: d, ...snap }]);
    return out;
  }
  function saveSettingsNow(next) {
    const prev = S.settings;
    S.settings = SC.normalizeSettings(next); S.settings.updatedAt = store.stamp();
    if (applyDayStart()) loadDay(S.date);
    const ups = [['settings/main', S.settings], ...historyWrites(prev, S.settings)];
    store.bulk({ upserts: ups });
    if (ups.length > 1) loadHistory();
    flashSaved();
  }
  function setDate(d) { S.date = d; loadDay(d); render(); window.scrollTo(0, 0); }
  function totals(day) {
    const x = { kcal: 0, p: 0, c: 0, f: 0, burn: 0, n: {} };
    for (const m of day.meals) { x.kcal += num(m.kcal); x.p += num(m.p); x.c += num(m.c); x.f += num(m.f); for (const k of Object.keys(m.n || {})) x.n[k] = (x.n[k] || 0) + num(m.n[k]); }
    for (const s of day.sessions) if (s.done !== false) x.burn += num(s.kcal);
    return x;
  }
  const routinesFor = (date, st) => (st || S.settings).routines.filter(r => !r.days.length || r.days.includes(dow(date)));
  const routineDone = (r, day) => r.items.length > 0 && r.items.every(i => (day.checks[r.id] || {})[i.id]);
  const waveLabel = w => w ? `${t('pl.week', { n: w.week, of: w.of })} · ${t('pl.' + w.phase)}` : '';
  /* trackers: the ones in use, their section, what counts on a date */
  const liveTrackers = () => S.settings.trackers.filter(x => !x.archived);
  const trackersOf = gid => liveTrackers().filter(x => x.group === gid);
  /* expected trackers on a date, judged by that date's setup */
  const expectedOnDate = (date, gid) => setupOn(date).trackers.filter(x => SC.expectedOn(x, date) && (!gid || x.group === gid));
  const doneOf = (list, day) => list.filter(x => SC.trackerDone(x, SC.trackerValue(x, day))).length;
  const valueText = (x, v) => {
    if (v == null || v === '') return '';
    if (x.type === 'check') return v ? '✓' : '';
    if (x.type === 'duration') return fmtDur(Math.round(num(v)));
    if (x.type === 'time') return fmtTime(String(v));
    if (x.type === 'rating') return `${v}/5`;
    if (x.type === 'weight') return `${fmt1(v)} ${unit()}`;
    if (x.type === 'text') return String(v);
    return fmt1(v) + (x.unit ? ' ' + x.unit : '');
  };
  const AIM_SIGN = { min: '≥', max: '≤', near: '≈' };
  function goalText(x) {
    if (x.target == null) return '';
    if (x.type === 'time') return t('tk.time.' + x.aim, { t: fmtTime(x.target) });
    const v = x.type === 'duration' ? fmtDur(x.target) : x.type === 'rating' ? `${x.target}/5` : fmt(x.target) + (x.unit ? ' ' + x.unit : '');
    return `${AIM_SIGN[x.aim] || ''} ${v}`.trim();
  }
  const undoToast = (msg, fn) => toast(msg, { action: t('c.undo'), onAction: fn, ms: 10000 });
  /* items added in a sheet get readable ids from their names (fiber, sick), unique in the list */
  function slugIds(list, before) {
    const taken = new Set(list.filter(x => before.some(b => b.id === x.id)).map(x => x.id));
    return list.map(x => { if (before.some(b => b.id === x.id)) return x; let id = U.slug(x.name), n = 2; while (taken.has(id)) id = U.slug(x.name) + '-' + n++; taken.add(id); return { ...x, id }; });
  }

  /* ---------- Today ---------- */
  /* A day's page: totals up top, then the day in time order, then everything you log. Each card edits its own setup in
     a sheet, so nothing here sends you to Settings. Counts and checks update in place. Cards fold; finished ones fold
     by themselves (a setting); what folds is remembered per device. */
  const finalDay = () => S.date < today();
  const wideLayout = () => window.innerWidth >= 900;
  const folds = readJSON('fold', {}), opened = readJSON('opened', {});
  const autoFold = () => pref('autofold', '1') === '1';
  /* A card. opts: summary() one line shown when folded; finished() lets it fold itself once everything is done; hc a color */
  function card(key, title, right, body, opts) {
    opts = opts || {};
    const fk = (opts.page || S.route) + ':' + key, icon = opts.icon || key;
    const sum = h('small', { class: 'fold-sum' }), rightEl = right ? h('div', { class: 'card-right' }, right) : null;
    const btn = h('button', { class: 'fold-btn', type: 'button', 'aria-expanded': 'true' }, h('span', { class: 'hico hico-' + icon, style: opts.hc ? { '--hc': opts.hc } : null, html: ICONS['s_' + icon] || ICONS.s_habits }), title);
    const bodyEl = h('div', { class: 'card-body' }, body);
    const el = h('section', { class: 'card foldable', id: 'c-' + key }, h('div', { class: 'card-head' }, h('h2', null, btn), sum, rightEl), bodyEl);
    const fin = () => !!(opts.finished && opts.finished());
    const set = f => { el.classList.toggle('folded', f); btn.setAttribute('aria-expanded', String(!f)); el.paint(); };
    btn.addEventListener('click', () => {
      const f = !el.classList.contains('folded');
      if (f) { folds[fk] = true; delete opened[fk]; } else { delete folds[fk]; if (fin()) opened[fk] = S.date; }
      writeJSON('fold', folds); writeJSON('opened', opened); set(f);
    });
    let wasFin = fin(), timer = null;
    el.paint = () => {
      sum.textContent = el.classList.contains('folded') && opts.summary ? opts.summary() : '';
      const now = fin();
      if (now && !wasFin && autoFold() && opened[fk] !== S.date && !el.classList.contains('folded')) {
        clearTimeout(timer); timer = setTimeout(() => { if (fin() && el.isConnected && !el.classList.contains('folded')) set(true); }, 900);
      }
      wasFin = now;
    };
    const folded = folds[fk] === true || (autoFold() && wasFin && opened[fk] !== S.date);
    el.classList.toggle('folded', folded); btn.setAttribute('aria-expanded', String(!folded));
    (S.refs.cards = S.refs.cards || []).push(el);
    el.paint();
    return el;
  }
  const editBtn = (fn, label) => h('button', { class: 'btn ghost small', onclick: fn }, label || t('c.edit'));
  const emptyAdd = (text, label, fn) => h('div', { class: 'empty-add' }, h('p', { class: 'empty' }, text), h('button', { class: 'btn small', onclick: fn }, label));
  const scrollToCard = key => { const el = document.getElementById('c-' + key); if (!el) return; if (el.classList.contains('folded')) el.querySelector('.fold-btn').click(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const groupColor = i => `var(--kc-${SC.KIND_COLORS[(i + 1) % SC.KIND_COLORS.length]})`;
  function viewToday() {
    const st = S.settings, wrap = h('div', { class: 'page today' }), isToday = S.date === today(), wave = SC.waveWeek(st.wave, S.date);
    const sub = [isToday ? fmtLong(S.date) : null, wave ? waveLabel(wave) : null].filter(Boolean).join(' · ');
    wrap.append(h('div', { class: 'dayhead' },
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.prev'), onclick: () => setDate(addDays(S.date, -1)) }, '‹'),
      h('div', { class: 'daytitle' }, h('h1', null, isToday ? t('c.today') : fmtLong(S.date)),
        h('div', { class: 'sub' }, isToday ? sub : [h('button', { class: 'linkbtn', onclick: () => setDate(today()) }, t('t.backToToday')), wave ? ' · ' + waveLabel(wave) : null])),
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.next'), onclick: () => setDate(addDays(S.date, 1)) }, '›')));
    S.refs = { cards: [] };
    const empty = !liveTrackers().length && !st.routines.length && !st.sessionTypes.length && !st.mealSlots.length;
    if (empty) wrap.append(h('div', { class: 'notice' }, h('span', null, t('t.notSetUp')), h('a', { class: 'btn primary small', href: '#start' }, t('nav.start'))));
    const evs = eventStrip(); if (evs) wrap.append(evs);
    wrap.append(summaryCard());
    if (wave && wave.phase === 'deload') wrap.append(h('div', { class: 'notice soft' }, h('span', null, t('pl.deloadHint'))));
    S.refs.alerts = h('div'); wrap.append(S.refs.alerts);
    const nudge = backupNudge(); if (nudge) wrap.append(nudge);
    const groups = st.groups.map((g, i) => groupCard(g, i));
    const c = { plan: planCard(), meals: mealsCard(), checklists: checklistsCard(), training: trainingCard(), day: dayCard() };
    S.refs.wide = wideLayout();
    if (S.refs.wide) wrap.append(h('div', { class: 'cols' }, h('div', null, c.plan, c.checklists, c.training), h('div', null, c.meals, ...groups, c.day)));
    else wrap.append(...[c.plan, c.meals, ...groups, c.checklists, c.training, c.day].filter(Boolean));
    updateCounts();
    wrap.append(h('button', { class: 'fab', type: 'button', 'aria-label': t('q.title'), title: t('q.title'), onclick: quickSheet }, '+'));
    return wrap;
  }
  /* quick add: a meal, a workout, an event, a note, the weight, without scrolling to their cards */
  function quickSheet() {
    const st = S.settings, w = { v: S.day.weight };
    const row = (label, onclick) => h('button', { class: 'row pick', type: 'button', onclick }, h('span', { class: 'row-name' }, label), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    openSheet(t('q.title'), h('div', null,
      st.mealSlots.length ? h('div', null, h('div', { class: 'subhead' }, t('t.meals')), h('div', { class: 'chips small-gap' }, st.mealSlots.map(ms => h('button', { class: 'chip small', type: 'button', onclick: () => addMealSheet(ms) }, ms.name)))) : null,
      h('div', { class: 'list' }, row(t('t.addSession'), addSessionSheet), row(t('ev.add'), () => eventSheet(null)),
        row(t('q.note'), () => { closeSheet(); scrollToCard('day'); setTimeout(() => { const n = document.querySelector('#c-day textarea'); if (n) n.focus(); }, 350); })),
      st.trackers.some(x => x.type === 'weight' && !x.archived) ? h('div', { class: 'quickw' }, numField(`${t('m.weight')} (${unit()})`, w, 'v'),
        h('button', { class: 'btn primary', onclick: () => { S.day.weight = w.v == null ? null : num(w.v); saveDay(); closeSheet(); render(); toast(t('c.saved')); } }, t('c.save'))) : null));
  }

  /* totals: rings for calories and protein (tap to edit targets), other macros and nutrients, and how much of the day is done */
  function summaryCard() {
    S.refs.rings = h('div', { class: 'rings' }); S.refs.tallies = h('div', { class: 'tallies' });
    drawRings();
    return h('section', { class: 'card summary' }, S.refs.rings, S.refs.tallies);
  }
  const gradeColor = s => s && s !== 'progress' && s !== 'none' ? `var(--g-${s})` : null;
  function statusNote(value, target, status, u) {
    if (!status) return '';
    const gap = Math.abs(target - value), n = fmt(gap) + (u ? ' ' + u : '');
    if (status === 'met') return '✓ ' + t('t.onTarget');
    if (status === 'progress') return t('t.toGo', { n });
    return value > target ? t('t.overBy', { n }) : t('t.short', { n });
  }
  function drawRings() {
    const st = setupOn(S.date), x = totals(S.day), el = S.refs.rings; if (!el) return;
    const fin = finalDay();
    const one = (key, value, label, u, color) => {
      const target = st.targets[key], status = SC.targetStatus(value, target, st.targets.aim[key], fin);
      return h('button', { class: 'ringbox', type: 'button', 'aria-label': t('t.editTargets'), onclick: targetsSheet },
        h('span', { class: 'ringsvg', html: ring(value, target, { label, unit: u, color: gradeColor(status) || color }) }),
        h('span', { class: 'ringlab' }, label), h('span', { class: 'ringnote st-' + (status || 'none') }, target > 0 ? statusNote(value, target, status, u) : t('t.setTarget')));
    };
    const macro = (label, value, target, aim, u) => {
      const status = SC.targetStatus(value, target, aim, fin);
      return h('div', { class: 'macro' }, h('span', null, label), h('b', { class: 'st-' + (status || 'none') }, fmt1(value) + (target > 0 ? ` / ${fmt(target)}` : '') + (u ? ' ' + u : '')));
    };
    el.replaceChildren(one('kcal', x.kcal, t('c.kcal'), '', 'var(--accent)'), one('protein', x.p, t('c.protein'), 'g', 'var(--blue)'),
      h('div', { class: 'ringmeta' }, macro(t('c.carbs'), x.c, st.targets.carbs, st.targets.aim.carbs, 'g'), macro(t('c.fat'), x.f, st.targets.fat, st.targets.aim.fat, 'g'),
        st.nutrients.map(n => macro(n.name, x.n[n.id] || 0, n.target, n.aim, n.unit)),
        x.burn ? h('div', { class: 'macro' }, h('span', null, t('t.burnedLabel')), h('b', null, fmt(x.burn) + ' kcal')) : null));
    drawTallies();
  }
  /* each tracker section, checklists and planned training done today; graded once the day is over */
  function drawTallies() {
    const el = S.refs.tallies; if (!el) return;
    const st = setupOn(S.date), d = S.day, fin = finalDay();
    const lists = routinesFor(S.date, st).filter(r => !r.alertAt && r.items.length), planned = plannedOn(S.date, st);
    const done = d.sessions.filter(s => s.done !== false);
    const items = [
      ...S.settings.groups.map(g => { const exp = expectedOnDate(S.date, g.id); return exp.length ? ['g_' + g.id, g.name, doneOf(exp, d), exp.length] : null; }),
      lists.length ? ['checklists', t('t.routines'), lists.filter(r => routineDone(r, d)).length, lists.length] : null,
      planned.length ? ['training', t('t.training'), planned.filter(p => done.some(s => s.typeId === p.type.id)).length, planned.length] : (done.length ? ['training', t('t.training'), done.length, 0] : null)
    ].filter(Boolean);
    el.classList.toggle('hidden', !items.length);
    el.replaceChildren(...items.map(([key, label, a, b]) => {
      const status = !b ? 'met' : a >= b ? 'met' : fin ? SC.gradeOf(a / b) : 'progress';
      return h('button', { class: 'tally st-' + status, type: 'button', onclick: () => scrollToCard(key) }, h('b', null, b ? `${a}/${b}` : String(a)), h('span', null, label));
    }));
  }
  function drawAlerts() {
    const el = S.refs.alerts; if (!el) return;
    el.replaceChildren(...routinesFor(S.date).filter(r => r.alertAt).map(r => { const n = r.items.filter(i => (S.day.checks[r.id] || {})[i.id]).length; return n >= r.alertAt ? h('div', { class: 'notice bad' }, h('span', null, h('b', null, r.name + ': '), r.alertText || t('t.alertDefault', { n }))) : null; }).filter(Boolean));
  }

  /* the day in time order: what is on now, what is next, what got done or was missed. A tap acts on the block. */
  const BLOCK_COLOR = { routine: 'var(--kc-teal)', meal: 'var(--kc-gold)', sleep: 'var(--kc-slate)', work: 'var(--track2)', rest: 'var(--kc-blue)', other: 'var(--track2)' };
  const kindColor = id => { const c = SC.kindColors(S.settings.sessionKinds)[id]; return c ? `var(--kc-${c})` : 'var(--accent)'; };
  const blockColor = b => b.kind === 'session' ? kindColor((S.settings.sessionTypes.find(x => x.id === b.typeId) || {}).kind) : BLOCK_COLOR[b.kind];
  /* minutes into the day; before the day start it is still the day before, so past midnight counts on (24:30 is 1470) */
  const nowMin = () => { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); return m < U.dayStartMin() ? m + 1440 : m; };
  function blockDone(b, d) {
    if (b.kind === 'session') { const done = d.sessions.some(s => s.typeId === b.typeId && s.done !== false); return done || !offPlanOn(d.date) ? done : null; }
    if (b.kind === 'routine') { const r = S.settings.routines.find(x => x.id === b.routineId); return r && r.items.length && !r.alertAt ? routineDone(r, d) : null; }
    if (b.kind === 'meal') return d.meals.some(m => m.slot === b.slotId);
    return null;
  }
  function planCard() {
    if (!SC.blocksFor(S.settings, dow(S.date)).length) return null;
    S.refs.timeline = h('div', { class: 'timeline' });
    return card('plan', t('t.plan'), h('a', { class: 'btn ghost small', href: '#plan' }, t('nav.plan')), S.refs.timeline, { summary: planSummary });
  }
  function planSummary() {
    const blocks = SC.blocksFor(S.settings, dow(S.date)), now = nowMin();
    const next = S.date === today() ? blocks.find(b => SC.hm(b.start) != null && SC.hm(b.start) > now) : null;
    if (next) return t('t.nextBlock', { name: SC.blockTitle(next, S.settings) || t('pl.' + next.kind), t: fmtTime(next.start) });
    const tracked = blocks.map(b => blockDone(b, S.day)).filter(x => x != null);
    return tracked.length ? t('t.doneOf', { n: tracked.filter(Boolean).length, of: tracked.length }) : `${blocks.length}`;
  }
  function drawTimeline() {
    const el = S.refs.timeline; if (!el) return;
    const st = S.settings, d = S.day, blocks = SC.blocksFor(st, dow(S.date));
    const isToday = S.date === today(), past = S.date < today(), now = nowMin();
    const next = isToday ? blocks.findIndex(b => SC.hm(b.start) != null && SC.hm(b.start) > now) : -1;
    /* a long day, today: from the last block that ended to the next few (untimed ones always); the whole day is a tap away */
    const long = isToday && blocks.length > 7, whole = !long || pref('planAll', '0') === '1';
    let from = 0, to = blocks.length;
    if (!whole) {
      let i = blocks.findIndex(b => { const a = SC.hm(b.start); return a != null && a + (SC.duration(b) || 0) > now; }); if (i < 0) i = blocks.length;
      from = Math.max(0, i - 1); to = Math.min(blocks.length, from + 5); from = Math.max(0, Math.min(from, to - 5));
    }
    const shown = blocks.map((b, i) => [b, i]).filter(([b, i]) => whole || !b.start || (i >= from && i < to));
    el.replaceChildren(...shown.map(([b, i]) => {
      const a = SC.hm(b.start), end = a == null ? null : a + (SC.duration(b) || 0);
      const current = isToday && a != null && a <= now && now < end, ended = past || (isToday && a != null && end <= now);
      const done = blockDone(b, d), missed = done === false && ended, late = missed && !past;
      const title = SC.blockTitle(b, st) || t('pl.' + b.kind), dur = SC.duration(b);
      /* a workout that ended today without a log: a nudge to log it, not a mark against it (the day is not over) */
      const logIt = late && b.kind === 'session';
      const tag = current ? h('span', { class: 'tl-tag now' }, t('t.now')) : i === next ? h('span', { class: 'tl-tag' }, t('t.inTime', { t: fmtDur(a - now) })) : logIt ? h('span', { class: 'tl-tag log' }, t('t.log')) : null;
      return h('button', { class: ['tl-row', current ? 'now' : '', ended ? 'past' : '', done ? 'done' : '', missed ? (late ? 'late' : 'miss') : ''].filter(Boolean).join(' '), style: { '--kc': blockColor(b) }, onclick: () => blockTap(b) },
        h('span', { class: 'tl-time' }, b.start ? fmtTime(b.start) : ''), h('span', { class: 'tl-dot' }),
        h('span', { class: 'tl-title' }, title, dur ? h('small', null, ' ' + fmtDur(dur)) : null), tag,
        done != null ? h('span', { class: 'tl-check', 'aria-label': done ? t('c.done') : missed ? (late ? t('t.notLogged') : t('t.missed')) : '' }, done ? '✓' : missed && !late ? '✕' : '') : null);
    }), ...(long ? [h('button', { class: 'linkbtn tl-more', type: 'button', onclick: () => { setPref('planAll', whole ? '0' : '1'); drawTimeline(); } }, whole ? t('t.showLess') : t('t.wholeDay', { n: blocks.length }))] : []));
  }
  function blockTap(b) {
    const st = S.settings;
    if (b.kind === 'meal') { const w = st.mealSlots.find(x => x.id === b.slotId); if (w) { addMealSheet(w); return; } }
    if (b.kind === 'routine' && routinesFor(S.date).some(r => r.id === b.routineId)) { openChecklist(b.routineId); return; }
    if (b.kind === 'session') {
      const logged = S.day.sessions.find(s => s.typeId === b.typeId && s.done !== false);
      if (logged) { sessionSheet(logged, false); return; }
      const p = SC.plannedFor(st, dow(S.date)).find(x => x.block.id === b.id);
      if (p) { plannedSheet(p); return; }
    }
    blockSheet(b);
  }
  /* a planned session: log it with sets, mark it done, or look at the workout */
  function plannedSheet(p) {
    const b = p.block;
    openSheet(p.type.name, h('div', null,
      h('p', { class: 'muted small' }, [b.start ? `${fmtTime(b.start)}${b.end ? '–' + fmtTime(b.end) : ''}` : null, kindName(p.type.kind), t('t.planned', { min: p.minutes, kcal: fmt(p.kcal) })].filter(Boolean).join(' · ')),
      b.note ? h('p', null, b.note) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => sessionSheet(newSession(p.type, p.minutes, p.kcal), true) }, p.type.plan.length ? t('t.logSets') : t('t.logDetails')),
        h('button', { class: 'btn', onclick: () => { closeSheet(); markDone(p.type, p.minutes, p.kcal); } }, t('t.markDone')),
        p.type.plan.length ? h('button', { class: 'btn ghost', onclick: () => workoutSheet(p.type) }, t('pl.viewWorkout')) : null)));
  }
  function updateCounts() {
    const st = S.settings, d = S.day; if (!d) return;
    for (const r of st.routines) { const el = S.refs['r_' + r.id]; if (el && el.paint) el.paint(); }
    for (const g of st.groups) { const el = S.refs['gc_' + g.id]; if (el) { const exp = expectedOnDate(S.date, g.id), n = doneOf(exp, d); el.textContent = exp.length ? `${n}/${exp.length}` : ''; el.className = 'count' + (exp.length && n >= exp.length ? ' st-met' : ''); } }
    drawAlerts(); drawTimeline(); drawTallies();
    (S.refs.cards || []).forEach(c => c.paint());
  }

  /* checklists (routines): one row each, opened with a tap; the open ones are remembered on this device */
  const openState = readJSON('open', {});
  const isOpen = r => r.id in openState ? !!openState[r.id] : (r.items.length <= 6 && !routineDone(r, S.day));
  function setOpen(id, open) { openState[id] = open; writeJSON('open', openState); }
  function checklistsCard() {
    const rs = routinesFor(S.date); if (!rs.length) return null;
    const tracked = () => routinesFor(S.date, setupOn(S.date)).filter(r => !r.alertAt && r.items.length);
    return card('checklists', t('t.routines'), h('a', { class: 'btn ghost small', href: '#routines' }, t('c.edit')), h('div', { class: 'cls' }, rs.map(checklistRow)),
      { summary: () => { const tr = tracked(); return tr.length ? t('t.doneOf', { n: tr.filter(r => routineDone(r, S.day)).length, of: tr.length }) : ''; },
        finished: () => { const tr = tracked(); return tr.length > 0 && tr.every(r => routineDone(r, S.day)); } });
  }
  function checklistRow(r) {
    const d = S.day, count = h('span', { class: 'cl-count' }), fill = h('i'), next = h('small', { class: 'cl-next' });
    const body = h('div', { class: 'cl-body' + (isOpen(r) ? '' : ' hidden') }, r.items.length ? checklist(r, r.items) : h('p', { class: 'empty' }, t('t.noItems')));
    const head = h('button', { class: 'cl-head', type: 'button', 'aria-expanded': String(isOpen(r)), onclick: () => toggle(body.classList.contains('hidden')) },
      h('span', { class: 'cl-chev', 'aria-hidden': 'true' }, '›'), h('span', { class: 'cl-name' }, h('b', null, r.name), next), count, h('span', { class: 'cl-bar' }, fill));
    const row = h('div', { class: 'cl' + (r.alertAt ? ' alert' : ''), id: 'cl-' + r.id }, head, body);
    const toggle = open => { body.classList.toggle('hidden', !open); head.setAttribute('aria-expanded', String(open)); row.classList.toggle('open', open); setOpen(r.id, open); row.paint(); };
    row.open = () => toggle(true);
    row.paint = () => {
      const map = d.checks[r.id] || {}, n = r.items.filter(i => map[i.id]).length, all = r.items.length;
      const status = r.alertAt ? (n >= r.alertAt ? 'alert' : 'none') : !all ? 'none' : n >= all ? 'met' : finalDay() ? SC.gradeOf(n / all) : 'progress';
      count.textContent = all ? `${n}/${all}` : ''; row.dataset.status = status; row.className = 'cl' + (r.alertAt ? ' alert' : '') + (row.classList.contains('open') ? ' open' : '') + ' st-' + status;
      fill.style.width = all ? Math.round(n / all * 100) + '%' : '0';
      const first = r.items.find(i => !map[i.id]);
      next.textContent = !r.alertAt && first && body.classList.contains('hidden') && n ? t('t.nextItem', { name: first.name }) : '';
    };
    row.classList.toggle('open', isOpen(r));
    S.refs['r_' + r.id] = row;
    return row;
  }
  function openChecklist(id) {
    const row = S.refs['r_' + id]; if (!row) return;
    const c = document.getElementById('c-checklists'); if (c && c.classList.contains('folded')) c.querySelector('.fold-btn').click();
    row.open(); row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function checklist(routine, items) {
    const d = S.day; d.checks[routine.id] = d.checks[routine.id] || {};
    const map = d.checks[routine.id];
    return h('div', { class: 'list' }, items.map(it => {
      const cb = h('input', { type: 'checkbox', checked: !!map[it.id] });
      const ex = exFor(it);
      /* a tap anywhere on the row checks it; the exercise's how-to is behind its own button */
      const info = ex ? h('button', { class: 'infobtn', type: 'button', 'aria-label': t('t.exInfo'), title: t('t.exInfo'), onclick: e => { e.preventDefault(); e.stopPropagation(); exerciseCard(ex); } }, 'i') : null;
      const row = h('label', { class: 'row' + (map[it.id] ? ' done' : '') }, cb, ex ? (thumb(ex.image, 'thumb sm') || null) : null, h('span', { class: 'row-name' }, it.name), it.target ? h('span', { class: 'row-target' }, it.target) : null, info);
      cb.addEventListener('change', () => { if (cb.checked) map[it.id] = true; else delete map[it.id]; row.classList.toggle('done', cb.checked); saveDay(); updateCounts(); });
      return row;
    }));
  }

  /* ---------- tracker sections ---------- */
  /* One card per section. Checks and counts are tiles you tap; numbers, times, durations and notes have their field in the
     tile; ratings have five buttons. Expected trackers show the last 7 days as graded dots, the others their last value. */
  function groupCard(g, i) {
    const trs = trackersOf(g.id), count = h('small', { class: 'count' });
    S.refs['gc_' + g.id] = count;
    const body = trs.length ? h('div', { class: 'habits trackers' }, trs.map(trackerTile)) : emptyAdd(t('tk.none'), t('tk.add'), () => trackerForm(null, g.id));
    return card('g_' + g.id, g.name, h('div', { class: 'head-r' }, count, editBtn(() => groupSheet(g.id))), body, { icon: 'habits', hc: groupColor(i),
      summary: () => { const exp = expectedOnDate(S.date, g.id); return exp.length ? t('t.doneOf', { n: doneOf(exp, S.day), of: exp.length }) : trs.filter(x => SC.hasValue(x, SC.trackerValue(x, S.day))).map(x => `${x.name} ${valueText(x, SC.trackerValue(x, S.day))}`).join(' · '); },
      finished: () => { const exp = expectedOnDate(S.date, g.id); return exp.length > 0 && exp.length === trs.filter(x => exp.some(e => e.id === x.id)).length && doneOf(exp, S.day) === exp.length; } });
  }
  /* the last 7 days of one tracker, judged by each day's setup; days with nothing logged at all stay grey */
  function trackerDots(x) {
    const days7 = [...Array(7)].map((_, i) => addDays(S.date, i - 6));
    return h('div', { class: 'dots' }, days7.map(date => {
      const raw = date === S.date ? S.day : store.get('days/' + date), day = date === S.date ? S.day : raw && SC.normalizeDay(raw, date);
      const jt = setupOn(date).trackers.find(y => y.id === x.id);
      let cls = 'dot';
      if (!jt || !SC.expectedOn(jt, date)) cls += ' na';
      else if (day && (date === S.date || hasLog(day))) { const g = SC.trackerGrade(jt, SC.trackerValue(jt, day), date < today()); if (g !== 'progress') cls += ' g-' + g; }
      if (date === S.date) cls += ' cur';
      return h('span', { class: cls, title: fmtShort(date) });
    }));
  }
  function lastValue(x) {
    const days = store.list('days').filter(r => (r.date || r.id) < S.date).sort((a, b) => (a.date || a.id) < (b.date || b.id) ? 1 : -1);
    for (const r of days) { const d = SC.normalizeDay(r, r.date || r.id), v = SC.trackerValue(x, d); if (SC.hasValue(x, v)) return { v, date: d.date }; }
    return null;
  }
  function weekCount(x) {
    const a = weekStart(S.date); let n = 0;
    for (let i = 0; i < 7; i++) { const date = addDays(a, i), day = date === S.date ? S.day : store.get('days/' + date); if (day && SC.trackerDone({ ...x, freq: 'daily' }, SC.trackerValue(x, date === S.date ? day : SC.normalizeDay(day, date)))) n++; }
    return n;
  }
  function trackerTile(x) {
    const d = S.day, tap = x.type === 'check' || x.type === 'count';
    const tile = h('div', { class: 'habit tk tk-' + x.type + (x.type === 'text' ? ' wide' : ''), role: tap ? 'button' : null, tabindex: tap ? '0' : null, 'data-id': x.id });
    const get = () => SC.trackerValue(x, d);
    const set = v => {
      if (x.type === 'weight') d.weight = v == null ? null : v;
      else if (v == null || v === '' || v === false || (x.type === 'count' && !(v > 0))) delete d.values[x.id]; else d.values[x.id] = v;
      saveDay(); paint(); updateCounts();
    };
    const ringEl = h('span', { class: 'habit-ring' }), sub = h('div', { class: 'habit-sub' }), foot = h('div', { class: 'tk-foot' });
    const top = h('div', { class: 'habit-top' }, ringEl);
    if (x.type === 'count') top.append(h('button', { class: 'habit-minus', type: 'button', 'aria-label': t('t.minusOne'), onclick: e => { e.stopPropagation(); const n = num(get()); if (n > 0) set(n - 1); } }, '−'));
    let control = null;
    const numIn = (val, ph, onset, step) => h('input', { type: 'number', step: step || 'any', inputmode: 'decimal', placeholder: ph || '', value: val == null ? '' : val, 'aria-label': x.name, onchange: onset ? e => onset(e.target.value === '' ? null : num(e.target.value)) : null });
    if (x.type === 'number' || x.type === 'weight') {
      control = h('div', { class: 'tk-in' }, numIn(get(), '', v => set(v)), h('span', { class: 'muted small' }, x.type === 'weight' ? unit() : x.unit));
    } else if (x.type === 'duration') {
      const cur = get(), hh = numIn(cur == null ? '' : Math.floor(num(cur) / 60) || '', '', null, '1'), mm = numIn(cur == null ? '' : Math.round(num(cur) % 60) || '', '', null, '1');
      const upd = () => { const a = hh.value === '' ? null : num(hh.value), b = mm.value === '' ? null : num(mm.value); set(a == null && b == null ? null : Math.round((a || 0) * 60 + (b || 0))); };
      hh.onchange = upd; mm.onchange = upd; hh.setAttribute('aria-label', x.name + ' h'); mm.setAttribute('aria-label', x.name + ' ' + t('c.min'));
      control = h('div', { class: 'tk-in dur' }, hh, h('span', { class: 'muted small' }, 'h'), mm, h('span', { class: 'muted small' }, t('c.min')));
    } else if (x.type === 'time') {
      control = h('div', { class: 'tk-in' }, h('input', { type: 'time', value: get() || '', 'aria-label': x.name, onchange: e => set(e.target.value || null) }));
    } else if (x.type === 'text') {
      control = h('div', { class: 'tk-in' }, h('input', { type: 'text', value: get() || '', 'aria-label': x.name, placeholder: t('tk.textPh'), onchange: e => set(e.target.value.trim() || null) }));
    } else if (x.type === 'rating') {
      control = h('div', { class: 'tk-rate', role: 'group', 'aria-label': x.name }, [1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: 'rate-btn', 'aria-pressed': 'false', onclick: () => set(num(get()) === n ? null : n) }, String(n))));
    }
    tile.append(...[top, h('div', { class: 'habit-name' }, x.name), sub, control, foot].filter(Boolean));
    const paint = () => {
      const v = get(), jt = setupOn(S.date).trackers.find(y => y.id === x.id) || x, exp = SC.expectedOn(jt, S.date);
      const g = SC.hasValue(x, v) || exp || (x.type === 'count' && jt.target) ? SC.trackerGrade(jt, v, finalDay()) : null;
      const done = g === 'met';
      tile.dataset.grade = g && (SC.hasValue(x, v) || finalDay() || done) ? g : 'none';
      tile.classList.toggle('on', done); tile.setAttribute('aria-pressed', tap ? String(done) : null);
      if (!tap) tile.removeAttribute('aria-pressed');
      const n = num(v), target = jt.target;
      const pct = x.type === 'check' ? (done ? 1 : 0) : (x.type === 'count' || x.type === 'number' || x.type === 'duration') && target ? Math.min(1, n / target) : null;
      ringEl.innerHTML = pct == null ? '' : `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--track)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(pct * 94.2).toFixed(1)} 94.2" transform="rotate(-90 18 18)"/></svg>${done ? '<i>✓</i>' : ''}`;
      ringEl.classList.toggle('hidden', pct == null);
      sub.textContent = x.type === 'check' ? (done ? t('c.done') : t('t.tapToDo'))
        : x.type === 'count' ? (target ? `${n} / ${target}${x.unit ? ' ' + x.unit : ''}` : `${n}${x.unit ? ' ' + x.unit : ''}`)
        : goalText(jt);
      if (x.type === 'rating') control.querySelectorAll('.rate-btn').forEach((b, i) => { const on = num(v) === i + 1; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      if (x.freq === 'weekly') foot.replaceChildren(h('small', { class: 'muted' }, t('tk.thisWeek', { n: weekCount(x), of: x.perWeek })));
      else if (exp || x.freq === 'days') foot.replaceChildren(trackerDots(x));
      else if (x.type !== 'text' && !SC.hasValue(x, v)) { const last = lastValue(x); foot.replaceChildren(last ? h('small', { class: 'muted' }, t('tk.lastOn', { v: valueText(x, last.v), d: fmtShort(last.date) })) : ''); }
      else foot.replaceChildren();
    };
    const act = () => {
      if (x.type === 'check') set(get() ? null : true);
      else set(num(get()) + 1);
    };
    if (tap) { tile.addEventListener('click', act); tile.addEventListener('keydown', e => { if (e.target === tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(); } }); }
    paint();
    return tile;
  }
  /* a section: its trackers in order (drag to reorder), archived ones to restore, and the section itself */
  function groupSheet(gid) {
    const st = S.settings, g = st.groups.find(x => x.id === gid); if (!g) return;
    const name = { v: g.name }, list = h('div', { class: 'list sortlist' });
    const trs = st.trackers.filter(x => x.group === gid && !x.archived), arch = st.trackers.filter(x => x.group === gid && x.archived);
    const draw = () => list.replaceChildren(...trs.map(x => h('div', { class: 'row pick sortrow', 'data-sort': '' }, dragHandle(),
      h('button', { class: 'row-name linkish plain', onclick: () => trackerForm(x, gid) }, h('div', null, x.name), h('div', { class: 'muted small' }, trackerLine(x))), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
    sortable(list, (from, to) => { moveItem(trs, from, to); const s = latest(); const rest = s.trackers.filter(x => !trs.some(y => y.id === x.id)); const ord = trs.map(x => s.trackers.find(y => y.id === x.id)).filter(Boolean); const at = s.trackers.findIndex(x => trs.some(y => y.id === x.id)); rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...ord); s.trackers = rest; saveSettingsNow(s); draw(); });
    draw();
    openSheet(g.name, h('div', null,
      trs.length ? list : h('p', { class: 'empty' }, t('tk.none')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary small', onclick: () => trackerForm(null, gid) }, t('tk.add'))),
      arch.length ? [h('div', { class: 'subhead' }, t('tk.archived')), h('div', { class: 'list' }, arch.map(x => h('div', { class: 'row pick' }, h('span', { class: 'row-name' }, x.name, h('div', { class: 'muted small' }, trackerLine(x))),
        h('button', { class: 'btn small', onclick: () => { const s = latest(), y = s.trackers.find(z => z.id === x.id); if (y) { y.archived = false; saveAnd(s, () => groupSheet(gid), t('tk.restored', { name: x.name })); } } }, t('tk.restore')))))] : null,
      h('div', { class: 'subhead' }, t('tk.section')),
      h('div', { class: 'editor-row' }, h('input', { type: 'text', value: name.v, 'aria-label': t('tk.sectionName'), oninput: e => { name.v = e.target.value; } }),
        h('button', { class: 'btn small', onclick: () => { if (!name.v.trim()) return; const s = latest(), y = s.groups.find(z => z.id === gid); if (y) { y.name = name.v.trim(); saveAnd(s); } } }, t('c.save'))),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: sectionsSheet }, t('tk.sections')),
        h('button', { class: 'btn ghost danger small', onclick: () => { const s = latest(); s.groups = s.groups.filter(z => z.id !== gid); s.trackers = s.trackers.filter(z => z.group !== gid); saveAnd(s, null, t('t.removed', { name: g.name })); } }, t('tk.deleteSection')))));
  }
  const trackerLine = x => [t('tk.type.' + x.type), goalText(x), x.freq === 'days' ? x.days.map(d => dayName(d)).join(', ') : x.freq === 'weekly' ? t('tk.perWeekN', { n: x.perWeek }) : t('tk.freq.' + x.freq)].filter(Boolean).join(' · ');
  /* the list of sections: order (drag), add, rename from each section's sheet */
  function sectionsSheet() {
    const gs = clone(S.settings.groups);
    openSheet(t('tk.sections'), h('div', null, h('p', { class: 'muted small' }, t('tk.sectionsSub')),
      listEditor(gs, [{ key: 'name', label: t('tk.sectionName') }], () => {}, t('tk.addSection'), null, { sortable: true }),
      saveRow(() => { const s = latest(), keep = slugIds(gs.filter(g => String(g.name || '').trim()), S.settings.groups); s.groups = keep.map(g => ({ id: g.id, name: g.name.trim() })); s.trackers = s.trackers.filter(x => keep.some(g => g.id === x.group)); saveAnd(s); })));
  }
  /* one tracker: what it is, its goal, how often, where it shows */
  function trackerForm(x, gid) {
    const st = S.settings, isNew = !x;
    const d = x ? clone(x) : { id: '', name: '', type: 'check', unit: '', target: null, aim: 'min', freq: 'daily', days: [], perWeek: 3, group: gid || (st.groups[0] || {}).id || '', archived: false };
    if (d.perWeek == null) d.perWeek = 3;
    const box = h('div');
    const draw = () => {
      const targetField = () => {
        if (d.type === 'check' || d.type === 'text' || d.type === 'weight') return null;
        if (d.type === 'time') return h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('tk.target')), h('input', { type: 'time', value: d.target || '', onchange: e => { d.target = e.target.value || null; } })),
          selectField(t('s.aim'), d, 'aim', ['max', 'min', 'near'].map(a => ({ value: a, label: t('tk.timeAim.' + a) }))));
        if (d.type === 'duration') { const tv = { h: d.target ? Math.floor(d.target / 60) : null, m: d.target ? d.target % 60 : null }, upd = () => { d.target = tv.h == null && tv.m == null ? null : (num(tv.h) * 60 + num(tv.m)) || null; };
          return h('div', { class: 'grid3' }, numField(t('tk.targetH'), tv, 'h', upd, '1'), numField(t('tk.targetM'), tv, 'm', upd, '1'), selectField(t('s.aim'), d, 'aim', SC.AIMS.map(a => ({ value: a, label: t('s.aim.' + a) })))); }
        return h('div', { class: 'grid2' }, numField(d.type === 'rating' ? t('tk.targetRating') : t('tk.target'), d, 'target', null, d.type === 'number' ? 'any' : '1'), selectField(t('s.aim'), d, 'aim', SC.AIMS.map(a => ({ value: a, label: t('s.aim.' + a) }))));
      };
      const dayChips = h('div', { class: 'chips small-gap' }, DAYS.map(day => h('button', { class: 'chip small' + (d.days.includes(day) ? ' on' : ''), type: 'button', onclick: e => { const on = !d.days.includes(day); d.days = on ? [...d.days, day] : d.days.filter(y => y !== day); e.currentTarget.classList.toggle('on', on); } }, dayName(day))));
      box.replaceChildren(...[
        textField(t('c.name'), d, 'name'),
        h('div', { class: 'grid2' }, selectField(t('tk.typeLabel'), d, 'type', SC.TRACKER_TYPES.filter(y => y !== 'weight' || d.type === 'weight' || !st.trackers.some(z => z.type === 'weight')).map(y => ({ value: y, label: t('tk.type.' + y) })), () => { if (d.type === 'time') { d.target = null; d.aim = 'max'; } else if (typeof d.target === 'string') d.target = null; draw(); }),
          ['count', 'number'].includes(d.type) ? textField(t('tk.unit'), d, 'unit', null, t('c.optional')) : h('span')),
        h('p', { class: 'muted small' }, t('tk.typeHelp.' + d.type)),
        targetField(),
        h('div', { class: 'grid2' }, selectField(t('tk.freq'), d, 'freq', SC.FREQS.map(f => ({ value: f, label: t('tk.freq.' + f) })), draw),
          d.freq === 'weekly' ? numField(t('tk.perWeek'), d, 'perWeek', null, '1') : selectField(t('tk.sectionName'), d, 'group', st.groups.map(g => ({ value: g.id, label: g.name })))),
        d.freq === 'days' ? h('div', { class: 'field' }, h('span', null, t('s.days')), dayChips) : null,
        d.freq === 'weekly' ? selectField(t('tk.sectionName'), d, 'group', st.groups.map(g => ({ value: g.id, label: g.name }))) : null,
        h('p', { class: 'muted small' }, t('tk.freqHelp.' + d.freq))].filter(Boolean));
    };
    draw();
    openSheet(isNew ? t('tk.new') : x.name, h('div', null, box,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          if (d.freq === 'days' && !d.days.length) { toast(t('pl.needDay')); return; }
          const s = latest(), out = { ...d, name: d.name.trim() };
          if (!out.id) { let id = U.slug(out.name); if (id === 'body-fat') id = 'bodyFat'; while (s.trackers.some(y => y.id === id)) id += '-2'; out.id = id; }
          const i = s.trackers.findIndex(y => y.id === out.id); if (i >= 0) s.trackers[i] = out; else s.trackers.push(out);
          saveAnd(s);
        } }, t('c.save')),
        x ? h('button', { class: 'btn', onclick: () => { const s = latest(), y = s.trackers.find(z => z.id === x.id); if (y) { y.archived = true; saveAnd(s, null, t('tk.archivedMsg', { name: x.name })); } } }, t('tk.archive')) : null,
        x ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.trackers = s.trackers.filter(z => z.id !== x.id); saveAnd(s, null, t('t.removed', { name: x.name })); } }, t('c.delete')) : null),
      x ? h('p', { class: 'muted small' }, t('tk.deleteHelp')) : null));
  }

  /* a reminder to export, unless the profile syncs (the cloud keeps a copy) or it was put off in the last two weeks */
  function backupNudge() {
    if (MB.sync.status().linked || pref('backupLater', '') > today()) return null;
    const meta = store.getMeta('backup'); const days = allDays();
    const since = meta && meta.exportedAt ? days.filter(d => (d.updatedAt || d.date) > meta.exportedAt).length : days.length;
    if (since < 7) return null;
    const el = h('div', { class: 'nudge' }, h('span', null, t('t.backupHint', { n: since })),
      h('span', { class: 'nudge-acts' }, h('button', { class: 'linkbtn quiet', type: 'button', onclick: () => { setPref('backupLater', addDays(today(), 14)); el.remove(); } }, t('c.later')),
        h('button', { class: 'linkbtn', type: 'button', onclick: exportSheet }, t('t.exportNow'))));
    return el;
  }
  function mealsCard() {
    const st = S.settings, prev = store.get('days/' + addDays(S.date, -1));
    const canCopy = !S.day.meals.length && prev && Array.isArray(prev.meals) && prev.meals.length;
    return card('meals', t('t.meals'), h('div', { class: 'head-r' }, canCopy ? h('button', { class: 'btn small', onclick: copyYesterday }, t('t.copyYesterday')) : null, editBtn(slotsSheet)),
      st.mealSlots.length ? h('div', null, st.mealSlots.map(w => slotBlock(w, w.id === leadSlot()))) : emptyAdd(t('t.noSlots'), t('t.addSlots'), slotsSheet),
      { summary: () => { const x = totals(S.day), n = st.mealSlots.filter(w => S.day.meals.some(m => m.slot === w.id)).length; return `${fmt(x.kcal)} kcal · ${fmt(x.p)} g · ${n}/${st.mealSlots.length}`; } });
  }
  const trainingCard = () => card('training', t('t.training'), h('button', { class: 'btn small', onclick: addSessionSheet }, t('t.addSession')), trainingList(), {
    summary: () => { const planned = plannedOn(S.date), done = S.day.sessions.filter(s => s.done !== false); return (planned.length ? t('t.doneOf', { n: planned.filter(p => done.some(s => s.typeId === p.type.id)).length, of: planned.length }) : String(done.length)) + (done.length ? ' · ' + fmtDur(sum(done, s => num(s.minutes))) : ''); },
    finished: () => { const planned = plannedOn(S.date); return planned.length > 0 && planned.every(p => S.day.sessions.some(s => s.typeId === p.type.id && s.done !== false)); } });
  /* the day itself: tags (sick, travel, competition...) and a note */
  function dayCard() {
    const st = S.settings, d = S.day, chips = h('div', { class: 'chips small-gap' });
    /* a tag an event puts on this day shows as on; it comes off with the event */
    const drawChips = () => { const fromEv = eventsOn(S.date).filter(e => e.tag); chips.replaceChildren(...st.tags.map(tg => { const ev = !d.tags.includes(tg.id) && fromEv.find(e => e.tag === tg.id), on = d.tags.includes(tg.id) || !!ev;
      return h('button', { class: 'chip small tagchip' + (on ? ' on' : ''), type: 'button', style: { '--kc': tagColor(tg) }, 'aria-pressed': String(on), disabled: ev ? true : null, title: ev ? ev.title : null,
        onclick: () => { d.tags = d.tags.includes(tg.id) ? d.tags.filter(x => x !== tg.id) : [...d.tags, tg.id]; saveDay(); drawChips(); updateCounts(); } }, h('i'), tg.name); }),
      h('button', { class: 'chip small ghostchip', type: 'button', onclick: tagsSheet }, st.tags.length ? t('c.edit') : '+ ' + t('dy.addTags'))); };
    drawChips();
    const n = h('textarea', { placeholder: t('t.notesPh'), value: d.note || '', 'aria-label': t('t.notes'), onchange: e => { d.note = e.target.value; saveDay(); } });
    return card('day', t('dy.title'), h('button', { class: 'btn ghost small', onclick: () => eventSheet(null) }, t('ev.add')), h('div', null, h('div', { class: 'field' }, h('span', null, t('dy.tags')), chips), h('label', { class: 'field' }, h('span', null, t('t.notes')), n)),
      { summary: () => [tagIdsOn(S.date, d).map(id => (st.tags.find(x => x.id === id) || {}).name).filter(Boolean).join(', '), d.note ? d.note.slice(0, 40) : ''].filter(Boolean).join(' · ') });
  }

  /* ---------- events ---------- */
  const evColor = e => { const tg = e.tag && S.settings.tags.find(x => x.id === e.tag); return tg ? tagColor(tg) : 'var(--accent)'; };
  const evWhen = e => (e.end ? `${fmtShort(e.date)} – ${fmtShort(e.end)}` : fmtShort(e.date)) + (e.time ? ' · ' + fmtTime(e.time) : '');
  const countdownText = date => { const n = U.diffDays(today(), date); return n <= 0 ? t('ev.today') : n === 1 ? t('ev.tomorrow') : t('ev.inDays', { n }); };
  /* the day's events as chips; on today, a countdown to the next big one */
  function eventStrip() {
    const evs = eventsOn(S.date), next = S.date === today() ? S.events.find(e => e.big && e.date > today() && U.diffDays(today(), e.date) <= 180) : null;
    if (!evs.length && !next) return null;
    const chip = e => {
      const len = e.end ? U.diffDays(e.date, e.end) + 1 : 1, n = U.diffDays(e.date, S.date) + 1;
      return h('button', { class: 'evchip' + (e.big ? ' big' : ''), type: 'button', style: { '--ec': evColor(e) }, onclick: () => eventSheet(e) },
        e.big ? h('span', { class: 'star', 'aria-hidden': 'true' }, '★') : h('i'), e.time ? h('small', null, fmtTime(e.time)) : null, h('b', null, e.title),
        len > 1 ? h('small', null, t('ev.dayOf', { n, of: len })) : null, e.offPlan ? h('small', null, t('ev.offPlanShort')) : null);
    };
    return h('div', { class: 'evstrip' }, evs.map(chip),
      next ? h('button', { class: 'evchip countdown', type: 'button', style: { '--ec': evColor(next) }, onclick: () => eventSheet(next) }, h('span', { class: 'star', 'aria-hidden': 'true' }, '★'), h('b', null, next.title), h('small', null, countdownText(next.date))) : null);
  }
  const dateIn = (label, obj, key) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'date', value: obj[key] || '', onchange: e => { obj[key] = e.target.value; } }));
  /* one event: what, when (a day or a stretch, a time), its tag, whether it is big or replaces the plan, how it went */
  function eventSheet(e, defaults) {
    const st = S.settings, d = e ? clone(e) : { id: '', date: S.route === 'today' ? S.date : today(), end: '', time: '', title: '', tag: '', big: false, offPlan: false, result: '', note: '', ...(defaults || {}) };
    const multi = { v: !!d.end }, endBox = h('div', { class: multi.v ? '' : 'hidden' }, dateIn(t('ev.end'), d, 'end'));
    const check = (key, label, help) => h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: !!d[key], onchange: ev => { d[key] = ev.target.checked; } }), h('span', { class: 'row-name' }, label, h('div', { class: 'muted small' }, help)));
    openSheet(e ? e.title : t('ev.new'), h('div', null,
      textField(t('ev.what'), d, 'title', null, t('ev.whatPh')),
      h('div', { class: 'grid2' }, dateIn(t('ev.date'), d, 'date'), h('label', { class: 'field' }, h('span', null, t('ev.time')), h('input', { type: 'time', value: d.time || '', onchange: ev => { d.time = ev.target.value; } }))),
      h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: multi.v, onchange: ev => { multi.v = ev.target.checked; endBox.classList.toggle('hidden', !multi.v); } }), h('span', { class: 'row-name' }, t('ev.multi'))), endBox,
      st.tags.length ? h('div', null, selectField(t('ev.tag'), d, 'tag', [{ value: '', label: '—' }, ...st.tags.map(tg => ({ value: tg.id, label: tg.name }))]), h('p', { class: 'muted small' }, t('ev.tagHelp'))) : null,
      check('big', t('ev.big'), t('ev.bigHelp')), check('offPlan', t('ev.offPlan'), t('ev.offPlanHelp')),
      textField(t('ev.result'), d, 'result', null, t('ev.resultPh')),
      h('label', { class: 'field' }, h('span', null, t('t.notes')), h('textarea', { value: d.note || '', oninput: ev => { d.note = ev.target.value; } })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.title || '').trim()) { toast(t('t.needName')); return; }
          if (!U.isDate(d.date)) { toast(t('ev.needDate')); return; }
          const out = SC.normalizeEvent({ ...d, end: multi.v ? d.end : '' });
          if (!e) { const base = U.slug(out.title) + '-' + out.date; let id = base, n = 2; while (store.get('events/' + id)) id = base + '-' + n++; out.id = id; }
          const { id, ...doc } = out; store.setDoc('events/' + id, { ...doc, updatedAt: store.stamp() }); loadEvents();
          closeSheet(); render(); toast(t('ev.saved'));
        } }, t('c.save')),
        e ? h('button', { class: 'btn ghost danger', onclick: () => deleteEvent(e) }, t('c.delete')) : null)));
  }
  function deleteEvent(e) {
    const { id, ...doc } = store.get('events/' + e.id) || e;
    store.deleteDoc('events/' + e.id); loadEvents(); closeSheet(); render();
    undoToast(t('t.removed', { name: e.title }), () => { store.setDoc('events/' + e.id, { ...doc, updatedAt: store.stamp() }); loadEvents(); render(); });
  }
  /* events as rows: a star for big ones, the title, when, how it went; a countdown for the ones ahead */
  function eventRows(list) {
    return h('div', { class: 'list evlist' }, list.map(e => h('button', { class: 'row pick evrow' + (e.big ? ' big' : ''), type: 'button', style: { '--ec': evColor(e) }, onclick: () => eventSheet(e) },
      h('span', { class: 'evmark', 'aria-hidden': 'true' }, e.big ? '★' : '•'),
      h('span', { class: 'row-name' }, h('div', null, e.title), h('div', { class: 'muted small' }, [evWhen(e), e.result || null].filter(Boolean).join(' · '))),
      e.date > today() ? h('span', { class: 'row-target' }, countdownText(e.date)) : null)));
  }
  const tagColor = tg => { const i = S.settings.tags.indexOf(tg); return `var(--kc-${tg.color || SC.KIND_COLORS[(i + 3) % SC.KIND_COLORS.length]})`; };
  function tagsSheet() {
    const tags = clone(S.settings.tags);
    openSheet(t('dy.tags'), h('div', null, h('p', { class: 'muted small' }, t('dy.tagsSub')),
      listEditor(tags, [{ key: 'name', label: t('c.name') }, { key: 'color', label: t('dy.color'), type: 'select', small: true, options: () => [{ value: '', label: '—' }, ...SC.KIND_COLORS.map(c => ({ value: c, label: t('col.' + c) }))] }], () => {}, t('dy.addTag'),
        item => h('label', { class: 'chk', title: t('dy.skipHelp') }, h('input', { type: 'checkbox', checked: !!item.skip, onchange: e => { item.skip = e.target.checked; } }), t('dy.skip')), { sortable: true }),
      h('p', { class: 'muted small' }, t('dy.skipHelp')),
      saveRow(() => { const s = latest(); s.tags = slugIds(tags.filter(x => String(x.name || '').trim()), S.settings.tags); saveAnd(s); })));
  }

  /* setup edited from Today; saves start from the stored settings, so changes synced in while a sheet was open are kept */
  const latest = () => readSettings();
  const saveRow = (onSave, extra) => h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: onSave }, t('c.save')), extra);
  function targetsSheet() {
    const d = clone(S.settings.targets), nutrients = clone(S.settings.nutrients), aims = SC.AIMS.map(a => ({ value: a, label: t('s.aim.' + a) }));
    const line = (key, label) => h('div', { class: 'grid2' }, numField(label, d, key), selectField(t('s.aim'), d.aim, key, aims));
    openSheet(t('s.targets'), h('div', null, h('p', { class: 'muted small' }, t('s.targetsHelp')),
      line('kcal', t('s.calories')), line('protein', t('s.proteinG')), line('carbs', t('s.carbsG')), line('fat', t('s.fatG')),
      h('div', { class: 'subhead' }, t('nu.title')), h('p', { class: 'muted small' }, t('nu.sub')),
      listEditor(nutrients, [{ key: 'name', label: t('c.name') }, { key: 'unit', label: t('tk.unit'), small: true }, { key: 'target', label: t('tk.target'), type: 'number', small: true },
        { key: 'aim', label: t('s.aim'), type: 'select', small: true, options: () => aims }], () => {}, t('nu.add'), null, { sortable: true }),
      saveRow(() => { const s = latest(); s.targets = { kcal: num(d.kcal), protein: num(d.protein), carbs: num(d.carbs), fat: num(d.fat), aim: d.aim }; s.nutrients = slugIds(nutrients.filter(n => String(n.name || '').trim()), S.settings.nutrients).map(n => ({ ...n, unit: n.unit == null || n.unit === '' ? 'g' : n.unit })); saveAnd(s); })), { wide: true });
  }
  function slotsSheet() {
    const list = clone(S.settings.mealSlots);
    openSheet(t('s.slots'), h('div', null, listEditor(list, [{ key: 'name', label: t('s.slotName') }], () => {}, t('s.addSlot'), null, { sortable: true }),
      saveRow(() => { const s = latest(); s.mealSlots = list.filter(x => String(x.name || '').trim()); saveAnd(s); })));
  }

  /* meals */
  const nutLine = n => S.settings.nutrients.filter(x => n && n[x.id]).map(x => `${fmt1(n[x.id])} ${x.unit} ${x.name}`).join(' · ');
  const slotStart = w => { const b = S.settings.calendar.find(x => x.kind === 'meal' && x.slotId === w.id && x.days.includes(dow(S.date))); return b && b.start ? b.start : null; };
  /* Of the things still to log, the one whose button stands out: today, the one whose time has come (or the next one);
     another day, the first. start(x) is its HH:MM or null. */
  function leadOf(open, start) {
    if (!open.length) return null;
    if (S.date !== today()) return open[0];
    const now = nowMin(), timed = open.map(x => ({ x, a: SC.hm(start(x)) })).filter(y => y.a != null);
    const due = timed.filter(y => y.a <= now + 60).sort((a, b) => b.a - a.a)[0] || timed.sort((a, b) => a.a - b.a)[0];
    return due ? due.x : open[0];
  }
  const leadSlot = () => { const w = leadOf(S.settings.mealSlots.filter(x => !S.day.meals.some(m => m.slot === x.id)), slotStart); return w ? w.id : null; };
  function slotBlock(w, lead) {
    const meals = S.day.meals.filter(m => m.slot === w.id), start = slotStart(w);
    const sub = { kcal: 0, p: 0, c: 0, f: 0, n: {} };
    meals.forEach(m => { sub.kcal += num(m.kcal); sub.p += num(m.p); sub.c += num(m.c); sub.f += num(m.f); for (const k of Object.keys(m.n || {})) sub.n[k] = (sub.n[k] || 0) + num(m.n[k]); });
    return h('div', { class: 'slot' },
      h('div', { class: 'slot-head' }, h('h3', null, w.name, start ? h('small', { class: 'muted' }, ' ' + fmtTime(start)) : null), h('span', { class: 'muted' }, meals.length ? t('t.slotTotal', { kcal: fmt(sub.kcal), p: fmt(sub.p) }) : t('t.nothingLogged')),
        h('button', { class: 'btn small' + (lead ? ' primary' : ''), onclick: () => addMealSheet(w) }, t('c.add'))),
      meals.length ? h('div', { class: 'list' }, meals.map(m => h('button', { class: 'meal', onclick: () => editMeal(m) },
        h('span', { class: 'meal-name' }, m.name), h('span', { class: 'meal-macros' }, `${fmt(m.kcal)} · ${fmt(m.p)}P ${fmt(m.c)}C ${fmt(m.f)}F`)))) : null,
      meals.length ? h('div', { class: 'actions end' }, h('button', { class: 'btn ghost small', onclick: () => saveAsTemplate(w, sub) }, t('t.saveTemplate'))) : null);
  }
  const scaleN = (n, k) => { const out = {}; for (const key of Object.keys(n || {})) out[key] = Math.round(num(n[key]) * k * 10) / 10; return out; };
  function addMeal(slotId, m) {
    const meal = { id: uid(), slot: slotId, name: m.name, kcal: num(m.kcal), p: num(m.p), c: num(m.c), f: num(m.f) };
    if (m.foodId) meal.foodId = m.foodId; if (m.qty) meal.qty = num(m.qty); if (m.tplId) meal.tplId = m.tplId;
    const n = scaleN(m.n, 1); if (Object.keys(n).length) meal.n = n;
    S.day.meals.push(meal);
    saveDay(); closeSheet(); render(); toast(t('t.logged', { name: m.name }));
  }
  function removeMeal(id) {
    const i = S.day.meals.findIndex(m => m.id === id), gone = S.day.meals[i];
    S.day.meals = S.day.meals.filter(m => m.id !== id); saveDay(); render();
    if (gone) undoToast(t('t.removed', { name: gone.name }), () => { S.day.meals.splice(Math.min(i, S.day.meals.length), 0, gone); saveDay(); render(); });
  }
  function recentMeals() {
    const seen = new Set(), out = [];
    for (const d of allDays().reverse()) for (const m of d.meals.slice().reverse()) { const k = m.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m); } if (out.length >= 24) return out; }
    return out;
  }
  /* nutrient inputs for a meal, food or saved meal */
  const nutFields = obj => S.settings.nutrients.length ? h('div', { class: 'grid4' }, S.settings.nutrients.map(n => { obj.n = obj.n || {}; return numField(`${n.name} (${n.unit})`, obj.n, n.id); })) : null;
  function addMealSheet(w) {
    const body = h('div'), pane = h('div');
    const tabs = [['recent', t('t.recent')], ['foods', t('t.foods')], ['templates', t('t.templates')], ['custom', t('t.custom')]];
    const draw = tab => {
      pane.replaceChildren();
      if (tab === 'recent') {
        const rs = recentMeals();
        pane.append(rs.length ? h('div', { class: 'list' }, rs.map(m => h('div', { class: 'row pick' },
          h('div', { class: 'row-name' }, h('div', null, m.name), h('div', { class: 'muted small' }, `${fmt(m.kcal)} kcal · ${fmt(m.p)} g`)),
          h('button', { class: 'btn small primary', onclick: () => addMeal(w.id, m) }, t('t.log'))))) : h('p', { class: 'empty' }, t('t.noRecent')));
      } else if (tab === 'foods') {
        const q = h('input', { type: 'search', placeholder: t('f.search') }); const list = h('div', { class: 'list' });
        const redraw = () => {
          const s = q.value.trim().toLowerCase();
          const rows = S.foods.filter(f => !s || f.name.toLowerCase().includes(s) || (f.category || '').toLowerCase().includes(s)).slice(0, 80);
          list.replaceChildren(...rows.map(f => {
            const qty = h('input', { type: 'number', class: 'qty', value: 1, min: 0, step: 0.5, inputmode: 'decimal', 'aria-label': t('t.servings') });
            return h('div', { class: 'row pick' }, h('div', { class: 'row-name' }, h('div', null, f.name), h('div', { class: 'muted small' }, `${f.serving || ''}${f.serving ? ' · ' : ''}${fmt(f.kcal)} kcal · ${fmt(f.p)} g`)),
              qty, h('button', { class: 'btn small primary', onclick: () => { const k = num(qty.value) || 1; addMeal(w.id, { name: k === 1 ? f.name : `${f.name} ×${k}`, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k, n: scaleN(f.n, k), foodId: f.id, qty: k }); } }, t('c.add')));
          }));
          if (!rows.length) list.append(h('p', { class: 'empty' }, S.foods.length ? t('t.noMatches') : t('t.noFoods')));
        };
        q.addEventListener('input', redraw); redraw(); pane.append(q, list); setTimeout(() => q.focus(), 50);
      } else if (tab === 'templates') {
        const tpls = S.templates.slice().sort(byName);
        pane.append(tpls.length ? h('div', { class: 'list' }, tpls.map(tp => h('div', { class: 'row pick' },
          h('div', { class: 'row-name' }, h('div', null, tp.name), h('div', { class: 'muted small' }, `${fmt(tp.kcal)} kcal · ${fmt(tp.p)} g`)),
          h('button', { class: 'btn ghost icon', 'aria-label': t('c.delete'), onclick: () => { deleteTemplate(tp); draw('templates'); } }, '×'),
          h('button', { class: 'btn small primary', onclick: () => addMeal(w.id, { ...tp, tplId: tp.id }) }, t('t.log'))))) : h('p', { class: 'empty' }, t('t.noTemplates')));
      } else {
        const m = { name: '', kcal: null, p: null, c: null, f: null, n: {} };
        pane.append(textField(t('t.whatAte'), m, 'name'), h('div', { class: 'grid4' }, numField(t('c.kcal'), m, 'kcal'), numField(t('c.protein'), m, 'p'), numField(t('c.carbs'), m, 'c'), numField(t('c.fat'), m, 'f')), nutFields(m),
          h('button', { class: 'btn primary', onclick: () => { if (!m.name.trim()) { toast(t('t.needName')); return; } addMeal(w.id, m); } }, t('t.log')));
      }
    };
    body.append(segmented(tabs.map(([v, l]) => ({ value: v, label: l })), recentMeals().length ? 'recent' : 'foods', draw), pane);
    draw(recentMeals().length ? 'recent' : 'foods');
    openSheet(t('t.addTo', { slot: w.name }), body);
  }
  function editMeal(m) {
    const d = clone(m); d.n = d.n || {};
    openSheet(t('t.editMeal'), h('div', null, textField(t('c.name'), d, 'name'),
      selectField(t('t.slot'), d, 'slot', S.settings.mealSlots.map(s => ({ value: s.id, label: s.name }))),
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')), nutFields(d),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const i = S.day.meals.findIndex(x => x.id === m.id); if (i >= 0) { const out = { ...d, kcal: num(d.kcal), p: num(d.p), c: num(d.c), f: num(d.f) }; const n = scaleN(d.n, 1); Object.keys(n).forEach(k => { if (!n[k]) delete n[k]; }); if (Object.keys(n).length) out.n = n; else delete out.n; S.day.meals[i] = out; } saveDay(); closeSheet(); render(); toast(t('t.mealSaved')); } }, t('c.save')),
        h('button', { class: 'btn ghost danger', onclick: () => { closeSheet(); removeMeal(m.id); } }, t('c.remove')))));
  }
  function copyYesterday() {
    const prev = store.get('days/' + addDays(S.date, -1)); if (!prev) return;
    const meals = SC.normalizeDay(prev).meals.map(m => ({ ...m, id: uid() }));
    S.day.meals.push(...meals); saveDay(); render();
    undoToast(t('t.copied', { n: meals.length }), () => { const ids = new Set(meals.map(m => m.id)); S.day.meals = S.day.meals.filter(m => !ids.has(m.id)); saveDay(); render(); });
  }
  function saveAsTemplate(w, sub) {
    const tp = { name: w.name, ...sub };
    openSheet(t('t.saveTemplate'), h('div', null, textField(t('t.templateName'), tp, 'name'), h('p', { class: 'muted small' }, `${fmt(tp.kcal)} kcal · ${fmt(tp.p)}P ${fmt(tp.c)}C ${fmt(tp.f)}F`),
      h('button', { class: 'btn primary', onclick: () => { const doc = { name: tp.name, kcal: tp.kcal, p: tp.p, c: tp.c, f: tp.f, slot: w.id, updatedAt: store.stamp() }; if (Object.keys(tp.n || {}).length) doc.n = tp.n; store.setDoc('templates/' + uid(), doc); S.templates = store.list('templates'); closeSheet(); toast(t('t.templateSaved')); } }, t('c.save'))));
  }
  function deleteTemplate(tp) {
    const { id, ...doc } = store.get('templates/' + tp.id) || tp;
    store.deleteDoc('templates/' + tp.id); S.templates = store.list('templates');
    undoToast(t('f.deleted', { name: tp.name }), () => { store.setDoc('templates/' + tp.id, { ...doc, updatedAt: store.stamp() }); S.templates = store.list('templates'); render(); });
  }

  /* training */
  function trainingList() {
    const st = setupOn(S.date), d = S.day, isToday = S.date === today(), past = S.date < today(), now = nowMin();
    const planned = plannedOn(S.date, st);
    const loggedTypes = new Set(d.sessions.map(s => s.typeId));
    const rows = [], todo = planned.filter(p => !loggedTypes.has(p.type.id)), lead = leadOf(todo, p => p.block.start);
    todo.forEach(p => {
      const a = SC.hm(p.block.start), late = !past && isToday && a != null && a + (SC.duration(p.block) || 0) <= now;
      rows.push(h('div', { class: 'sess', style: { '--kc': kindColor(p.type.kind) } },
        h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, p.type.name),
          h('div', { class: 'muted small' }, past ? h('span', { class: 'tag first st-miss' }, t('t.missed')) : late ? h('span', { class: 'tag first st-half' }, t('t.notLogged')) : null,
            [p.block.start ? fmtTime(p.block.start) : null, t('t.planned', { min: p.minutes, kcal: fmt(p.kcal) })].filter(Boolean).join(' · '))),
        h('div', { class: 'sess-actions' }, h('button', { class: 'btn small' + (p === lead ? ' primary' : ''), onclick: () => sessionSheet(newSession(p.type, p.minutes, p.kcal), true) }, t('t.log')),
          h('button', { class: 'btn small', onclick: () => markDone(p.type, p.minutes, p.kcal) }, t('t.markDone')))));
    });
    d.sessions.forEach(s => rows.push(h('div', { class: 'sess done', style: { '--kc': kindColor(s.kind) } },
      h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, s.name),
        h('div', { class: 'muted small' }, [kindName(s.kind), `${num(s.minutes)} ${t('c.min')}`, `${fmt(s.kcal)} kcal`, s.effort ? t('t.effortN', { n: s.effort }) : null, s.sets && s.sets.length ? t('t.setsCount', { n: s.sets.length }) : null, fieldLine(s), s.notes || null].filter(Boolean).join(' · '))),
      h('div', { class: 'sess-actions' }, h('button', { class: 'btn small', onclick: () => sessionSheet(s, false) }, t('t.details'))))));
    const off = eventsOn(S.date).filter(e => e.offPlan);
    if (off.length && SC.plannedFor(st, dow(S.date)).length) rows.unshift(h('p', { class: 'muted small offplan' }, t('ev.offPlanLine', { name: off.map(e => e.title).join(', ') })));
    if (!rows.length) rows.push(h('p', { class: 'empty' }, t('t.nothingScheduled')));
    return h('div', { class: 'list' }, rows);
  }
  /* a session's category fields, in the category's order */
  const fieldsOf = kind => ((S.settings.sessionKinds.find(k => k.id === kind) || {}).fields || []);
  const fieldText = (f, v) => f.type === 'duration' ? fmtDur(num(v)) : f.type === 'rating' ? `${v}/5` : f.type === 'number' ? fmt1(v) + (f.unit ? ' ' + f.unit : '') : String(v);
  const fieldLine = s => fieldsOf(s.kind).filter(f => s.fields && s.fields[f.id] != null && s.fields[f.id] !== '').map(f => `${f.name} ${fieldText(f, s.fields[f.id])}`).join(' · ') || null;
  const newSession = (type, minutes, kcal) => ({ id: uid(), typeId: type.id, name: type.name, kind: type.kind || '', minutes: num(minutes != null ? minutes : type.minutes), kcal: num(kcal != null ? kcal : type.kcal), done: true, notes: '', effort: null, fields: {}, sets: [] });
  function markDone(type, minutes, kcal) { S.day.sessions.push(newSession(type, minutes, kcal)); saveDay(); render(); }
  function removeSession(id) {
    const i = S.day.sessions.findIndex(s => s.id === id), gone = S.day.sessions[i];
    S.day.sessions = S.day.sessions.filter(s => s.id !== id); saveDay(); render();
    if (gone) undoToast(t('t.removed', { name: gone.name }), () => { S.day.sessions.splice(Math.min(i, S.day.sessions.length), 0, gone); saveDay(); render(); });
  }
  function addSessionSheet() {
    const st = S.settings;
    const pick = { typeId: st.sessionTypes[0] ? st.sessionTypes[0].id : '', name: '', kind: st.sessionKinds[0] ? st.sessionKinds[0].id : '', minutes: 60, kcal: 0 };
    const sel = h('select', null, st.sessionTypes.map(x => h('option', { value: x.id }, x.name)), h('option', { value: '' }, t('t.somethingElse')));
    const custom = h('div', { style: { display: pick.typeId ? 'none' : 'block' } }, textField(t('c.name'), pick, 'name'),
      st.sessionKinds.length ? selectField(t('t.kind'), pick, 'kind', st.sessionKinds.map(k => ({ value: k.id, label: k.name }))) : null,
      h('div', { class: 'grid2' }, numField(t('t.minutes'), pick, 'minutes'), numField(t('c.kcal'), pick, 'kcal')));
    sel.addEventListener('change', () => { pick.typeId = sel.value; custom.style.display = pick.typeId ? 'none' : 'block'; });
    openSheet(t('t.addSession'), h('div', null, h('label', { class: 'field' }, h('span', null, t('t.session')), sel), custom,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        const x = st.sessionTypes.find(y => y.id === pick.typeId);
        if (x) { sessionSheet(newSession(x), true); return; }
        if (!pick.name.trim()) { toast(t('t.needName')); return; }
        sessionSheet({ id: uid(), typeId: '', name: pick.name, kind: pick.kind, minutes: num(pick.minutes), kcal: num(pick.kcal), done: true, notes: '', effort: null, fields: {}, sets: [] }, true);
      } }, t('c.next')))));
  }
  const setText = r => [r.wt != null ? `${fmt1(r.wt)} ${unit()}` : null, r.reps2 != null ? `${r.reps == null ? '–' : r.reps}/${r.reps2}` : r.reps != null ? String(r.reps) : null].filter(Boolean).join(' × ');
  /* session sheet: effort, the category's fields, plan-driven rows (per exercise, per set, per side) plus free rows; isNew adds it on save */
  function sessionSheet(s, isNew) {
    const d = clone(s); d.sets = d.sets || []; d.fields = d.fields || {};
    const type = S.settings.sessionTypes.find(x => x.id === d.typeId), plan = type ? type.plan : [];
    const groups = [];
    /* blocks marked not logged (warm-ups, cool-downs) stay out */
    for (const b of plan) { if (b.log === false) continue; for (const it of b.items) { const ex = exById(it.exerciseId) || SC.resolveExercise(it.name, S.settings.exercises); groups.push({ key: it.exerciseId || it.name, block: b.label, item: it, ex, perSide: it.perSide, rows: [] }); } }
    d.sets.forEach(r => { const g = groups.find(x => (r.exerciseId && x.key === r.exerciseId) || x.item.name === r.ex); if (g) g.rows.push(r); else { let f = groups.find(x => x.free && x.key === (r.exerciseId || r.ex)); if (!f) { f = { key: r.exerciseId || r.ex, free: true, item: { name: r.ex, sets: 0, reps: '', perSide: false }, ex: exById(r.exerciseId), perSide: !!(exById(r.exerciseId) || {}).perSide, rows: [] }; groups.push(f); } f.rows.push(r); } });
    for (const g of groups) if (!g.free && !g.rows.length) for (let i = 0; i < Math.max(1, g.item.sets); i++) g.rows.push({ ex: g.item.name, exerciseId: g.ex ? g.ex.id : '', wt: null, reps: null, reps2: null });
    /* what each exercise was last time, found in one pass over the days */
    const lastOf = new Map(), pastDays = allDays().filter(x => x.date <= S.date).reverse();
    for (const g of groups) { const key = g.ex ? g.ex.id : '', name = g.item.name;
      find: for (const x of pastDays) for (const ss of x.sessions) { if (ss.id === d.id) continue; const rows = ss.sets.filter(r => (key && r.exerciseId === key) || (name && r.ex === name)); if (rows.length) { lastOf.set(g, { date: x.date, rows }); break find; } } }
    const repeat = g => { const last = lastOf.get(g); if (last) g.rows = last.rows.map(r => ({ ex: g.item.name, exerciseId: g.ex ? g.ex.id : '', wt: r.wt, reps: r.reps, reps2: r.reps2 })); };
    const blank = g => g.rows.every(r => r.wt == null && r.reps == null && r.reps2 == null);
    const repWord = g => g.ex && g.ex.unit && g.ex.unit !== 'reps' ? t('u.' + g.ex.unit) : t('t.reps');
    const box = h('div');
    const rowEl = (g, r, i) => {
      const gap = () => { if (!g.perSide || r.reps == null || r.reps2 == null || !Math.max(r.reps, r.reps2)) return ''; const p = Math.round(Math.abs(r.reps - r.reps2) / Math.max(r.reps, r.reps2) * 100); return p + '%'; };
      const gapEl = h('span', { class: 'gap' }, gap());
      const upd = () => { gapEl.textContent = gap(); gapEl.classList.toggle('bad', parseInt(gapEl.textContent, 10) > 10); };
      return h('div', { class: 'setrow' + (g.perSide ? ' sides' : '') }, h('span', { class: 'setno' }, i + 1),
        h('input', { type: 'number', placeholder: unit(), inputmode: 'decimal', 'aria-label': unit(), value: r.wt == null ? '' : r.wt, oninput: e => r.wt = e.target.value === '' ? null : num(e.target.value) }),
        h('input', { type: 'number', placeholder: g.perSide ? t('t.left') : repWord(g), inputmode: 'numeric', value: r.reps == null ? '' : r.reps, oninput: e => { r.reps = e.target.value === '' ? null : num(e.target.value); upd(); } }),
        g.perSide ? h('input', { type: 'number', placeholder: t('t.right'), inputmode: 'numeric', value: r.reps2 == null ? '' : r.reps2, oninput: e => { r.reps2 = e.target.value === '' ? null : num(e.target.value); upd(); } }) : null,
        g.perSide ? gapEl : null,
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { g.rows.splice(i, 1); draw(); } }, '×'));
    };
    const draw = () => box.replaceChildren(...groups.map(g => {
      const locked = g.ex && g.ex.gate && !SC.gateOpen(S.settings, g.ex.gate);
      const target = [g.item.sets ? `${g.item.sets} ×` : '', g.item.reps, g.perSide ? t('t.perSide') : '', g.item.rir ? `${g.item.rir} RIR` : '', g.item.rest].filter(Boolean).join(' · ');
      const last = lastOf.get(g), rest = restSec(g.item.rest);
      return h('div', { class: 'exgroup' + (locked ? ' locked' : '') },
        h('div', { class: 'exhead' }, g.block ? h('span', { class: 'blocklab' }, g.block) : null,
          g.ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(g.ex) }, g.item.name) : h('span', null, g.item.name),
          h('span', { class: 'muted small' }, target), locked ? h('span', { class: 'lock' }, t('t.locked', { gate: gateLabel(g.ex.gate) })) : null,
          rest ? h('button', { class: 'btn ghost small restbtn', type: 'button', title: t('t.startRest'), 'aria-label': t('t.startRest'), onclick: () => startRest(rest) }, '⏱ ' + fmtRest(rest)) : null),
        last ? h('div', { class: 'lastline' }, t('t.lastTime', { d: fmtShort(last.date), sets: last.rows.map(setText).filter(Boolean).join(', ') }),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => { repeat(g); draw(); } }, t('t.repeat'))) : null,
        g.item.note ? h('div', { class: 'muted small' }, g.item.note) : null,
        g.rows.map((r, i) => rowEl(g, r, i)),
        h('button', { class: 'btn ghost small', onclick: () => { const lastRow = g.rows[g.rows.length - 1]; g.rows.push({ ex: g.item.name, exerciseId: g.ex ? g.ex.id : '', wt: lastRow ? lastRow.wt : null, reps: null, reps2: null }); draw(); } }, t('t.addSet')));
    }));
    draw();
    const effortRow = h('div', { class: 'effort', role: 'group', 'aria-label': t('t.effort') });
    const drawEffort = () => effortRow.replaceChildren(...[...Array(10)].map((_, i) => h('button', { type: 'button', class: 'rate-btn' + (d.effort === i + 1 ? ' on' : ''), 'aria-pressed': String(d.effort === i + 1), onclick: () => { d.effort = d.effort === i + 1 ? null : i + 1; drawEffort(); } }, String(i + 1))));
    drawEffort();
    const fields = fieldsOf(d.kind), fieldInputs = fields.length ? h('div', { class: 'grid2' }, fields.map(f => {
      if (f.type === 'text') return textField(f.name, d.fields, f.id);
      if (f.type === 'rating') { if (d.fields[f.id] != null) d.fields[f.id] = String(d.fields[f.id]); return selectField(f.name + ' (1–5)', d.fields, f.id, [{ value: '', label: '—' }, ...[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: String(n) }))]); }
      return numField(f.name + (f.type === 'duration' ? ` (${t('c.min')})` : f.unit ? ` (${f.unit})` : ''), d.fields, f.id);
    })) : null;
    const addFree = () => { const ex = { name: '' }; openSheet(t('t.exercise'), h('div', null, exercisePicker(ex), h('button', { class: 'btn primary', onclick: () => { if (!ex.name.trim()) return; const e = SC.resolveExercise(ex.name, S.settings.exercises); groups.push({ key: e ? e.id : ex.name, free: true, item: { name: e ? e.name : ex.name, sets: 0, reps: '', perSide: false }, ex: e, perSide: !!(e && e.perSide), rows: [{ ex: e ? e.name : ex.name, exerciseId: e ? e.id : '', wt: null, reps: null, reps2: null }] }); open(); draw(); } }, t('c.add')))); };
    const open = () => openSheet(d.name, h('div', null, h('div', { class: 'grid2' }, numField(t('t.minutes'), d, 'minutes'), numField(t('t.kcalBurned'), d, 'kcal')),
      h('div', { class: 'field' }, h('span', null, t('t.effort'), ' ', helpTip(t('t.effortHelp'))), effortRow),
      fieldInputs,
      groups.length ? h('div', { class: 'subhead' }, t('t.sets'), lastOf.size ? h('button', { class: 'linkbtn fillall', type: 'button', onclick: () => { groups.filter(blank).forEach(repeat); draw(); } }, t('t.fillAll')) : null) : null, box,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: addFree }, t('t.addExercise'))),
      h('label', { class: 'field' }, h('span', null, t('t.notes')), h('textarea', { value: d.notes || '', oninput: e => d.notes = e.target.value })),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        d.sets = groups.flatMap(g => g.rows).filter(r => r.wt != null || r.reps != null || r.reps2 != null).map(r => ({ ex: r.ex, exerciseId: r.exerciseId, wt: r.wt, reps: r.reps, reps2: r.reps2 }));
        const fv = {}; for (const f of fields) { const v = d.fields[f.id]; if (v == null || v === '') continue; fv[f.id] = f.type === 'text' ? String(v) : num(v); }
        const i = S.day.sessions.findIndex(x => x.id === d.id);
        const out = { ...d, minutes: num(d.minutes), kcal: num(d.kcal), notes: d.notes || '', fields: fv };
        if (i >= 0) S.day.sessions[i] = out; else S.day.sessions.push(out);
        saveDay(); closeSheet(); render();
      } }, t('c.save')),
        !isNew && S.day.sessions.some(x => x.id === d.id) ? h('button', { class: 'btn ghost danger', onclick: () => { closeSheet(); removeSession(d.id); } }, t('c.remove')) : null)), { wide: true });
    open();
  }
  /* rest between sets: "60 s", "90", "2 min" or "1:30" in seconds */
  function restSec(v) {
    const s = String(v || '').trim(), mmss = /^(\d+):(\d{2})$/.exec(s); if (mmss) return +mmss[1] * 60 + +mmss[2];
    const m = /(\d+(?:[.,]\d+)?)\s*(min|mins|minutes|m(?![a-z])|')?/i.exec(s); if (!m) return 0;
    const n = parseFloat(m[1].replace(',', '.')); return Math.round(m[2] ? n * 60 : n);
  }
  const fmtRest = sec => sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
  /* the rest timer: a pill over everything, tap to stop; at zero it buzzes and says so */
  let restTimer = null;
  function startRest(sec) {
    clearInterval(restTimer); const old = document.querySelector('.restpill'); if (old) old.remove();
    const end = Date.now() + sec * 1000, pill = h('button', { class: 'restpill', type: 'button', 'aria-live': 'polite', onclick: () => { clearInterval(restTimer); pill.remove(); } });
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      if (left > 0) { pill.textContent = t('t.restLeft', { t: fmtRest(left) }); return; }
      clearInterval(restTimer); pill.classList.add('done'); pill.textContent = t('t.restDone');
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
      setTimeout(() => pill.remove(), 4000);
    };
    document.body.append(pill); tick(); restTimer = setInterval(tick, 250);
  }
  function exercisePicker(obj) {
    const inp = h('input', { type: 'text', list: 'exlist', placeholder: t('t.exercise'), value: obj.name || '', oninput: e => obj.name = e.target.value });
    return h('label', { class: 'field' }, h('span', null, t('t.exercise')), inp, h('datalist', { id: 'exlist' }, S.settings.exercises.map(e => h('option', { value: e.name }))));
  }
  /* Epley estimate of a one-rep max, for weighted rep sets; timed and distance sets have none */
  const e1rm = (r, ex) => r.wt && (!ex || ex.unit === 'reps') ? r.wt * (1 + Math.max(num(r.reps), num(r.reps2)) / 30) : null;
  /* every logged set of an exercise, by session, oldest first */
  function exerciseHistory(ex) {
    const out = [];
    for (const d of allDays()) for (const s of d.sessions) {
      const rows = s.sets.filter(r => r.exerciseId === ex.id || (!r.exerciseId && r.ex && r.ex.toLowerCase() === ex.name.toLowerCase()));
      if (rows.length) out.push({ date: d.date, session: s.name, rows, best: Math.max(0, ...rows.map(r => e1rm(r, ex) || 0)), top: Math.max(0, ...rows.map(r => num(r.wt))), reps: Math.max(0, ...rows.map(r => Math.max(num(r.reps), num(r.reps2)))) });
    }
    return out;
  }
  function exerciseCard(ex) {
    const locked = ex.gate && !SC.gateOpen(S.settings, ex.gate);
    const im = thumb(ex.image, 'exhero'), hist = exerciseHistory(ex);
    const rec = hist.length ? { e1: hist.reduce((a, x) => x.best > a.best ? x : a, hist[0]), top: hist.reduce((a, x) => x.top > a.top ? x : a, hist[0]), reps: hist.reduce((a, x) => x.reps > a.reps ? x : a, hist[0]) } : null;
    openSheet(ex.name, h('div', { class: 'excard' }, im,
      ex.cues ? h('p', null, ex.cues) : null,
      h('p', { class: 'muted small' }, [ex.category, t('u.' + ex.unit), ex.perSide ? t('t.perSide') : null, ex.gate ? (locked ? t('t.locked', { gate: gateLabel(ex.gate) }) : t('t.unlocked', { gate: gateLabel(ex.gate) })) : null].filter(Boolean).join(' · ')),
      rec ? h('div', null, h('div', { class: 'subhead' }, t('ex.records')), h('div', { class: 'stats' },
        rec.top.top ? statCard(`${fmt1(rec.top.top)} ${unit()}`, t('ex.heaviest'), fmtShort(rec.top.date)) : null,
        rec.e1.best ? statCard(`${fmt1(rec.e1.best)} ${unit()}`, t('ex.best1rm'), fmtShort(rec.e1.date)) : null,
        rec.reps.reps ? (ex.unit === 'reps' ? statCard(String(rec.reps.reps), t('ex.mostReps'), fmtShort(rec.reps.date)) : statCard(`${fmt(rec.reps.reps)} ${t('u.' + ex.unit)}`, t('ex.best'), fmtShort(rec.reps.date))) : null),
        hist.filter(x => x.best).length > 1 ? svg(trend(hist.filter(x => x.best).map(x => ({ date: x.date, v: Math.round(x.best * 10) / 10 })), { label: t('ex.best1rm') })) : null,
        h('div', { class: 'subhead' }, t('ex.recent')), h('div', { class: 'list' }, hist.slice(-8).reverse().map(x => h('div', { class: 'row pick' }, h('span', { class: 'row-name' }, h('div', null, fmtShort(x.date) + ' · ' + x.session), h('div', { class: 'muted small' }, x.rows.map(setText).filter(Boolean).join(', ')))))))
        : h('p', { class: 'muted small' }, t('ex.noHistory')),
      h('div', { class: 'actions' },
        ex.image && !isImageUrl(ex.image) ? h('a', { class: 'btn', href: ex.image, target: '_blank', rel: 'noopener' }, t('l.images')) : null,
        ex.video ? h('a', { class: 'btn', href: ex.video, target: '_blank', rel: 'noopener' }, t('l.video')) : null,
        h('button', { class: 'btn ghost', onclick: () => exerciseForm(ex) }, t('c.edit')))), { wide: hist.length > 0 });
  }

  /* ---------- Plan: the ideal week ---------- */
  /* The week you aim for: what is coming up, where the training cycle and progressions stand, and the calendar with
     the week's training total. Everything opens in a sheet with Edit and Delete; there is no separate edit mode. */
  function viewPlan() {
    const st = S.settings, wrap = h('div', { class: 'page plan' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('nav.plan')), h('div', { class: 'sub' }, t('pl.sub'))),
      h('button', { class: 'btn primary small', onclick: () => blockForm(null) }, t('pl.addBlock'))));
    wrap.append(upcomingCard());
    if (st.wave.pattern.length || st.gates.length) wrap.append(cycleCard());
    const cal = h('div', { class: 'calwrap' }), train = DAYS.flatMap(d => SC.plannedFor(st, d).map(p => ({ kind: p.type.kind, minutes: p.minutes })));
    const total = train.length ? `${train.length} ${I.unit('pl.workoutsN', train.length)} · ${fmt1(sum(train, s => s.minutes) / 60)} h` : '';
    wrap.append(card('plan', t('pl.calendar'), total ? h('small', { class: 'count' }, total) : null, h('div', null, cal, train.length ? kindLegend(train) : null), { summary: () => total }));
    drawCalendar(cal);
    return wrap;
  }
  /* what is coming up: the next events, big ones starred */
  function upcomingCard() {
    const list = S.events.filter(e => (e.end || e.date) >= today()).slice(0, 12), add = () => eventSheet(null);
    return card('events', t('ev.upcoming'), h('button', { class: 'btn ghost small', onclick: add }, t('ev.add')),
      list.length ? eventRows(list) : emptyAdd(t('ev.none'), t('ev.add'), add), { icon: 'events', summary: () => list.length ? `${list[0].title} · ${countdownText(list[0].date)}` : '' });
  }
  /* training cycle weeks and each progression's stage; a tap changes the stage */
  function cycleCard() {
    const st = S.settings, wave = SC.waveWeek(st.wave, today()), body = h('div');
    if (st.wave.pattern.length) body.append(h('div', { class: 'wave' }, st.wave.pattern.map((ph, i) => h('div', { class: 'wave-cell ph-' + ph + (wave && wave.week === i + 1 ? ' on' : '') }, h('b', null, i + 1), h('span', null, t('pl.' + ph))))),
      h('p', { class: 'muted small' }, wave ? t('pl.cycle', { n: wave.cycle }) + ' · ' + waveLabel(wave) : t('pl.waveStarts', { d: st.wave.start ? fmtShort(st.wave.start) : '—' })));
    if (st.gates.length) body.append(h('div', { class: 'subhead' }, t('s.gates')), h('div', { class: 'gates' }, st.gates.map(g => h('button', { class: 'prog', onclick: () => stageSheet(g) },
      h('b', null, g.name), h('span', null, g.stages[g.current - 1] || String(g.current)), h('span', { class: 'steps' + (g.stages.length > 8 ? ' many' : '') }, g.stages.map((_, i) => h('i', { class: i < g.current ? 'on' : '' }))),
      h('small', null, t('pl.stageOf', { n: g.current, of: Math.max(1, g.stages.length) }))))));
    return card('cycle', st.wave.pattern.length ? t('pl.wave') : t('s.gates'), h('div', { class: 'head-r' }, st.wave.pattern.length ? editBtn(waveSheet) : null), body);
  }
  function stageSheet(g) {
    const exAt = i => S.settings.exercises.filter(e => e.gate && e.gate.id === g.id && e.gate.at === i + 1).map(e => e.name);
    openSheet(g.name, h('div', null, h('p', { class: 'muted small' }, t('pl.stageHelp')), h('div', { class: 'list' }, g.stages.map((name, i) => h('button', { class: 'row pick' + (g.current === i + 1 ? ' on' : ''), onclick: () => setStage(g, i + 1) },
      h('span', { class: 'row-name' }, h('div', null, `${i + 1}. ${name}`), exAt(i).length ? h('div', { class: 'muted small' }, t('pl.unlocks', { list: exAt(i).join(', ') })) : null),
      g.current === i + 1 ? h('span', { class: 'badge' }, t('s.current')) : null))),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: gatesSheet }, t('pl.editProgressions')))));
  }
  /* A new stage. Moving up is dated as an event (big for a progression no exercise waits on, like a belt); undo takes
     both back. */
  function setStage(g, n) {
    const s = latest(), x = s.gates.find(y => y.id === g.id); if (!x) return;
    const before = x.current; if (before === n) { closeSheet(); return; }
    x.current = n;
    const big = !s.exercises.some(e => e.gate && e.gate.id === g.id);
    const ev = n > before ? SC.normalizeEvent({ id: `stage-${g.id}-${today()}-${n}`, date: today(), title: `${g.name}: ${g.stages[n - 1] || n}`, big }) : null;
    saveSettingsNow(s);
    if (ev) { const { id, ...doc } = ev; store.setDoc('events/' + id, { ...doc, updatedAt: store.stamp() }); loadEvents(); }
    closeSheet(); render();
    undoToast(ev ? t('ev.stageLogged', { name: ev.title }) : t('c.saved'), () => { const b = latest(), y = b.gates.find(z => z.id === g.id); if (y) y.current = before; saveSettingsNow(b); if (ev) { store.deleteDoc('events/' + ev.id); loadEvents(); } render(); toast(t('c.undone')); });
  }
  /* each block runs from its start for its length; one that passes midnight continues at the top of the next day */
  const PASSIVE = ['sleep', 'work', 'rest'];
  function daySegments(st) {
    const segs = {}; DAYS.forEach(d => { segs[d] = []; });
    for (const b of st.calendar) {
      const a = SC.hm(b.start); if (a == null) continue;
      const z = a + (SC.duration(b) || 30);
      for (const day of b.days) {
        segs[day].push({ b, a, z: Math.min(z, 1440), cont: false });
        if (z > 1440) segs[DAYS[(DAYS.indexOf(day) + 1) % 7]].push({ b, a: 0, z: z - 1440, cont: true });
      }
    }
    return segs;
  }
  /* overlapping active blocks share the width; passive ones (sleep, work, rest) sit behind */
  function lanes(list, minMinutes) {
    const act = list.filter(s => !PASSIVE.includes(s.b.kind)).sort((x, y) => x.a - y.a || y.z - x.z);
    let group = [], end = -1;
    const close = () => { const n = Math.max(...group.map(s => s.lane)) + 1; group.forEach(s => { s.of = n; }); group = []; };
    for (const s of act) {
      const z = Math.max(s.z, s.a + minMinutes);
      if (group.length && s.a >= end) close();
      const used = new Set(group.filter(g => g.vz > s.a).map(g => g.lane));
      let lane = 0; while (used.has(lane)) lane++;
      s.lane = lane; s.vz = z; group.push(s); end = Math.max(end, z);
    }
    if (group.length) close();
    list.filter(s => PASSIVE.includes(s.b.kind)).forEach(s => { s.lane = 0; s.of = 1; s.bg = true; });
    return list;
  }
  const HOUR_PX = 52;
  function drawCalendar(cal) {
    const st = S.settings, wide = window.innerWidth >= 900;
    if (!st.calendar.length) { cal.replaceChildren(emptyAdd(t('pl.empty'), t('pl.addBlock'), () => blockForm(null))); return; }
    const segs = daySegments(st), own = Object.values(segs).flat().filter(s => !s.cont);
    if (wide) {
      const lo = Math.min(360, ...own.map(s => Math.floor(s.a / 60) * 60)), hi = Math.max(1320, ...own.map(s => Math.ceil(s.z / 60) * 60)), px = m => ((m - lo) / 60 * HOUR_PX);
      const hours = []; for (let m = lo; m < hi; m += 60) hours.push(m);
      const colH = px(hi) + 'px';
      /* untimed items sit in a row of the same height on every day, so every column's hours line up with the axis */
      const untimedOf = day => SC.blocksFor(st, day).filter(b => !b.start), rowsU = Math.max(0, ...DAYS.map(d => untimedOf(d).length));
      const uH = rowsU ? (rowsU * 27 + 3) + 'px' : null;
      const axis = h('div', { class: 'cal-axis' }, h('div', { class: 'cal-head' }), uH ? h('div', { style: { height: uH } }) : null, h('div', { class: 'cal-axis-in', style: { height: colH } }, hours.map(m => h('div', { class: 'cal-hour', style: { top: px(m) + 'px' } }, fmtTime(String(m / 60 % 24).padStart(2, '0') + ':00')))));
      cal.replaceChildren(h('div', { class: 'calgrid' }, axis, DAYS.map(day => {
        const untimed = untimedOf(day);
        const list = lanes(segs[day].filter(s => s.z > lo).map(s => ({ ...s, a: Math.max(s.a, lo) })), 20 / HOUR_PX * 60);
        return h('div', { class: 'cal-day' + (day === dow(today()) ? ' today' : '') }, h('div', { class: 'cal-head' }, dayName(day)),
          uH ? h('div', { class: 'cal-untimed', style: { height: uH } }, untimed.map(b => h('button', { class: 'cblock one', style: { '--kc': blockColor(b) }, onclick: () => blockSheet(b), title: SC.blockTitle(b, st) || t('pl.' + b.kind) }, h('b', null, SC.blockTitle(b, st) || t('pl.' + b.kind))))) : null,
          h('div', { class: 'cal-col', style: { height: colH } }, hours.map(m => h('div', { class: 'cal-line', style: { top: px(m) + 'px' } })), list.map(s => {
            const b = s.b, title = SC.blockTitle(b, st) || t('pl.' + b.kind), height = Math.max(18, px(s.z) - px(s.a) - 2);
            const when = s.cont ? t('pl.until', { t: fmtTime(b.end) }) : `${fmtTime(b.start)}${b.end ? '–' + fmtTime(b.end) : ''}`;
            return h('button', { class: 'cblock pos ' + KIND_CLASS[b.kind] + (s.bg ? ' bg' : '') + (height < 34 ? ' one' : height < 60 ? ' mid' : '') + (s.cont ? ' cont' : ''), onclick: () => blockSheet(b), title: `${title} · ${when}`,
              style: { top: (px(s.a) + 1) + 'px', height: height + 'px', left: `calc(${s.lane / s.of * 100}% + 2px)`, width: `calc(${100 / s.of}% - 4px)`, '--kc': blockColor(b) } },
              h('b', null, title), height < 34 ? null : h('span', null, when));
          })));
      })));
    } else {
      const seg = segmented(DAYS.map(d => ({ value: d, label: dayName(d, 'narrow') })), S.planDay, v => { S.planDay = v; drawCalendar(cal); });
      const bs = SC.blocksFor(st, S.planDay), train = SC.plannedFor(st, S.planDay), meals = bs.filter(b => b.kind === 'meal').length, sleep = bs.filter(b => b.kind === 'sleep').reduce((a, b) => a + (SC.duration(b) || 0), 0);
      const sumLine = [train.length ? `${train.length} ${I.unit('pl.workoutsN', train.length)} · ${fmtDur(sum(train, p => p.minutes))}` : null, meals ? `${meals} ${I.unit('pl.mealsN', meals)}` : null, sleep ? t('pl.sleepFor', { t: fmtDur(sleep) }) : null].filter(Boolean).join(' · ');
      cal.replaceChildren(...[seg, sumLine ? h('p', { class: 'muted small daysum' }, sumLine) : null].filter(Boolean), h('div', { class: 'timeline' }, bs.length ? bs.map(b => { const dur = SC.duration(b); return h('button', { class: 'tl-row', style: { '--kc': blockColor(b) }, onclick: () => blockSheet(b) },
        h('span', { class: 'tl-time' }, b.start ? fmtTime(b.start) : ''), h('span', { class: 'tl-dot' }), h('span', { class: 'tl-title' }, SC.blockTitle(b, st) || t('pl.' + b.kind), dur ? h('small', null, ' ' + fmtDur(dur)) : null)); })
        : h('p', { class: 'empty' }, t('pl.nothingThatDay'))));
    }
  }
  function blockSheet(b) {
    const st = S.settings, type = b.typeId ? st.sessionTypes.find(x => x.id === b.typeId) : null, routine = b.routineId ? st.routines.find(x => x.id === b.routineId) : null;
    const dur = SC.duration(b);
    const body = h('div', null,
      h('p', { class: 'muted small' }, [t('pl.' + b.kind), b.days.map(d => dayName(d)).join(', '), b.start ? `${fmtTime(b.start)}${b.end ? '–' + fmtTime(b.end) : ''}` : null, dur ? fmtDur(dur) : null].filter(Boolean).join(' · ')),
      b.note ? h('p', null, b.note) : null,
      type ? h('div', null, h('p', { class: 'muted small' }, `${kindName(type.kind)} · ${num(type.minutes)} ${t('c.min')} · ${fmt(type.kcal)} kcal`), type.plan.length ? h('button', { class: 'btn small', onclick: () => workoutSheet(type) }, t('pl.viewWorkout')) : null) : null,
      routine ? h('div', { class: 'list' }, routine.items.map(it => { const ex = exFor(it); return h('div', { class: 'row pick' }, ex ? thumb(ex.image, 'thumb sm') : null, h('span', { class: 'row-name' }, ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(ex) }, it.name) : it.name), it.target ? h('span', { class: 'row-target' }, it.target) : null); })) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => blockForm(b) }, t('c.edit')),
        h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.calendar = s.calendar.filter(x => x.id !== b.id); saveAnd(s, null, t('t.removed', { name: SC.blockTitle(b, st) || t('pl.' + b.kind) })); } }, t('c.delete'))));
    openSheet(SC.blockTitle(b, st) || t('pl.' + b.kind), body);
  }
  function blockForm(b) {
    const st = S.settings, d = b ? clone(b) : { id: uid(), days: [S.planDay], start: '', end: '', kind: 'session', title: '', note: '', typeId: st.sessionTypes[0] ? st.sessionTypes[0].id : '', routineId: st.routines[0] ? st.routines[0].id : '', slotId: st.mealSlots[0] ? st.mealSlots[0].id : '' };
    const linkBox = h('div');
    const drawLink = () => {
      linkBox.replaceChildren();
      if (d.kind === 'session') linkBox.append(st.sessionTypes.length ? selectField(t('t.session'), d, 'typeId', st.sessionTypes.map(x => ({ value: x.id, label: x.name }))) : h('p', { class: 'empty' }, t('pl.addWorkoutsFirst')));
      else if (d.kind === 'routine') linkBox.append(st.routines.length ? selectField(t('s.routines'), d, 'routineId', st.routines.map(x => ({ value: x.id, label: x.name }))) : h('p', { class: 'empty' }, t('t.noRoutines')));
      else if (d.kind === 'meal') linkBox.append(st.mealSlots.length ? selectField(t('t.slot'), d, 'slotId', st.mealSlots.map(x => ({ value: x.id, label: x.name }))) : h('p', { class: 'empty' }, t('t.noSlots')));
    };
    drawLink();
    const dayChips = h('div', { class: 'chips small-gap' }, DAYS.map(day => h('button', { class: 'chip small' + (d.days.includes(day) ? ' on' : ''), onclick: e => { const on = !d.days.includes(day); d.days = on ? [...d.days, day] : d.days.filter(x => x !== day); e.currentTarget.classList.toggle('on', on); } }, dayName(day))));
    openSheet(b ? t('pl.editBlock') : t('pl.addBlock'), h('div', null,
      selectField(t('pl.kind'), d, 'kind', SC.KINDS.map(k => ({ value: k, label: t('pl.' + k) })), drawLink), linkBox,
      textField(t('pl.title'), d, 'title', null, t('c.optional')),
      h('div', { class: 'field' }, h('span', null, t('s.days')), dayChips),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('pl.start')), h('input', { type: 'time', value: d.start, onchange: e => d.start = e.target.value })), h('label', { class: 'field' }, h('span', null, t('pl.end')), h('input', { type: 'time', value: d.end, onchange: e => d.end = e.target.value }))),
      textField(t('f.note'), d, 'note', null, t('c.optional')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        if (!d.days.length) { toast(t('pl.needDay')); return; }
        const s = latest(); const i = s.calendar.findIndex(x => x.id === d.id); if (i >= 0) s.calendar[i] = d; else s.calendar.push(d);
        saveAnd(s);
      } }, t('c.save')))));
  }
  function workoutSheet(type) {
    const body = h('div', null, h('p', { class: 'muted small' }, `${kindName(type.kind)} · ${num(type.minutes)} ${t('c.min')} · ${fmt(type.kcal)} kcal`), type.note ? h('p', null, type.note) : null,
      type.plan.map(b => h('div', { class: 'wblock' }, h('div', { class: 'subhead' }, b.label, b.log === false ? h('small', { class: 'muted' }, ' · ' + t('pl.notLogged')) : null, b.note ? h('small', { class: 'muted' }, ' ' + b.note) : null),
        h('div', { class: 'list' }, b.items.map(it => { const ex = exById(it.exerciseId) || SC.resolveExercise(it.name, S.settings.exercises); const locked = ex && ex.gate && !SC.gateOpen(S.settings, ex.gate);
          const target = [it.sets ? `${it.sets} ×` : '', it.reps, it.perSide ? t('t.perSide') : '', it.rir ? `${it.rir} RIR` : '', it.rest].filter(Boolean).join(' · ');
          return h('div', { class: 'row pick' + (locked ? ' locked' : '') }, ex ? thumb(ex.image, 'thumb sm') : null, h('span', { class: 'row-name' }, ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(ex) }, it.name) : it.name, h('div', { class: 'muted small' }, target, locked ? ' · ' + t('t.locked', { gate: gateLabel(ex.gate) }) : '', it.note ? ' · ' + it.note : ''))); })))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => workoutForm(type) }, t('c.edit'))));
    openSheet(type.name, body, { wide: true });
  }
  function workoutPick() {
    const st = S.settings;
    openSheet(t('pl.editWorkout'), h('div', { class: 'list' }, st.sessionTypes.map(x => h('button', { class: 'row pick', onclick: () => workoutForm(x) }, h('span', { class: 'row-name' }, x.name), h('span', { class: 'muted small' }, x.plan.length ? blocksText(x.plan.length, x.plan.reduce((a, b) => a + b.items.length, 0)) : t('pl.noPlan'))))));
  }
  /* blocks and their exercises, each draggable into order; edits the given plan array in place */
  function planEditor(plan) {
    const st = S.settings, box = h('div'), blocks = h('div', { class: 'routines' });
    const exOptions = () => [{ value: '', label: '—' }, ...st.exercises.slice().sort(byName).map(e => ({ value: e.id, label: e.name }))];
    sortable(blocks, (from, to) => { moveItem(plan, from, to); draw(); });
    const itemRow = (b, it, ii) => h('div', { class: 'editor-row wrap', 'data-sort': '' }, dragHandle(),
      h('select', { 'aria-label': t('t.exercise'), onchange: e => { it.exerciseId = e.target.value; const ex = exById(it.exerciseId); if (ex) { it.name = ex.name; it.perSide = ex.perSide; } draw(); } }, exOptions().map(o => h('option', { value: o.value, selected: o.value === it.exerciseId }, o.label))),
      it.exerciseId ? null : h('input', { type: 'text', placeholder: t('c.name'), value: it.name, oninput: e => it.name = e.target.value }),
      h('input', { type: 'number', class: 'xs', placeholder: t('t.sets'), inputmode: 'numeric', value: it.sets || '', oninput: e => it.sets = num(e.target.value) }),
      h('input', { type: 'text', class: 'xs', placeholder: t('t.reps'), value: it.reps, oninput: e => it.reps = e.target.value }),
      h('input', { type: 'text', class: 'xs', placeholder: 'RIR', value: it.rir, oninput: e => it.rir = e.target.value }),
      h('input', { type: 'text', class: 'xs', placeholder: t('pl.rest'), value: it.rest, oninput: e => it.rest = e.target.value }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!it.perSide, onchange: e => it.perSide = e.target.checked }), t('t.perSide')),
      h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { b.items.splice(ii, 1); draw(); } }, '×'));
    const draw = () => blocks.replaceChildren(...plan.map((b, bi) => {
      const items = h('div', { class: 'editor' }, b.items.map((it, ii) => itemRow(b, it, ii)));
      sortable(items, (from, to) => { moveItem(b.items, from, to); draw(); });
      return h('div', { class: 'routine', 'data-sort': '' },
        h('div', { class: 'editor-row' }, dragHandle(), h('input', { type: 'text', placeholder: t('pl.blockLabel'), value: b.label, oninput: e => b.label = e.target.value }), h('input', { type: 'text', placeholder: t('f.note'), value: b.note || '', oninput: e => b.note = e.target.value }),
          h('label', { class: 'chk', title: t('pl.logSetsHelp') }, h('input', { type: 'checkbox', checked: b.log !== false, onchange: e => { b.log = e.target.checked; } }), t('pl.logSets')),
          h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { plan.splice(bi, 1); draw(); } }, '×')),
        items,
        h('button', { class: 'btn ghost small', onclick: () => { b.items.push({ id: uid(), exerciseId: '', name: '', sets: 3, reps: '8-12', perSide: false, rir: '', rest: '', note: '' }); draw(); } }, t('s.addExercise')));
    }));
    box.append(blocks, h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => { plan.push({ id: uid(), label: String.fromCharCode(65 + plan.length), note: '', items: [] }); draw(); } }, t('pl.addGroup'))));
    draw();
    return box;
  }

  /* ---------- Library: workouts, routines, exercises, foods ---------- */
  /* Library: everything you do and eat, one tab each. Rows are compact; a tap opens a sheet for that one item, saved at once. */
  const LIB = {
    workouts: { label: () => t('pl.workouts'), sub: () => t('l.woSub'), add: () => t('l.addWorkout'), onAdd: () => workoutForm(null), body: () => workoutsTab() },
    routines: { label: () => t('s.routines'), sub: () => t('s.routinesSub'), add: () => t('s.addRoutine'), onAdd: () => routineForm(null), body: () => routinesTab() },
    exercises: { label: () => t('l.exercises'), sub: () => t('l.exSub'), add: () => t('l.addExercise'), onAdd: () => exerciseForm(null), body: () => exerciseList() },
    foods: { label: () => t('nav.foods'), sub: () => t('f.sub'), add: () => t('f.addFood'), onAdd: () => foodForm(null), body: () => { const b = h('div'), tpl = templatesBlock(); if (tpl) b.append(tpl); b.append(foodsBlock()); return b; } }
  };
  function viewLibrary() {
    if (!LIB[S.libTab]) S.libTab = 'workouts';
    const tab = LIB[S.libTab], wrap = h('div', { class: 'page' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('nav.library')), h('div', { class: 'sub' }, tab.sub())),
      h('button', { class: 'btn primary', onclick: tab.onAdd }, tab.add())));
    wrap.append(h('div', { class: 'tools row2' }, segmented(Object.keys(LIB).map(k => ({ value: k, label: LIB[k].label() })), S.libTab, v => { S.libTab = v; render(); })));
    wrap.append(tab.body());
    return wrap;
  }
  const pickRow = (name, sub, onclick) => h('button', { class: 'row pick', onclick }, h('span', { class: 'row-name' }, h('div', null, name), sub ? h('div', { class: 'muted small' }, sub) : null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  const blocksText = (b, e) => t('pl.blocksN', { n: b }) + ' · ' + t('pl.exercisesN', { n: e });
  const planCount = x => { const e = x.plan.reduce((a, b) => a + b.items.length, 0); return e ? blocksText(x.plan.length, e) : null; };
  /* a list you can drag into order; each row opens its item. key: the settings list; the new order saves at once */
  function sortedList(key, items, sub, open) {
    const list = h('div', { class: 'list sortlist' }, items.map(x => h('div', { class: 'row pick sortrow', 'data-sort': '' }, dragHandle(),
      h('button', { class: 'row-name linkish plain', onclick: () => open(x) }, h('div', null, x.name), sub(x) ? h('div', { class: 'muted small' }, sub(x)) : null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
    return sortable(list, (from, to) => { const s = latest(); moveItem(s[key], from, to); saveSettingsNow(s); });
  }
  function workoutsTab() {
    const st = S.settings, box = h('div');
    box.append(section(null, null, st.sessionTypes.length
      ? sortedList('sessionTypes', st.sessionTypes, x => [kindName(x.kind), x.minutes ? `${num(x.minutes)} ${t('c.min')}` : null, planCount(x)].filter(Boolean).join(' · '), workoutForm)
      : h('p', { class: 'empty' }, t('l.noWorkouts'))));
    /* what every workout hangs on: categories (with their colors and fields), the training cycle, progressions */
    box.append(section(null, null, h('div', { class: 'list setup' },
      pickRow(t('s.kinds'), st.sessionKinds.length ? st.sessionKinds.map(k => h('span', { class: 'kin', style: { '--kc': kindColor(k.id) } }, h('i', { class: 'kdot' }), k.name)) : t('l.none'), kindsSheet),
      pickRow(t('pl.wave'), st.wave.pattern.length ? st.wave.pattern.map(p => t('pl.' + p)).join(' · ') : t('l.none'), waveSheet),
      pickRow(t('s.gates'), st.gates.length ? st.gates.map(g => g.name).join(', ') : t('l.none'), gatesSheet))));
    return box;
  }
  /* save a setup change, then offer to undo it: the fields it changed go back to how they were */
  function saveAnd(next, then, msg) {
    const prev = latest();
    saveSettingsNow(next); closeSheet(); render();
    const keys = Object.keys(S.settings).filter(k => k !== 'updatedAt' && JSON.stringify(prev[k]) !== JSON.stringify(S.settings[k]));
    if (keys.length) undoToast(msg || t('c.saved'), () => { const s = latest(); keys.forEach(k => { s[k] = prev[k]; }); saveSettingsNow(s); closeSheet(); render(); toast(t('c.undone')); });
    else toast(msg || t('c.saved'));
    if (then) then();
  }
  /* one workout: its details and its exercise plan */
  function workoutForm(type) {
    const st = S.settings, d = type ? clone(type) : { id: '', name: '', kind: st.sessionKinds[0] ? st.sessionKinds[0].id : '', minutes: 60, kcal: 0, note: '', plan: [] };
    const kinds = st.sessionKinds.length ? st.sessionKinds.map(k => ({ value: k.id, label: k.name })) : [{ value: '', label: '—' }];
    openSheet(type ? type.name : t('l.newWorkout'), h('div', null,
      textField(t('c.name'), d, 'name'),
      h('div', { class: 'grid3' }, selectField(t('s.kind'), d, 'kind', kinds), numField(t('t.minutes'), d, 'minutes'), numField(t('c.kcal'), d, 'kcal')),
      textField(t('f.note'), d, 'note', null, t('c.optional')),
      h('div', { class: 'subhead' }, t('l.exercises')), planEditor(d.plan),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          const s = latest(), out = { ...d, minutes: num(d.minutes), kcal: num(d.kcal) }, i = type ? s.sessionTypes.findIndex(x => x.id === type.id) : -1;
          if (!out.id) out.id = U.slug(out.name);
          if (i >= 0) s.sessionTypes[i] = out; else s.sessionTypes.push(out);
          saveAnd(s);
        } }, t('c.save')),
        type ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.sessionTypes = s.sessionTypes.filter(x => x.id !== type.id); saveAnd(s, null, t('t.removed', { name: type.name })); } }, t('c.delete')) : null)), { wide: true });
  }
  /* categories: order, color (a kind with no color picked takes the next free one) and the fields a session of it logs */
  function kindsSheet() {
    const kinds = clone(S.settings.sessionKinds), box = h('div'), rows = h('div', { class: 'editor' });
    sortable(rows, (from, to) => { moveItem(kinds, from, to); draw(); });
    const fieldTypes = () => SC.FIELD_TYPES.map(x => ({ value: x, label: t('fd.type.' + x) }));
    const draw = () => {
      const auto = SC.kindColors(kinds.map((k, i) => ({ ...k, id: k.id || 'new' + i })));
      rows.replaceChildren(...kinds.map((k, i) => { k.fields = k.fields || []; return h('div', { class: 'kind-row', 'data-sort': '' },
        h('div', { class: 'editor-row' }, dragHandle(), h('input', { type: 'text', value: k.name || '', placeholder: t('s.kind'), 'aria-label': t('s.kind'), oninput: e => { k.name = e.target.value; } }),
          h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { kinds.splice(i, 1); draw(); } }, '×')),
        h('div', { class: 'swatches' }, SC.KIND_COLORS.map(c => h('button', { class: 'sw' + (k.color === c ? ' on' : !k.color && auto[k.id || 'new' + i] === c ? ' auto' : ''), type: 'button', style: { '--kc': `var(--kc-${c})` }, 'aria-label': t('col.' + c), 'aria-pressed': k.color === c ? 'true' : 'false', onclick: () => { k.color = k.color === c ? '' : c; draw(); } }))),
        h('details', { class: 'inline', open: k.fields.length ? true : null }, h('summary', null, t('fd.title'), h('small', { class: 'muted' }, ' ' + t('fd.sub'))),
          listEditor(k.fields, [{ key: 'name', label: t('c.name') }, { key: 'type', label: t('tk.typeLabel'), type: 'select', small: true, options: fieldTypes }, { key: 'unit', label: t('tk.unit'), small: true }], () => {}, t('fd.add'), null, { sortable: true }))); }));
    };
    box.append(rows, h('div', null, h('button', { class: 'btn small', onclick: () => { kinds.push({ name: '', color: '', fields: [] }); draw(); const ins = rows.querySelectorAll('.kind-row .editor-row input'); if (ins.length) ins[ins.length - 1].focus(); } }, t('s.addKind'))));
    draw();
    openSheet(t('s.kinds'), h('div', null, h('p', { class: 'muted small' }, t('s.kindsHelp')), box,
      saveRow(() => { const s = latest(); s.sessionKinds = kinds.filter(k => String(k.name || '').trim()).map(k => ({ ...k, fields: (k.fields || []).filter(f => String(f.name || '').trim()) })); saveAnd(s); })), { wide: true });
  }
  /* the training cycle: weeks that repeat from a start date; tap a week to change it */
  function waveSheet() {
    const w = { start: S.settings.wave.start || today(), pattern: [...S.settings.wave.pattern] }, weeks = h('div', { class: 'chips' });
    const draw = () => weeks.replaceChildren(...w.pattern.map((p, i) => h('button', { class: 'chip small wk ph-' + p, type: 'button', onclick: () => { w.pattern[i] = SC.WAVE[(SC.WAVE.indexOf(p) + 1) % SC.WAVE.length]; draw(); } }, h('b', null, i + 1), ' ' + t('pl.' + p))),
      h('button', { class: 'chip small', type: 'button', onclick: () => { w.pattern.push(w.pattern[w.pattern.length - 1] || 'ramp'); draw(); } }, '+ ' + t('pl.addWeek')),
      w.pattern.length ? h('button', { class: 'chip small', type: 'button', 'aria-label': t('pl.removeWeek'), onclick: () => { w.pattern.pop(); draw(); } }, '−') : null);
    draw();
    openSheet(t('pl.wave'), h('div', null, h('p', { class: 'muted small' }, t('s.waveSub')),
      h('label', { class: 'field' }, h('span', null, t('s.waveStart')), h('input', { type: 'date', value: w.start, onchange: e => { w.start = e.target.value; } })),
      h('div', { class: 'field' }, h('span', null, t('s.wavePattern')), weeks),
      saveRow(() => { const s = latest(); s.wave = { start: w.pattern.length ? (w.start || null) : null, pattern: w.pattern }; saveAnd(s); },
        S.settings.wave.pattern.length ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.wave = { start: null, pattern: [] }; saveAnd(s); } }, t('pl.noCycle')) : null)));
  }
  function gatesSheet() {
    const draft = { gates: clone(S.settings.gates) };
    openSheet(t('s.gates'), h('div', null, h('p', { class: 'muted small' }, t('s.gatesSub')), gatesEditor(draft, () => {}),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { const s = latest(); s.gates = draft.gates.filter(g => String(g.name || '').trim()); saveAnd(s); } }, t('c.save')))));
  }
  function routinesTab() {
    const st = S.settings;
    return section(null, null, st.routines.length
      ? sortedList('routines', st.routines, r => [r.days.length ? r.days.map(x => dayName(x)).join(', ') : t('l.everyDay'), `${r.items.length} ${I.unit('l.items', r.items.length)}`].join(' · '), routineForm)
      : h('p', { class: 'empty' }, t('l.noRoutines')));
  }
  /* one routine: name, days, checklist, check-in warning */
  function routineForm(r) {
    const d = r ? clone(r) : { id: '', name: '', items: [], days: [], alertAt: null, alertText: '' };
    const dayChips = h('div', { class: 'chips small-gap' }, DAYS.map(day => h('button', { class: 'chip small' + (d.days.includes(day) ? ' on' : ''), onclick: e => { const on = !d.days.includes(day); d.days = on ? [...d.days, day] : d.days.filter(x => x !== day); e.currentTarget.classList.toggle('on', on); } }, dayName(day))));
    openSheet(r ? r.name : t('l.newRoutine'), h('div', null,
      textField(t('s.routineName'), d, 'name'),
      h('div', { class: 'field' }, h('span', null, t('s.days')), dayChips, h('small', { class: 'muted' }, t('l.everyDayHint'))),
      h('div', { class: 'subhead' }, t('l.checklist')),
      listEditor(d.items, [{ key: 'name', label: t('s.exercise') }, { key: 'target', label: t('s.setsReps'), small: true }], () => {}, t('s.addExercise'), null, { sortable: true }),
      h('div', { class: 'grid2 mt' }, numField(t('s.alertAt'), d, 'alertAt', null, '1'), textField(t('s.alertText'), d, 'alertText', null, t('c.optional'))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          const s = latest(), i = r ? s.routines.findIndex(x => x.id === r.id) : -1;
          if (!d.id) d.id = U.slug(d.name);
          if (i >= 0) s.routines[i] = d; else s.routines.push(d);
          saveAnd(s);
        } }, t('c.save')),
        r ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.routines = s.routines.filter(x => x.id !== r.id); saveAnd(s, null, t('t.removed', { name: r.name })); } }, t('c.delete')) : null)), { wide: true });
  }
  /* meal templates, saved from Today; shown above the foods only when there are some */
  function templatesBlock() {
    const slotName = id => (S.settings.mealSlots.find(s => s.id === id) || {}).name || '';
    const tpls = S.templates.slice().sort(byName);
    if (!tpls.length) return null;
    return section(t('t.templates'), t('l.templatesSub'), h('div', { class: 'list' }, tpls.map(tp => pickRow(tp.name, [slotName(tp.slot), `${fmt(tp.kcal)} kcal · ${fmt(tp.p)}P ${fmt(tp.c)}C ${fmt(tp.f)}F`].filter(Boolean).join(' · '), () => templateForm(tp)))));
  }
  function templateForm(tp) {
    const d = clone(tp), slots = S.settings.mealSlots.map(s => ({ value: s.id, label: s.name }));
    openSheet(t('l.editTemplate'), h('div', null, textField(t('c.name'), d, 'name'),
      slots.length ? selectField(t('t.slot'), d, 'slot', slots) : null,
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')), nutFields(d),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          const doc = { name: String(d.name).trim(), slot: d.slot || '', kcal: num(d.kcal), p: num(d.p), c: num(d.c), f: num(d.f), updatedAt: store.stamp() }, n = scaleN(d.n, 1);
          Object.keys(n).forEach(k => { if (!n[k]) delete n[k]; }); if (Object.keys(n).length) doc.n = n;
          store.setDoc('templates/' + tp.id, doc);
          S.templates = store.list('templates'); closeSheet(); render(); toast(t('c.saved'));
        } }, t('c.save')),
        h('button', { class: 'btn ghost danger', onclick: () => { closeSheet(); deleteTemplate(tp); render(); } }, t('c.delete')))));
  }
  function exerciseList() {
    const box = h('div');
    const q = h('input', { type: 'search', placeholder: t('l.search'), value: S.exQ, oninput: e => { S.exQ = e.target.value; draw(); } });
    const list = h('div', { class: 'exlist' });
    const draw = () => {
      const s = S.exQ.trim().toLowerCase();
      const rows = S.settings.exercises.filter(e => !s || e.name.toLowerCase().includes(s) || (e.category || '').toLowerCase().includes(s) || (e.cues || '').toLowerCase().includes(s)).sort(byName);
      const cats = [...new Set(rows.map(e => e.category || ''))].sort((a, b) => a.localeCompare(b, I.locale()));
      list.replaceChildren(...(rows.length ? cats.map(c => h('div', { class: 'excat' }, c ? h('div', { class: 'subhead' }, c) : null, rows.filter(e => (e.category || '') === c).map(e => {
        const locked = e.gate && !SC.gateOpen(S.settings, e.gate);
        return h('button', { class: 'exrow' + (locked ? ' locked' : ''), onclick: () => exerciseCard(e) }, thumb(e.image, 'thumb') || h('span', { class: 'thumb ph' }, e.name.charAt(0)),
          h('span', { class: 'exrow-main' }, h('b', null, e.name), h('span', { class: 'muted small' }, [e.cues, e.perSide ? t('t.perSide') : null, locked ? t('t.locked', { gate: gateLabel(e.gate) }) : null].filter(Boolean).join(' · '))),
          e.video ? h('a', { class: 'btn ghost icon', href: e.video, target: '_blank', rel: 'noopener', 'aria-label': t('l.video'), onclick: ev => ev.stopPropagation(), html: ICONS.play }) : null);
      }))) : [h('p', { class: 'empty pad' }, S.settings.exercises.length ? t('t.noMatches') : t('l.empty'))]));
    };
    draw();
    box.append(h('div', { class: 'tools' }, q), list, h('p', { class: 'tablefoot' }, h('span', null, t('f.count', { n: S.settings.exercises.length, m: S.settings.exercises.length }))));
    return box;
  }
  function exerciseForm(ex) {
    const st = S.settings, d = ex ? clone(ex) : { id: '', name: '', category: '', image: '', video: '', cues: '', perSide: false, unit: 'reps', gate: null };
    const g = { id: d.gate ? d.gate.id : '', at: d.gate ? d.gate.at : 1 };
    const cats = [...new Set(st.exercises.map(x => x.category).filter(Boolean))].sort();
    openSheet(ex ? t('l.editExercise') : t('l.addExercise'), h('div', null,
      textField(t('c.name'), d, 'name'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('f.category')), h('input', { type: 'text', list: 'excats', value: d.category, oninput: e => d.category = e.target.value }), h('datalist', { id: 'excats' }, cats.map(c => h('option', { value: c })))),
        selectField(t('l.unit'), d, 'unit', SC.UNITS.map(u => ({ value: u, label: t('u.' + u) })))),
      textField(t('l.cues'), d, 'cues', null, t('c.optional')),
      textField(t('l.imageUrl'), d, 'image', null, t('l.imageHint')), textField(t('l.videoUrl'), d, 'video', null, t('c.optional')),
      h('div', { class: 'grid2' }, h('label', { class: 'chk field' }, h('input', { type: 'checkbox', checked: !!d.perSide, onchange: e => d.perSide = e.target.checked }), t('t.perSide')),
        st.gates.length ? h('div', { class: 'grid2' }, selectField(t('l.gate'), g, 'id', [{ value: '', label: '—' }, ...st.gates.map(x => ({ value: x.id, label: x.name }))]), numField(t('l.gateAt'), g, 'at', null, '1')) : null),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!d.name.trim()) { toast(t('t.needName')); return; }
          d.gate = g.id ? { id: g.id, at: num(g.at) || 1 } : null;
          const s = latest(); if (!d.id) d.id = U.slug(d.name); const i = s.exercises.findIndex(x => x.id === d.id);
          if (i >= 0) s.exercises[i] = d; else s.exercises.push(d);
          saveAnd(s);
        } }, t('c.save')),
        ex ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.exercises = s.exercises.filter(x => x.id !== ex.id); saveAnd(s, null, t('t.removed', { name: ex.name })); } }, t('c.delete')) : null)));
  }
  function foodsBlock() {
    const box = h('div');
    const q = h('input', { type: 'search', placeholder: t('f.search'), value: S.foodQ, oninput: e => { S.foodQ = e.target.value; drawTable(); } });
    box.append(h('div', { class: 'tools' }, q));
    const cats = [t('f.all'), ...[...new Set(S.foods.map(f => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, I.locale()))];
    if (!cats.includes(S.foodTab)) S.foodTab = t('f.all');
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, cats.map(c => h('button', { class: 'tab' + (c === S.foodTab ? ' on' : ''), role: 'tab', 'aria-selected': c === S.foodTab ? 'true' : 'false',
      onclick: e => { S.foodTab = c; tabs.querySelectorAll('.tab').forEach(x => { x.classList.toggle('on', x === e.currentTarget); x.setAttribute('aria-selected', x === e.currentTarget ? 'true' : 'false'); }); drawTable(); } }, c)));
    box.append(tabs);
    const tw = h('div', { class: 'tablewrap' }), foot = h('div', { class: 'tablefoot' });
    box.append(tw, foot);
    function drawTable() {
      const s = S.foodQ.trim().toLowerCase(), all = S.foodTab === t('f.all');
      const rows = S.foods.filter(f => (all || f.category === S.foodTab) && (!s || f.name.toLowerCase().includes(s) || (f.note || '').toLowerCase().includes(s)));
      const { key, dir } = S.foodSort, textKey = k => ['name', 'serving', 'category'].includes(k);
      rows.sort((a, b) => (textKey(key) ? String(a[key] || '').localeCompare(String(b[key] || ''), I.locale()) : num(val(a, key)) - num(val(b, key))) * dir);
      const cols = [['name', t('f.food')], ['serving', t('f.serving')], ['kcal', t('c.kcal'), 'n'], ['p', t('c.protein'), 'n'], ['c', t('c.carbs'), 'n'], ['f', t('c.fat'), 'n'], ...S.settings.nutrients.map(x => ['n.' + x.id, x.name, 'n'])];
      const val = (f, k) => k.startsWith('n.') ? num((f.n || {})[k.slice(2)]) : f[k];
      if (all) cols.splice(2, 0, ['category', t('f.category')]);
      const table = h('table', { class: 'foods' },
        h('thead', null, h('tr', null, cols.map(([k, lab, n]) => h('th', { class: (n ? 'n' : '') + (key === k ? ' on' : ''), onclick: () => { S.foodSort = key === k ? { key: k, dir: -dir } : { key: k, dir: textKey(k) ? 1 : -1 }; drawTable(); } }, lab + (key === k ? (dir === 1 ? ' ↑' : ' ↓') : ''))))),
        h('tbody', null, rows.map(f => h('tr', { onclick: () => foodActions(f) }, cols.map(([k, lab, n]) => h('td', { class: k === 'name' ? 'food' : k === 'serving' ? 'serving' : (n ? 'n' : '') }, textKey(k) ? (f[k] || '') : fmt1(val(f, k))))))));
      tw.replaceChildren(rows.length ? table : h('p', { class: 'empty pad' }, S.foods.length ? t('f.noMatch') : t('f.empty')));
      foot.replaceChildren(h('span', null, t('f.count', { n: rows.length, m: S.foods.length })), h('button', { class: 'btn small', onclick: exportFoodsCSV }, t('f.csv')));
    }
    drawTable();
    return box;
  }
  function foodActions(f) {
    const slots = S.settings.mealSlots, pick = { slot: slots[0] ? slots[0].id : '', qty: 1 };
    const chips = h('div', { class: 'chips' }, slots.map(w => { const b = h('button', { class: 'chip small' + (w.id === pick.slot ? ' on' : ''), onclick: () => { pick.slot = w.id; chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); } }, w.name); return b; }));
    openSheet(f.name, h('div', null,
      h('p', { class: 'muted small' }, `${f.serving || ''}${f.serving ? ' · ' : ''}${fmt(f.kcal)} kcal · ${fmt(f.p)}P ${fmt(f.c)}C ${fmt(f.f)}F` + (nutLine(f.n) ? ' · ' + nutLine(f.n) : '') + (f.note ? ` · ${f.note}` : '')),
      h('div', { class: 'subhead' }, t('f.logTo', { date: S.date === today() ? t('c.today').toLowerCase() : fmtShort(S.date) })), chips,
      h('div', { class: 'grid2 mt' }, numField(t('t.servings'), pick, 'qty', null, '0.5')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const k = num(pick.qty) || 1; if (!pick.slot) { toast(t('t.noSlots')); return; } addMeal(pick.slot, { name: k === 1 ? f.name : `${f.name} ×${k}`, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k, n: scaleN(f.n, k) }); } }, t('f.logIt')),
        h('button', { class: 'btn', onclick: () => foodForm(f) }, t('c.edit')))));
  }
  function foodForm(f) {
    const cats = [...new Set(S.foods.map(x => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, I.locale()));
    const d = f ? clone(f) : { name: '', category: S.foodTab !== t('f.all') ? S.foodTab : (cats[0] || ''), serving: '', kcal: null, p: null, c: null, f: null, note: '', n: {} };
    d.n = d.n || {};
    const catIn = h('input', { type: 'text', list: 'cats', value: d.category || '', oninput: e => d.category = e.target.value });
    const dl = h('datalist', { id: 'cats' }, cats.map(c => h('option', { value: c })));
    openSheet(f ? t('f.editFood') : t('f.addFood'), h('div', null,
      textField(t('c.name'), d, 'name'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('f.category')), catIn, dl), textField(t('f.serving'), d, 'serving', null, t('f.servingPh'))),
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')), nutFields(d),
      textField(t('f.note'), d, 'note', null, t('c.optional')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!d.name.trim()) { toast(t('t.needName')); return; }
          const n = scaleN(d.n, 1); Object.keys(n).forEach(k => { if (!n[k]) delete n[k]; });
          const row = SC.normalizeFood({ ...d, n, id: f ? f.id : undefined }); const { id, ...rest } = row;
          store.setDoc('foods/' + id, { ...rest, updatedAt: store.stamp() }); S.foods = store.list('foods').sort(byName);
          closeSheet(); render(); toast(f ? t('f.updated', { name: d.name }) : t('f.added', { name: d.name }));
        } }, t('c.save')),
        f ? h('button', { class: 'btn ghost danger', onclick: () => {
          const { id, ...doc } = store.get('foods/' + f.id) || f;
          store.deleteDoc('foods/' + f.id); S.foods = store.list('foods').sort(byName); closeSheet(); render();
          undoToast(t('f.deleted', { name: f.name }), () => { store.setDoc('foods/' + f.id, { ...doc, updatedAt: store.stamp() }); S.foods = store.list('foods').sort(byName); render(); });
        } }, t('c.delete')) : null)));
  }

  /* ---------- Progress: a week, a month, a year, or the data ---------- */
  /* Each view answers its own question. Week: did the days go to plan? Month: which way are things moving, and what
     slips? Year: how far have I come? Data: every number as a table. Every day is judged by the setup it had (setupOn).
     Days with a skip tag stay out of averages and rates. Cards the profile does not use (or hid) stay out of the way. */
  const PCARDS = SC.PROGRESS_CARDS;
  const shown = key => !S.settings.progress.hide.includes(key);
  const pad2 = n => String(n).padStart(2, '0');
  const firstOfMonth = (d, n) => { const [y, m] = d.split('-').map(Number), x = new Date(y, m - 1 + (n || 0), 1); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-01`; };
  const monthLabel = (d, style) => U.parseD(d).toLocaleDateString(I.locale(), style ? { month: style } : { month: 'long', year: 'numeric' });
  function periodOf(tab, anchor) {
    if (tab === 'week') { const a = weekStart(anchor); return { start: a, end: addDays(a, 6) }; }
    if (tab === 'month' || tab === 'data') { const a = firstOfMonth(anchor); return { start: a, end: addDays(firstOfMonth(a, 1), -1) }; }
    return { start: anchor.slice(0, 4) + '-01-01', end: anchor.slice(0, 4) + '-12-31' };
  }
  const shiftPeriod = (tab, anchor, n) => tab === 'week' ? addDays(anchor, 7 * n) : tab === 'year' ? (+anchor.slice(0, 4) + n) + '-01-01' : firstOfMonth(anchor, n);
  const datesIn = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  const sum = (arr, f) => arr.reduce((acc, x) => acc + f(x), 0);
  const avgOf = arr => arr.length ? sum(arr, x => x) / arr.length : null;
  const hasLog = d => !!(d && (d.meals.length || d.sessions.length || Object.keys(d.values).length || d.weight != null || d.tags.length || d.note || Object.values(d.checks).some(c => Object.keys(c).length)));
  /* a tag that says "leave this day out" (sick, travel) */
  const skipDay = (d, date) => { date = date || (d && d.date); return !!date && tagIdsOn(date, d).some(id => { const tg = S.settings.tags.find(x => x.id === id); return tg && tg.skip; }); };
  const dayStatus = (key, d) => { if (!d || !d.meals.length) return null; const st = setupOn(d.date), x = totals(d); return SC.targetStatus(key === 'kcal' ? x.kcal : x.p, st.targets[key], st.targets.aim[key], d.date < today()); };
  const appliesOn = (r, date) => !r.days.length || r.days.includes(dow(date));
  const pct = r => r == null ? '–' : Math.round(r * 100) + '%';
  const load = s => s.effort ? num(s.effort) * num(s.minutes) : 0;

  /* Consistency rows: trackers expected daily, on some days or some times a week, and checklists. cell(date, day) is
     null when nothing was expected, 'future', 'nodata' (nothing logged that day) or a grade ('progress' for today). */
  function consistencyRows() {
    const st = S.settings;
    const trackers = st.trackers.filter(x => x.freq !== 'any' || S.history.some(hs => (hs.trackers.find(y => y.id === x.id) || {}).freq && (hs.trackers.find(y => y.id === x.id) || {}).freq !== 'any')).map(x => ({
      id: x.id, name: x.name, archived: x.archived, kind: 'tracker', tracker: x,
      def: date => { const jt = setupOn(date).trackers.find(y => y.id === x.id); return jt && jt.freq !== 'any' && !jt.archived ? jt : null; },
      cell(date, day) {
        const jt = this.def(date); if (!jt) return null;
        if (jt.freq === 'weekly') return day && SC.trackerDone({ ...jt, freq: 'daily' }, SC.trackerValue(jt, day)) ? 'met' : null;
        if (!SC.expectedOn(jt, date)) return null;
        if (date > today()) return 'future';
        if (!day || !hasLog(day) || skipDay(day)) return 'nodata';
        return SC.trackerGrade(jt, SC.trackerValue(jt, day), date < today());
      } }));
    const routines = st.routines.filter(r => !r.alertAt && r.items.length).map(r => ({
      id: r.id, name: r.name, kind: 'routine',
      def: date => routinesFor(date, setupOn(date)).find(y => y.id === r.id && !y.alertAt && y.items.length) || null,
      cell(date, day) {
        const jr = this.def(date); if (!jr) return null;
        if (date > today()) return 'future';
        if (!day || !hasLog(day) || skipDay(day)) return 'nodata';
        const ratio = SC.routineRatio(jr, day); return ratio >= 1 ? 'met' : date < today() ? SC.gradeOf(ratio) : 'progress';
      } }));
    return [...trackers, ...routines];
  }
  const isWeekly = (row, dates) => row.kind === 'tracker' && dates.some(d => { const jt = row.def(d); return jt && jt.freq === 'weekly'; });
  /* how often a row was met over some dates: daily rows by day, weekly ones by week (a week counts once it is over or met) */
  function rowRate(row, dates, byDate) {
    if (isWeekly(row, dates)) {
      const weeks = [...new Set(dates.map(d => weekStart(d)))].filter(w => w <= today());
      const rs = weeks.map(w => {
        const days = datesIn(w, addDays(w, 6)), jt = days.map(d => row.def(d)).find(Boolean); if (!jt) return null;
        const n = days.filter(d => row.cell(d, byDate[d]) === 'met').length, r = Math.min(1, n / jt.perWeek);
        return addDays(w, 6) < today() || r >= 1 ? r : null;
      }).filter(r => r != null);
      return { rate: rs.length ? avgOf(rs) : null, n: rs.filter(r => r >= 1).length, of: rs.length, unit: 'weeks' };
    }
    const cells = dates.map(d => row.cell(d, byDate[d])).filter(c => c && !['future', 'nodata'].includes(c) && c !== 'progress');
    const met = cells.filter(c => c === 'met').length;
    return { rate: cells.length ? met / cells.length : null, n: met, of: cells.length, unit: 'days' };
  }
  /* share of expected things done on one day (trackers and checklists), or null */
  function dayAdherence(day, rows) {
    const cells = rows.filter(r => !isWeekly(r, [day.date])).map(r => r.cell(day.date, day)).filter(c => c && !['future', 'nodata', 'progress'].includes(c));
    return cells.length ? cells.filter(c => c === 'met').length / cells.length : null;
  }

  /* everything the cards need for one stretch of days (a..b, never past today) */
  function statsFor(byDate, a, b, since, rows) {
    const dates = b < a ? [] : datesIn(a, b), days = dates.map(d => byDate[d]).filter(Boolean), counted = days.filter(d => !skipDay(d));
    const fed = counted.filter(d => d.meals.length), logged = counted.filter(hasLog);
    const done = days.flatMap(d => d.sessions.filter(s => s.done !== false).map(s => ({ ...s, date: d.date })));
    let planned = 0, plannedDone = 0; const missed = [], plan = [];
    for (const date of dates.filter(d => d >= since)) {
      const day = byDate[date]; if (skipDay(day, date)) continue;
      for (const p of plannedOn(date)) {
        planned++;
        const ok = !!(day && day.sessions.some(s => s.typeId === p.type.id && s.done !== false));
        if (ok) plannedDone++; else if (date < today()) missed.push({ date, type: p.type });
        plan.push({ date, type: p.type, ok, block: p.block, minutes: p.minutes });
      }
    }
    const adh = logged.map(d => dayAdherence(d, rows)).filter(x => x != null);
    return { dates, days, fed, logged, done, planned, plannedDone, missed, plan,
      kcal: fed.length ? sum(fed, d => totals(d).kcal) / fed.length : null, p: fed.length ? sum(fed, d => totals(d).p) / fed.length : null,
      kcalMet: fed.filter(d => dayStatus('kcal', d) === 'met').length, pMet: fed.filter(d => dayStatus('protein', d) === 'met').length,
      minutes: sum(done, s => num(s.minutes)), load: sum(done, load),
      habPct: adh.length ? avgOf(adh) : null,
      weights: days.filter(d => d.weight != null).map(d => ({ date: d.date, v: num(d.weight) })) };
  }

  function viewProgress() {
    const st = S.settings, wrap = h('div', { class: 'page progress' }), u = unit();
    const goalText = st.goal.weight ? t('p.toward', { w: st.goal.weight, u }) + (st.goal.bodyFat ? ' ' + t('p.atBf', { bf: st.goal.bodyFat }) : '') : t('p.noGoal');
    wrap.append(h('div', { class: 'dayhead phead' }, h('div', { class: 'daytitle' }, h('h1', null, t('p.title')),
      h('div', { class: 'sub goal-line' }, goalText)),
      editBtn(goalSheet, st.goal.weight ? t('p.editGoal') : t('p.setGoalBtn'))));
    const tab = S.pTab, per = periodOf(tab, S.pDate), through = per.end < today() ? per.end : today(), isNow = per.start <= today() && today() <= per.end;
    const label = tab === 'week' ? (isNow ? t('w.thisWeek') : t('w.weekOf', { d: fmtShort(per.start) })) : tab === 'year' ? (isNow ? t('p.thisYear') : per.start.slice(0, 4)) : (isNow ? t('p.thisMonth') : monthLabel(per.start));
    const range = tab === 'week' ? `${fmtShort(per.start)} – ${fmtShort(per.end)}` : tab === 'year' ? (isNow ? per.start.slice(0, 4) : '') : (isNow ? monthLabel(per.start) : '');
    const go = n => { S.pDate = shiftPeriod(tab, per.start, n); render(); };
    wrap.append(h('div', { class: 'pbar' },
      segmented(PTABS.map(v => ({ value: v, label: t('p.tab.' + v) })), tab, v => { S.pTab = v; S.pDate = today(); try { localStorage.setItem(PTAB_KEY, v); } catch (e) {} render(); }),
      h('div', { class: 'pnav' },
        h('button', { class: 'btn ghost icon', 'aria-label': t('p.prev'), onclick: () => go(-1) }, '‹'),
        h('div', { class: 'pnav-label' }, h('b', null, label), range ? h('small', null, range) : null),
        h('button', { class: 'btn ghost icon', 'aria-label': t('p.next'), disabled: per.end >= today() ? true : null, onclick: () => go(1) }, '›'))));
    const byDate = {}; allDays().forEach(d => { if (hasLog(d)) byDate[d.date] = d; });
    const since = Object.keys(byDate).sort()[0] || today(), rows = consistencyRows();
    const prevPer = periodOf(tab, shiftPeriod(tab, per.start, -1)), span = U.diffDays(per.start, through);
    const cur = statsFor(byDate, per.start, through, since, rows), prev = statsFor(byDate, prevPer.start, [addDays(prevPer.start, span), prevPer.end].sort()[0], since, rows);
    const ctx = { tab, per, through, byDate, cur, prev, since, rows };
    if (per.start > today()) wrap.append(h('p', { class: 'empty pad' }, t('p.future')));
    else ({ week: weekView, month: monthView, year: yearView, data: dataView })[tab](wrap, ctx);
    if (tab !== 'data') wrap.append(h('div', { class: 'actions center' }, h('button', { class: 'btn ghost small', onclick: customizeSheet }, t('p.customize'))));
    return wrap;
  }

  /* shared pieces */
  const pcard = (key, title, right, body, opts) => card(key, title, right, body, { page: 'progress', ...(opts || {}) });
  function stat(big, lab, subs, status) {
    return h('div', { class: 'stat' + (status && status !== 'none' ? ' st-' + status : '') }, h('div', { class: 'big' }, big), h('div', { class: 'lab' }, lab), (subs || []).filter(Boolean).map(s => h('div', { class: 'sub' }, s)));
  }
  const signed = (n, f) => (n > 0 ? '+' : n < 0 ? '−' : '±') + (f || fmt)(Math.abs(n));
  function summaryRow(ctx) {
    const { cur, prev, tab } = ctx, vs = (a, b, f) => a != null && b != null ? t('p.vs.' + tab, { d: signed(a - b, f) }) : null;
    const on = (n, of) => of ? t('p.onTarget', { n, of }) : t('p.noMeals');
    return h('div', { class: 'stats' },
      stat(cur.kcal == null ? '–' : fmt(cur.kcal), t('w.avgKcal'), [on(cur.kcalMet, cur.fed.length), vs(cur.kcal, prev.kcal)], cur.fed.length ? SC.rateGrade(cur.kcalMet / cur.fed.length) : null),
      stat(cur.p == null ? '–' : fmt(cur.p) + ' g', t('w.avgProtein'), [on(cur.pMet, cur.fed.length), vs(cur.p, prev.p)], cur.fed.length ? SC.rateGrade(cur.pMet / cur.fed.length) : null),
      stat(cur.planned ? `${cur.plannedDone}/${cur.planned}` : String(cur.done.length), cur.planned ? t('p.plannedDone') : t('w.sessions'), [t('p.hoursTrained', { h: fmt1(cur.minutes / 60) }), cur.planned && cur.done.length > cur.plannedDone ? t('p.extra', { n: cur.done.length - cur.plannedDone }) : null], cur.plannedDone + cur.missed.length ? SC.rateGrade(cur.plannedDone / (cur.plannedDone + cur.missed.length)) : null),
      stat(pct(cur.habPct), t('p.adherenceAll'), [vs(cur.habPct == null ? null : cur.habPct * 100, prev.habPct == null ? null : prev.habPct * 100, n => Math.round(n) + '%')], cur.habPct == null ? null : SC.rateGrade(cur.habPct)));
  }
  /* the five colors, from missed to met */
  const legend = () => h('div', { class: 'legend' }, h('span', null, t('p.lg.miss')), h('span', { class: 'lg-bar', 'aria-hidden': 'true' }, SC.GRADES.map(g => h('i', { class: 'g-' + g }))), h('span', null, t('p.lg.met')));
  /* daily calories and protein, each bar colored by that day's grade */
  function nutritionCard(dates, byDate, labelOf) {
    const item = (key, d) => { const day = byDate[d], x = day && day.meals.length ? totals(day) : null, s = dayStatus(key, day); return { label: labelOf(d), value: x ? (key === 'kcal' ? x.kcal : x.p) : 0, color: gradeColor(s) || 'var(--accent2)' }; };
    const tg = setupOn(dates[dates.length - 1] > today() ? today() : dates[dates.length - 1]).targets, nut = S.settings.nutrients;
    const fedDays = dates.map(d => byDate[d]).filter(d => d && d.meals.length && !skipDay(d));
    return pcard('nutrition', t('p.nutrition'), null, h('div', null,
      h('div', { class: 'subhead' }, t('c.kcal')), svg(bars(dates.map(d => item('kcal', d)), { target: tg.kcal, height: 120, label: t('c.kcal') })),
      h('div', { class: 'subhead' }, t('c.protein')), svg(bars(dates.map(d => item('protein', d)), { target: tg.protein, height: 100, label: t('c.protein') })),
      nut.length && fedDays.length ? h('div', null, h('div', { class: 'subhead' }, t('nu.avg')), h('div', { class: 'stats' }, nut.map(n => { const v = avgOf(fedDays.map(d => totals(d).n[n.id] || 0)), s = SC.targetStatus(v, n.target, n.aim, true); return stat(`${fmt1(v)} ${n.unit}`, n.name, [n.target ? goalText({ ...n, type: 'number', unit: n.unit }) : null], s); }))) : null,
      legend()));
  }
  /* training time by category */
  const kindOf = s => S.settings.sessionKinds.some(k => k.id === s.kind) ? s.kind : '';
  function kindParts(sessions) {
    const kinds = [...S.settings.sessionKinds.map(k => k.id), ''];
    return kinds.map(id => ({ value: sum(sessions.filter(s => kindOf(s) === id), s => num(s.minutes)), color: id ? kindColor(id) : 'var(--track2)' }));
  }
  function kindLegend(sessions) {
    const kinds = [...S.settings.sessionKinds, { id: '', name: t('c.other') }];
    return h('div', { class: 'kinds' }, kinds.map(k => { const ss = sessions.filter(s => kindOf(s) === k.id); return ss.length ? h('span', { class: 'kchip', style: { '--kc': k.id ? kindColor(k.id) : 'var(--track2)' } }, h('i'), h('b', null, k.name), ` ${ss.length} · ${fmt1(sum(ss, s => num(s.minutes)) / 60)} h`) : null; }));
  }
  /* weekly load (effort × minutes) against the four weeks before; a jump over 50% is a warning */
  function loadLine(byDate, weekFrom) {
    const weekLoad = w => sum(datesIn(w, addDays(w, 6)).map(d => byDate[d]).filter(Boolean).flatMap(d => d.sessions.filter(s => s.done !== false)), load);
    const now = weekLoad(weekFrom), before = [1, 2, 3, 4].map(i => weekLoad(addDays(weekFrom, -7 * i))).filter(x => x > 0), base = avgOf(before);
    if (!now && !base) return null;
    const ratio = base ? now / base : null, warn = ratio != null && ratio > 1.5;
    return h('p', { class: 'small' + (warn ? ' st-low loadwarn' : ' muted') }, t('p.load', { n: fmt(now) }) + (base ? ' · ' + t('p.loadVs', { d: signed(Math.round((ratio - 1) * 100), n => n + '%') }) : '') + (warn ? ' · ' + t('p.loadJump') : ''));
  }
  /* exercises whose best estimated max (heaviest weight for timed sets; reps, seconds or meters without weight) went up in a..b */
  function recordsIn(a, b) {
    const out = [];
    for (const ex of S.settings.exercises) {
      const hist = exerciseHistory(ex); if (!hist.length) continue;
      const before = hist.filter(x => x.date < a), inside = hist.filter(x => x.date >= a && x.date <= b); if (!inside.length || !before.length) continue;
      const score = x => x.best || x.top || x.reps, prevBest = Math.max(...before.map(score)), top = inside.reduce((m, x) => score(x) > score(m) ? x : m, inside[0]);
      if (score(top) > prevBest) out.push({ ex, from: prevBest, to: score(top), date: top.date, weighted: !!(top.best || top.top) });
    }
    return out.sort((x, y) => (y.to / y.from) - (x.to / x.from));
  }
  const recordsList = recs => recs.length ? h('div', null, h('div', { class: 'subhead' }, t('p.records')), h('div', { class: 'list' }, recs.slice(0, 8).map(r => h('div', { class: 'row pick' },
    h('button', { class: 'row-name linkish plain', onclick: () => exerciseCard(r.ex) }, r.ex.name), h('span', { class: 'row-target' }, (r.weighted ? `${fmt1(r.from)} → ${fmt1(r.to)} ${unit()}` : `${fmt(r.from)} → ${fmt(r.to)} ${t('u.' + r.ex.unit)}`) + ' · ' + fmtShort(r.date)))))) : null;

  /* week: every planned session done, missed or still to come, plus what was extra */
  function trainingWeek(ctx) {
    const { per, byDate, cur } = ctx, dates = datesIn(per.start, per.end), rowsEl = [];
    for (const date of dates) {
      const day = byDate[date], sessions = day ? day.sessions.filter(s => s.done !== false) : [], plan = cur.plan.filter(p => p.date === date);
      const skipped = skipDay(day, date) && !sessions.length;
      const items = [...plan.map(p => ({ name: p.type.name, kind: p.type.kind, st: p.ok ? 'done' : date < today() ? 'missed' : 'todo', s: sessions.find(s => s.typeId === p.type.id) })),
        ...sessions.filter(s => !plan.some(p => p.type.id === s.typeId)).map(s => ({ name: s.name, kind: s.kind, st: 'extra', s }))];
      if (!items.length && !skipped) continue;
      rowsEl.push(h('div', { class: 'tw-day' }, h('span', { class: 'tw-date' }, h('b', null, dayName(dow(date))), h('small', null, fmtDay(date))),
        h('div', { class: 'tw-items' }, skipped && !items.length ? h('span', { class: 'muted small' }, t('p.skipped')) : items.map(it => h('span', { class: 'tw-item tw-' + it.st, style: { '--kc': kindColor(it.kind) } },
          h('i'), it.name, it.s ? h('small', null, ` ${num(it.s.minutes)} ${t('c.min')}` + (it.s.effort ? ` · ${t('t.effortN', { n: it.s.effort })}` : '')) : null,
          h('small', { class: 'tw-st' }, it.st === 'done' ? ' ✓' : it.st === 'missed' ? ' ✕ ' + t('t.missed') : it.st === 'extra' ? ' · ' + t('p.extraOne') : ' · ' + t('p.upcoming')))))));
    }
    const body = h('div', null,
      cur.planned ? h('p', { class: 'muted small' }, t('p.planLine', { n: cur.plannedDone, of: cur.planned, h: fmt1(cur.minutes / 60) })) : null,
      rowsEl.length ? h('div', { class: 'tw' }, rowsEl) : h('p', { class: 'empty' }, t('p.noTraining')),
      loadLine(byDate, per.start),
      cur.done.length ? svg(stacked(dates.map(d => ({ label: dayName(dow(d), 'narrow'), parts: kindParts(byDate[d] ? byDate[d].sessions.filter(s => s.done !== false) : []) })), { height: 110, label: t('p.training') })) : null,
      kindLegend(cur.done));
    return pcard('training', t('p.trainingTitle'), null, body);
  }
  /* month: a row per week with hours by category, share of the plan and load; records and the most missed session */
  function trainingMonth(ctx) {
    const { per, byDate, cur } = ctx, weeks = [...new Set(datesIn(per.start, per.end).map(d => weekStart(d)))].filter(w => w <= today());
    const maxMin = Math.max(1, ...weeks.map(w => sum(cur.done.filter(s => weekStart(s.date) === w), s => num(s.minutes))));
    const rowsEl = weeks.map(w => {
      const ss = cur.done.filter(s => weekStart(s.date) === w), pl = cur.plan.filter(p => weekStart(p.date) === w && p.date < today() || (weekStart(p.date) === w && p.ok)), min = sum(ss, s => num(s.minutes));
      const share = pl.length ? pl.filter(p => p.ok).length / pl.length : null;
      return h('div', { class: 'tm-row' }, h('span', { class: 'tm-wk' }, fmtShort(w < per.start ? per.start : w)),
        h('span', { class: 'tm-bar' }, kindParts(ss).filter(p => p.value).map(p => h('i', { style: { width: (p.value / maxMin * 100).toFixed(1) + '%', background: p.color } }))),
        h('span', { class: 'tm-h' }, fmt1(min / 60) + ' h'), h('b', { class: 'st-' + (share == null ? 'none' : SC.rateGrade(share)) }, share == null ? '–' : pct(share)), h('span', { class: 'tm-load muted' }, sum(ss, load) ? fmt(sum(ss, load)) : ''));
    });
    const misses = {}; cur.missed.forEach(m => { misses[m.type.name] = (misses[m.type.name] || 0) + 1; });
    const worst = Object.entries(misses).sort((a, b) => b[1] - a[1])[0];
    return pcard('training', t('p.trainingTitle'), null, h('div', null,
      cur.planned ? h('p', { class: 'muted small' }, t('p.planLine', { n: cur.plannedDone, of: cur.planned, h: fmt1(cur.minutes / 60) })) : null,
      cur.done.length || cur.planned ? h('div', { class: 'tm' }, h('div', { class: 'tm-row tm-head' }, h('span', null, t('p.weekCol')), h('span'), h('span', null, t('p.hoursCol')), h('span', null, t('p.planCol')), h('span', null, t('p.loadCol'))), rowsEl) : h('p', { class: 'empty' }, t('p.noTraining')),
      kindLegend(cur.done), worst ? h('p', { class: 'small muted missline' }, t('p.mostMissed', { name: worst[0], n: worst[1] })) : null,
      recordsList(recordsIn(per.start, ctx.through))));
  }
  /* year: hours by month and category, running totals, promotions and records */
  function trainingYear(ctx, months) {
    const { per, cur } = ctx, inMonth = (m, list) => list.filter(x => x.date.slice(0, 7) === m.slice(0, 7));
    return pcard('training', t('p.trainingTitle'), null, h('div', null,
      cur.planned ? h('p', { class: 'muted small' }, t('p.planLine', { n: cur.plannedDone, of: cur.planned, h: fmt1(cur.minutes / 60) })) : null,
      cur.done.length ? svg(stacked(months.map(m => ({ label: monthLabel(m, 'narrow'), parts: kindParts(inMonth(m, cur.done)) })), { height: 130, label: t('p.training') })) : h('p', { class: 'empty' }, t('p.noTraining')),
      cur.done.length ? h('div', null, h('div', { class: 'subhead' }, t('p.totals')), kindLegend(cur.done)) : null,
      recordsList(recordsIn(per.start, ctx.through))));
  }

  /* how often each tracker and checklist got done, as graded bars; a tap opens its detail */
  function rateRows(rows, dates, byDate) {
    const list = rows.map(r => ({ r, x: rowRate(r, dates, byDate) })).filter(o => o.x.of);
    return h('div', { class: 'rates' }, list.map(({ r, x }) => h('button', { class: 'rate st-' + (x.rate == null ? 'none' : SC.rateGrade(x.rate)), type: 'button', onclick: () => rowDetail(r) },
      h('span', { class: 'rate-name' }, r.name, h('small', null, ' ' + t(x.unit === 'weeks' ? 'p.weeksOf' : 'p.daysOf', { n: x.n, of: x.of }))), h('span', { class: 'rate-bar' }, h('i', { style: { width: x.rate == null ? '0' : Math.round(x.rate * 100) + '%' } })), h('b', null, pct(x.rate)))));
  }
  /* week: every tracker and checklist day by day, graded */
  function weekMatrix(dates, byDate, rows) {
    const shownRows = rows.filter(r => dates.some(d => r.def(d)));
    return h('div', { class: 'matrix' }, h('div', { class: 'mx-row mx-head' }, h('span'), dates.map(d => h('span', { class: d === today() ? 'cur' : '' }, dayName(dow(d), 'narrow'))), h('span')),
      shownRows.map(r => {
        const weekly = isWeekly(r, dates), jt = weekly ? dates.map(d => r.def(d)).find(Boolean) : null;
        const cells = dates.map(d => { const c = r.cell(d, byDate[d]); return h('span', { class: 'mx ' + (c == null ? (weekly ? 'wk' : 'na') : c === 'future' ? 'fut' : c === 'nodata' ? 'nodata' : c === 'progress' ? 'prog' : 'g-' + c), title: fmtShort(d) }); });
        const x = rowRate(r, dates, byDate), n = weekly ? dates.filter(d => r.cell(d, byDate[d]) === 'met').length : x.n;
        const total = weekly ? `${n}/${jt.perWeek}` : x.of ? `${x.n}/${x.of}` : '';
        const grade = weekly ? SC.rateGrade(Math.min(1, n / jt.perWeek)) : x.of ? SC.rateGrade(x.rate) : 'none';
        return h('button', { class: 'mx-row', type: 'button', onclick: () => rowDetail(r) }, h('span', { class: 'mx-name' }, r.name), cells, h('b', { class: 'st-' + grade }, total));
      }));
  }
  /* year: a row per tracker and checklist, a column per month, graded with the share done; the year at the end */
  function yearGrid(rows, months, byDate, through) {
    const from = months[0], shownRows = rows.map(r => {
      const cells = months.map(m => { const dates = datesIn(m, addDays(firstOfMonth(m, 1), -1)).filter(d => d <= through); return rowRate(r, dates, byDate); });
      return { r, cells, all: rowRate(r, datesIn(from, through), byDate) };
    }).filter(o => o.all.of);
    if (!shownRows.length) return null;
    return h('div', { class: 'ygrid-wrap' }, h('div', { class: 'ygrid', style: { '--cols': months.length } },
      h('span', { class: 'yg-name' }), months.map(m => h('span', { class: 'yg-head' }, monthLabel(m, 'narrow'))), h('span', { class: 'yg-head' }, t('p.yearCol')),
      shownRows.map(({ r, cells, all }) => [h('button', { class: 'yg-name linkish plain', type: 'button', onclick: () => rowDetail(r) }, r.name),
        cells.map((x, i) => h('span', { class: 'yg ' + (x.rate == null ? 'na' : 'g-' + SC.rateGrade(x.rate)), title: `${monthLabel(months[i])} · ${pct(x.rate)}` }, x.rate == null ? '' : Math.round(x.rate * 100))),
        h('b', { class: 'yg-all st-' + (all.rate == null ? 'none' : SC.rateGrade(all.rate)) }, pct(all.rate))])));
  }
  /* one tracker or checklist over the last year: a calendar, streaks, best and worst month, the weekday it slips */
  function rowDetail(r) {
    const byDate = {}; allDays().forEach(d => { byDate[d.date] = d; });
    const end = today(), start = addDays(end, -364), dates = datesIn(start, end);
    const map = {}; for (const d of dates) { const c = r.cell(d, byDate[d]); if (c && !['future', 'nodata', 'progress'].includes(c)) map[d] = c; else if (c === 'met') map[d] = c; }
    let best = 0, run = 0, curRun = 0;
    const weekly = isWeekly(r, dates);
    if (weekly) {
      const weeks = [...new Set(dates.map(d => weekStart(d)))];
      for (const w of weeks) { const x = rowRate(r, datesIn(w, addDays(w, 6)).filter(d => d <= end), byDate); if (x.rate == null) continue; if (x.rate >= 1) { run++; best = Math.max(best, run); } else if (addDays(w, 6) < end) run = 0; }
      curRun = run;
    } else {
      for (const d of dates) { const c = r.cell(d, byDate[d]); if (c == null || c === 'future') continue; if (c === 'met') { run++; best = Math.max(best, run); } else if (d !== end) run = 0; }
      curRun = run;
    }
    const months = [...new Set(dates.map(d => firstOfMonth(d)))].map(m => ({ m, x: rowRate(r, datesIn(m < start ? start : m, addDays(firstOfMonth(m, 1), -1)).filter(d => d <= end), byDate) })).filter(o => o.x.rate != null && o.x.of >= 3);
    const top = months.slice().sort((a, b) => b.x.rate - a.x.rate)[0], low = months.slice().sort((a, b) => a.x.rate - b.x.rate)[0];
    const miss = {}, tot = {};
    if (!weekly) for (const d of dates) { const c = r.cell(d, byDate[d]); if (!c || ['future', 'nodata', 'progress'].includes(c)) continue; const k = dow(d); tot[k] = (tot[k] || 0) + 1; if (c !== 'met') miss[k] = (miss[k] || 0) + 1; }
    const slip = Object.keys(miss).filter(k => miss[k] >= 2).sort((a, b) => miss[b] / tot[b] - miss[a] / tot[a])[0];
    const all = rowRate(r, dates, byDate), x = r.tracker;
    const vals = x && ['number', 'rating', 'duration', 'time', 'count', 'weight'].includes(x.type) ? dates.map(d => byDate[d]).filter(Boolean).map(d => ({ date: d.date, v: SC.trackerValue(x, d) })).filter(p => SC.hasValue(x, p.v)) : [];
    openSheet(r.name, h('div', null,
      h('div', { class: 'stats' }, stat(pct(all.rate), t('p.lastYear'), [t(all.unit === 'weeks' ? 'p.weeksOf' : 'p.daysOf', { n: all.n, of: all.of })], all.rate == null ? null : SC.rateGrade(all.rate)),
        stat(String(curRun), t(weekly ? 'p.streakWeeks' : 'p.streakNow')), stat(String(best), t(weekly ? 'p.bestWeeks' : 'p.streakBest'))),
      svg(heat(map, 53, end, null, bigMarks(start, end))), legend(),
      h('ul', { class: 'plain facts' },
        top ? h('li', null, t('p.bestMonth', { m: monthLabel(top.m), p: pct(top.x.rate) })) : null,
        low && low !== top ? h('li', null, t('p.worstMonth', { m: monthLabel(low.m), p: pct(low.x.rate) })) : null,
        slip ? h('li', null, t('p.slips', { day: dayName(slip, 'long'), n: miss[slip], of: tot[slip] })) : null),
      vals.length ? h('div', null, vals.length > 1 ? [h('div', { class: 'subhead' }, t('p.values')), valueChart(x, vals)] : null, h('p', { class: 'muted small' }, valueFacts(x, vals))) : null,
      x ? h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => trackerForm(x, x.group) }, t('c.edit'))) : null), { wide: true });
  }
  /* big events in a stretch, as {date: color}, to ring those days on a calendar */
  function bigMarks(a, b) { const out = {}; for (const e of S.events) if (e.big) for (let d = e.date; d <= (e.end || e.date) && d <= b; d = addDays(d, 1)) if (d >= a) out[d] = evColor(e); return out; }
  /* a tracker's values on logged days */
  const valuesOf = (x, days) => days.map(d => ({ date: d.date, v: SC.trackerValue(x, d) })).filter(p => SC.hasValue(x, p.v));
  /* points for a line; times of day are drawn around their target (or their middle) so midnight does not break it */
  function valuePoints(x, vals) {
    let pts = vals.map(p => ({ date: p.date, v: x.type === 'time' ? SC.hm(String(p.v)) : num(p.v) }));
    if (x.type === 'time') { const c = x.target ? SC.hm(x.target) : pts.map(p => p.v).sort((a, b) => a - b)[Math.floor(pts.length / 2)]; pts = pts.map(p => ({ ...p, v: c + (((p.v - c + 720 + 1440) % 1440) - 720) })); }
    return { pts, goal: x.target == null ? null : x.type === 'time' ? SC.hm(x.target) : num(x.target) };
  }
  function valueChart(x, vals) {
    const { pts, goal } = valuePoints(x, vals);
    const f = x.type === 'duration' ? v => fmtDur(Math.round(v)) : x.type === 'time' ? v => fmtTime(`${pad2(Math.floor(((Math.round(v) % 1440) + 1440) % 1440 / 60))}:${pad2(((Math.round(v) % 60) + 60) % 60)}`) : fmt1;
    return svg(trend(pts, { goal, goalLabel: goal == null ? '' : goalText(x), label: x.name, fmt: f }));
  }
  const avgText = (x, nums) => valueText(x, x.type === 'rating' ? Math.round(avgOf(nums) * 10) / 10 : avgOf(nums));
  /* latest, average and the change since the first */
  function valueFacts(x, vals) {
    const nums = vals.map(p => x.type === 'time' ? null : num(p.v)).filter(v => v != null), first = vals[0], last = vals[vals.length - 1];
    return [t('p.latestV', { v: valueText(x, last.v) }), nums.length > 1 ? t('p.avgV', { v: avgText(x, nums) }) : null,
      nums.length > 1 && x.type !== 'rating' ? t('p.changeV', { d: x.type === 'duration' ? signed(num(last.v) - num(first.v), v => fmtDur(Math.round(v))) : signed(Math.round((num(last.v) - num(first.v)) * 10) / 10, fmt1) + (x.unit ? ' ' + x.unit : '') }) : null].filter(Boolean).join(' · ');
  }
  /* a small line with many points (a year of days) draws weekly averages, so it shows the trend instead of the noise */
  const thin = pts => { if (pts.length <= 60) return pts; const wk = new Map(); for (const p of pts) { const w = weekStart(p.date); if (!wk.has(w)) wk.set(w, []); wk.get(w).push(p.v); } return [...wk].map(([date, vs]) => ({ date, v: sum(vs, v => v) / vs.length })); };
  /* numbers, ratings, durations and times: a small tile each (latest, average, a line); a tap opens the whole year */
  function trackersCard(dates, byDate) {
    const days = dates.map(d => byDate[d]).filter(Boolean);
    const tiles = S.settings.trackers.filter(x => ['number', 'rating', 'duration', 'time'].includes(x.type)).map(x => {
      const vals = valuesOf(x, days); if (!vals.length) return null;
      const nums = vals.map(p => x.type === 'time' ? null : num(p.v)).filter(v => v != null), { pts, goal } = valuePoints(x, vals);
      return h('button', { class: 'spk', type: 'button', onclick: () => trackerDetail(x) }, h('span', { class: 'spk-name' }, x.name), h('b', null, valueText(x, vals[vals.length - 1].v)),
        h('small', null, nums.length > 1 ? t('p.avgV', { v: avgText(x, nums) }) : fmtShort(vals[vals.length - 1].date)), pts.length > 1 ? h('span', { class: 'spk-line', html: U.spark(thin(pts), { goal, label: x.name }) }) : null);
    }).filter(Boolean);
    return tiles.length ? pcard('trackers', t('p.trackers'), null, h('div', { class: 'spks' }, tiles), { summary: () => String(tiles.length) }) : null;
  }
  /* a tracker in full: its consistency detail when it is expected, else its line over the last year */
  function trackerDetail(x) {
    const r = consistencyRows().find(y => y.id === x.id); if (r) { rowDetail(r); return; }
    const end = today(), vals = valuesOf(x, allDays().filter(d => d.date > addDays(end, -365) && d.date <= end));
    openSheet(x.name, h('div', null, vals.length > 1 ? valueChart(x, vals) : null, h('p', { class: 'muted small' }, vals.length ? valueFacts(x, vals) : t('p.noValues')),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => trackerForm(x, x.group) }, t('c.edit')))), { wide: true });
  }
  /* What workouts log beyond time: each category's number, rating and duration fields, and effort, session by session.
     Numbers in a unit that adds up (distance, time, energy, counts) show their total; heart rate, pace and the like their average. */
  const ADDS = /^(mi|miles?|km|m|meters?|metres?|yd|yards?|ft|feet|min|mins|h|hrs?|hours?|s|sec|secs|seconds?|kcal|cal|kj|laps?|rounds?|reps?|steps?|floors?|sets?|throws?|shots?|strikes?|takedowns?|subs?|submissions?)$/i;
  function fieldsCard(dates, byDate) {
    const sess = dates.map(d => byDate[d]).filter(Boolean).flatMap(d => d.sessions.filter(x => x.done !== false).map(x => ({ ...x, date: d.date }))), tiles = [];
    for (const k of S.settings.sessionKinds) {
      const ks = sess.filter(x => x.kind === k.id); if (!ks.length) continue;
      for (const def of [...k.fields.filter(fd => fd.type !== 'text').map(fd => ({ key: fd.id, name: fd.name, fd })), { key: '', name: t('p.effortShort'), fd: null }]) {
        const pts = ks.map(x => ({ date: x.date, v: def.fd ? x.fields && x.fields[def.key] : x.effort })).filter(p => p.v != null && p.v !== '' && Number.isFinite(+p.v)).map(p => ({ date: p.date, v: num(p.v) }));
        if (!pts.length) continue;
        const show = v => def.fd ? fieldText(def.fd, def.fd.type === 'rating' ? Math.round(v * 10) / 10 : Math.round(v * 10) / 10) : fmt1(v) + '/10';
        const total = def.fd && def.fd.type === 'number' && ADDS.test(String(def.fd.unit || '').trim()) ? sum(pts, p => p.v) : null;
        tiles.push(h('button', { class: 'spk', type: 'button', style: { '--kc': kindColor(k.id) }, onclick: () => fieldSheet(k, def, pts, show) },
          h('span', { class: 'spk-name' }, h('i', { class: 'kdot' }), `${k.name} · ${def.name}`), h('b', null, show(pts[pts.length - 1].v)),
          h('small', null, total != null ? t('p.totalV', { v: show(total) }) : t('p.avgV', { v: show(avgOf(pts.map(p => p.v))) })), pts.length > 1 ? h('span', { class: 'spk-line', html: U.spark(thin(pts), { label: def.name }) }) : null));
      }
    }
    return tiles.length ? pcard('fields', t('p.fieldsTitle'), null, h('div', { class: 'spks' }, tiles), { icon: 'training', summary: () => String(tiles.length) }) : null;
  }
  function fieldSheet(k, def, pts, show) {
    openSheet(`${k.name} · ${def.name}`, h('div', null, pts.length > 1 ? svg(trend(pts, { label: def.name, fmt: show })) : null,
      h('p', { class: 'muted small' }, [t('p.latestV', { v: show(pts[pts.length - 1].v) }), t('p.avgV', { v: show(avgOf(pts.map(p => p.v))) }), t('p.sessionsN', { n: pts.length })].join(' · '))), { wide: true });
  }
  /* days with each tag against the other days: calories, protein, training and how much got done */
  function tagsCard(days, rows) {
    const ids = new Map(days.map(d => [d.date, tagIdsOn(d.date, d)])), has = (d, id) => ids.get(d.date).includes(id);
    const used = S.settings.tags.filter(tg => days.some(d => has(d, tg.id)));
    if (!used.length) return null;
    const line = (label, ds, color) => {
      const fed = ds.filter(d => d.meals.length), adh = ds.map(d => dayAdherence(d, rows)).filter(x => x != null), mins = sum(ds.flatMap(d => d.sessions.filter(s => s.done !== false)), s => num(s.minutes));
      return h('div', { class: 'tg-row' }, h('span', { class: 'tg-name' }, color ? h('i', { style: { '--kc': color } }) : null, h('span', null, label, h('small', null, t('p.nDays', { n: ds.length })))),
        h('span', null, fed.length ? fmt(avgOf(fed.map(d => totals(d).kcal))) : '–'), h('span', null, fed.length ? fmt(avgOf(fed.map(d => totals(d).p))) + ' g' : '–'),
        h('span', null, ds.length ? fmt(mins / ds.length) + ' ' + t('c.min') : '–'), h('span', null, pct(adh.length ? avgOf(adh) : null)));
    };
    return pcard('tags', t('p.tagsTitle'), null, h('div', { class: 'tg' },
      h('div', { class: 'tg-row tg-head' }, h('span'), h('span', null, t('c.kcal')), h('span', null, t('c.protein')), h('span', null, t('p.trainPerDay')), h('span', null, t('p.doneCol'))),
      used.map(tg => line(tg.name, days.filter(d => has(d, tg.id)), tagColor(tg))),
      line(t('p.otherDays'), days.filter(d => !ids.get(d.date).length), null)));
  }
  /* least-squares slope of weight per day */
  function slope(points) {
    if (points.length < 3) return null;
    const x0 = U.parseD(points[0].date), xs = points.map(p => (U.parseD(p.date) - x0) / 86400000), n = points.length, mx = sum(xs, x => x) / n, my = sum(points, p => p.v) / n;
    const den = sum(xs, x => (x - mx) ** 2); if (!den) return null;
    return sum(points.map((p, i) => [xs[i], p.v]), ([x, v]) => (x - mx) * (v - my)) / den;
  }
  function weightCard(points, prevPoints, ctx, chartPoints) {
    const st = S.settings, u = unit(), g = num(st.goal.weight) || null, band = st.goal.band, box = h('div');
    if (!points.length) { box.append(h('p', { class: 'empty' }, t('p.logWeight'))); return pcard('weight', t('p.bodyweight'), null, box); }
    const avg = pts => pts.length ? sum(pts, p => p.v) / pts.length : null, last7 = points.slice(-7), a7 = avg(last7), first = points[0], latestP = points[points.length - 1];
    const cp = chartPoints || points;
    if (cp.length > 1) box.append(svg(trend(cp, { goal: g, goalLabel: g ? `${g} ${u}` : '', band, label: t('p.bodyweight') })));
    const facts = [t('p.latest', { w: fmt1(latestP.v), u })];
    if (points.length > 1) facts.push(t('p.change', { d: signed(Math.round((latestP.v - first.v) * 10) / 10, fmt1), u, date: fmtShort(first.date) }));
    const pa = avg(prevPoints); if (pa != null && ctx.tab !== 'year') facts.push(t('p.avgVs.' + ctx.tab, { d: signed(Math.round((avg(points) - pa) * 10) / 10, fmt1), u }));
    if (g) facts.push(t('p.toGoal', { d: fmt1(Math.abs(Math.round((g - a7) * 10) / 10)), u }));
    box.append(h('p', { class: 'muted small' }, facts.join(' · ')));
    const k = ctx.tab === 'week' ? null : slope(points);
    if (k != null) {
      const perWeek = Math.round(k * 7 * 10) / 10;
      let line = perWeek === 0 ? t('p.steady') : t('p.rate', { d: signed(perWeek, fmt1), u });
      const inBand = band && a7 >= band[0] && a7 <= band[1];
      if (g && !inBand && perWeek !== 0 && Math.abs(g - a7) >= 0.5) line += ' · ' + (Math.sign(g - a7) === Math.sign(perWeek) ? t('p.eta', { date: fmtShort(addDays(today(), Math.round((g - a7) / k))) }) : t('p.away'));
      box.append(h('p', { class: 'small' }, line));
    }
    if (band && a7 != null) { const state = a7 < band[0] ? 'below' : a7 > band[1] ? 'above' : 'inside'; box.append(h('div', { class: 'notice soft ' + (state === 'inside' ? 'good' : 'warn') }, h('span', null, t('p.band' + state.charAt(0).toUpperCase() + state.slice(1), { avg: fmt1(a7), u, lo: band[0], hi: band[1] })))); }
    return pcard('weight', t('p.bodyweight'), null, box);
  }
  /* The goal: now, the checkpoints on the way and the target, each with body fat, weight and the lean and fat mass
     they add up to. A checkpoint is ticked once body fat is at or under it. */
  function goalCard() {
    const st = S.settings, g = st.goal; if (g.weight == null && g.bodyFat == null && !g.milestones.length) return null;
    const u = unit(), days = allDays().reverse(), bfT = st.trackers.find(x => x.id === 'bodyFat' || x.id === 'body-fat');
    const bf = bfT ? days.map(d => SC.trackerValue(bfT, d)).find(v => v != null) : null, w = days.map(d => d.weight).find(v => v != null);
    const comp = (wt, pct) => wt != null && pct != null ? `${fmt1(wt * (1 - pct / 100))} / ${fmt1(wt * pct / 100)}` : '';
    const row = (label, date, pct, wt, cls) => h('tr', { class: cls || '' }, h('td', null, label), h('td', { class: 'muted small' }, date ? fmtShort(date) : ''),
      h('td', { class: 'n' }, pct != null ? fmt1(pct) + '%' : ''), h('td', { class: 'n' }, wt != null ? fmt1(wt) : ''), h('td', { class: 'n muted' }, comp(wt, pct)));
    return pcard('body', t('s.goal'), editBtn(goalSheet), h('div', null, h('table', { class: 'plain goaltable' },
      h('thead', null, h('tr', null, h('th'), h('th'), h('th', { class: 'n' }, '%'), h('th', { class: 'n' }, u), h('th', { class: 'n' }, t('p.leanFat', { u })))),
      h('tbody', null, (bf != null || w != null) ? row(t('p.now'), null, bf, w, 'now') : null,
        g.milestones.map(m => { const hit = bf != null && m.bodyFat != null && num(bf) <= m.bodyFat; return row((hit ? '✓ ' : '') + (m.label || '—'), m.date, m.bodyFat, m.weight, hit ? 'hit' : ''); }),
        g.weight != null || g.bodyFat != null ? row(t('s.goal'), null, g.bodyFat, g.weight, 'target') : null)),
      g.note ? h('p', { class: 'muted small goalnote' }, g.note) : null));
  }
  /* the events in a stretch; with many, the big ones first and the rest behind a tap */
  function eventsCard(a, b) {
    const all = S.events.filter(e => e.date <= b && (e.end || e.date) >= a); if (!all.length) return null;
    const big = all.filter(e => e.big), box = h('div');
    const draw = showAll => { const few = showAll || !big.length || all.length <= 8; box.replaceChildren(...[eventRows(few ? all : big), few ? null : h('button', { class: 'btn ghost small', onclick: () => draw(true) }, t('ev.showAll', { n: all.length }))].filter(Boolean)); };
    draw(false);
    return pcard('events', t('ev.title'), h('button', { class: 'btn ghost small', onclick: () => eventSheet(null) }, t('ev.add')), box, { icon: 'events', summary: () => t('ev.count', { n: all.length }) });
  }

  /* Week: each day against the plan, training plan vs actual, and every tracker and checklist day by day */
  function weekView(wrap, ctx) {
    const { per, byDate, cur, prev, rows } = ctx, dates = datesIn(per.start, per.end);
    wrap.append(pcard('glance', t('p.days'), null, weekTable(dates, byDate, rows)));
    wrap.append(summaryRow(ctx));
    if (shown('nutrition') && cur.fed.length) wrap.append(nutritionCard(dates, byDate, d => dayName(dow(d), 'narrow')));
    if (shown('training')) wrap.append(trainingWeek(ctx));
    if (shown('habits') && rows.some(r => dates.some(d => r.def(d)))) wrap.append(pcard('consistency', t('p.consistency'), null, h('div', null, weekMatrix(dates, byDate, rows), legend())));
    if (shown('trackers')) { const c = trackersCard(dates, byDate); if (c) wrap.append(c); }
    if (shown('weight')) wrap.append(weightCard(cur.weights, prev.weights, ctx));
  }
  /* one row per day: calories and protein graded, training by category, share of trackers and checklists done */
  function weekTable(dates, byDate, rows) {
    const st = S.settings, head = h('div', { class: 'wt-row wt-head' }, h('span'), h('span', null, t('c.kcal')), h('span', null, t('c.protein')), h('span', null, t('t.training')), h('span', null, t('p.doneCol')));
    return h('div', { class: 'wtable' }, head, dates.map(d => {
      const day = byDate[d], x = day && day.meals.length ? totals(day) : null, fut = d > today();
      const skip = skipDay(day, d), sess = day ? day.sessions.filter(s => s.done !== false) : [], plan = plannedOn(d), adh = day && hasLog(day) && !skip ? dayAdherence(day, rows) : null;
      const cell = (v, s) => h('span', { class: 'st-' + (s || 'none') }, v);
      const tags = tagIdsOn(d, day).map(id => st.tags.find(tg => tg.id === id)).filter(Boolean), evs = eventsOn(d);
      return h('button', { class: 'wt-row' + (d === today() ? ' today' : '') + (fut ? ' future' : '') + (skip ? ' skipped' : ''), onclick: () => { S.date = d; loadDay(d); location.hash = '#today'; } },
        h('span', { class: 'wt-day' }, h('b', null, dayName(dow(d))), h('small', null, fmtDay(d)), tags.length ? h('span', { class: 'wt-tags' }, tags.map(tg => h('i', { style: { '--kc': tagColor(tg) }, title: tg.name }))) : null),
        x ? cell(fmt(x.kcal), dayStatus('kcal', day)) : cell('–'), x ? cell(fmt(x.p) + ' g', dayStatus('protein', day)) : cell('–'),
        h('span', { class: 'wt-train' }, sess.map(s => h('i', { style: { '--kc': kindOf(s) ? kindColor(s.kind) : 'var(--track2)' }, title: s.name })), !sess.length && plan.length && !skip ? h('small', { class: fut || d === today() ? 'muted' : 'st-miss' }, fut || d === today() ? t('p.plannedN', { n: plan.length }) : t('t.missed')) : null),
        adh != null ? cell(pct(adh), d === today() && adh < 1 ? 'progress' : SC.gradeOf(adh)) : cell(''),
        evs.length ? h('span', { class: 'wt-evline' }, evs.map(e => h('small', { class: e.big ? 'big' : '', style: { '--ec': evColor(e) } }, (e.big ? '★ ' : '• ') + e.title))) : null);
    }));
  }

  /* Month: the month at a glance, daily nutrition, weight trend and pace, training by week, what slips */
  function monthView(wrap, ctx) {
    const { per, byDate, cur, prev, through, rows } = ctx, dates = datesIn(per.start, per.end);
    wrap.append(pcard('glance', t('p.glance'), null, h('div', null, monthGrid(per, byDate, rows), legend())));
    if (shown('events')) { const c = eventsCard(per.start, per.end); if (c) wrap.append(c); }
    wrap.append(summaryRow(ctx));
    if (shown('nutrition') && cur.fed.length) wrap.append(nutritionCard(dates, byDate, d => { const n = +d.slice(8); return n === 1 || n % 5 === 0 ? String(n) : ''; }));
    if (shown('weight')) wrap.append(weightCard(cur.weights, prev.weights, ctx));
    if (shown('training')) wrap.append(trainingMonth(ctx));
    if (shown('fields')) { const c = fieldsCard(datesIn(per.start, through), byDate); if (c) wrap.append(c); }
    if (shown('habits')) { const rr = rateRows(rows, datesIn(per.start, through), byDate); if (rr.children.length) wrap.append(pcard('consistency', t('p.consistency'), null, h('div', null, rr, h('p', { class: 'muted small mt' }, t('p.tapRow'))))); }
    if (shown('trackers')) { const c = trackersCard(datesIn(per.start, through), byDate); if (c) wrap.append(c); }
    if (shown('tags')) { const c = tagsCard(cur.days, rows); if (c) wrap.append(c); }
    if (shown('body')) { const b = goalCard(); if (b) wrap.append(b); }
  }
  /* a calendar: each day tinted by how it went (targets, trackers and checklists), a dot when trained */
  function dayScore(day, rows) {
    const parts = [];
    for (const k of ['kcal', 'protein']) { const s = dayStatus(k, day); if (s && s !== 'progress') parts.push(SC.GRADE_VALUE[s]); }
    const adh = hasLog(day) ? dayAdherence(day, rows) : null; if (adh != null) parts.push(adh);
    return parts.length ? sum(parts, x => x) / parts.length : null;
  }
  function monthGrid(per, byDate, rows) {
    const lead = (U.parseD(per.start).getDay() + 6) % 7;
    return h('div', { class: 'mgrid' }, U.DAYS.map(d => h('span', { class: 'mg-head' }, dayName(d, 'narrow'))), [...Array(lead)].map(() => h('span')),
      datesIn(per.start, per.end).map(d => {
        const day = byDate[d], skip = skipDay(day, d), score = day && d <= today() && !skip ? dayScore(day, rows) : null, status = score == null ? 'none' : d === today() && score < 1 ? 'progress' : SC.gradeOf(score);
        const trained = day && day.sessions.some(s => s.done !== false), tagId = tagIdsOn(d, day)[0], tag = tagId ? S.settings.tags.find(tg => tg.id === tagId) : null;
        const evs = eventsOn(d), big = evs.find(e => e.big), title = [tag ? tag.name : null, ...evs.map(e => e.title)].filter(Boolean).join(' · ');
        return h('button', { class: 'mg st-' + status + (d === today() ? ' today' : '') + (d > today() ? ' future' : '') + (skip ? ' skipped' : '') + (big ? ' evbig' : ''), style: big ? { '--ec': evColor(big) } : null, title: title || null, onclick: () => { S.date = d; loadDay(d); location.hash = '#today'; } },
          h('span', null, String(+d.slice(8))), trained ? h('i', { style: { '--kc': kindColor(kindOf(day.sessions.find(s => s.done !== false))) } }) : null, tag ? h('em', { style: { '--kc': tagColor(tag) } }) : null,
          evs.length ? h('b', { class: 'evm' + (big ? ' big' : ''), style: { '--ec': evColor(big || evs[0]) }, 'aria-hidden': 'true' }, big ? '★' : '') : null);
      }));
  }

  /* Year: how far things moved, month by month, the year's events, and the longer view of trackers and the goal */
  function yearView(wrap, ctx) {
    const { per, byDate, cur, through, since, rows } = ctx, st = S.settings, from = since > per.start ? since : per.start;
    const months = [...Array(12)].map((_, i) => firstOfMonth(per.start, i)).filter(m => m <= through && m >= firstOfMonth(from));
    const inMonth = (m, list) => list.filter(x => x.date.slice(0, 7) === m.slice(0, 7));
    wrap.append(summaryRow(ctx));
    wrap.append(highlights(months, byDate, cur, through, from, rows));
    if (shown('events')) { const c = eventsCard(per.start, per.end); if (c) wrap.append(c); }
    if (shown('weight')) {
      const weekly = []; const seen = {};
      cur.weights.forEach(p => { const w = weekStart(p.date); (seen[w] = seen[w] || []).push(p.v); });
      Object.keys(seen).sort().forEach(w => weekly.push({ date: w, v: sum(seen[w], v => v) / seen[w].length }));
      wrap.append(weightCard(cur.weights, [], ctx, weekly.length > 1 ? weekly : null));
    }
    if (shown('nutrition') && cur.fed.length) {
      const item = (m, key) => { const fed = inMonth(m, cur.fed), v = fed.length ? sum(fed, d => key === 'kcal' ? totals(d).kcal : totals(d).p) / fed.length : 0, tg = setupOn(addDays(firstOfMonth(m, 1), -1) > today() ? today() : addDays(firstOfMonth(m, 1), -1)).targets; const s = fed.length ? SC.targetStatus(v, tg[key], tg.aim[key], m.slice(0, 7) < today().slice(0, 7)) : null; return { label: monthLabel(m, 'narrow'), value: v, color: gradeColor(s) || 'var(--accent2)' }; };
      wrap.append(pcard('nutrition', t('p.nutritionMonthly'), null, h('div', null,
        h('div', { class: 'subhead' }, t('p.avgPerDay', { what: t('c.kcal') })), svg(bars(months.map(m => item(m, 'kcal')), { target: st.targets.kcal, height: 120 })),
        h('div', { class: 'subhead' }, t('p.avgPerDay', { what: t('c.protein') })), svg(bars(months.map(m => item(m, 'protein')), { target: st.targets.protein, height: 100 })),
        h('p', { class: 'muted small' }, t('p.daysLoggedByMonth') + ' ' + months.map(m => `${monthLabel(m, 'short')} ${inMonth(m, cur.fed).length}`).join(' · ')), legend())));
    }
    if (shown('training')) wrap.append(trainingYear(ctx, months));
    if (shown('fields')) { const c = fieldsCard(datesIn(from, through), byDate); if (c) wrap.append(c); }
    if (shown('habits') && months.length) { const g = yearGrid(rows, months, byDate, through); if (g) wrap.append(pcard('consistency', t('p.consistency'), null, h('div', null, g, legend(), h('p', { class: 'muted small mt' }, t('p.tapRow'))))); }
    if (shown('trackers')) { const c = trackersCard(datesIn(from, through), byDate); if (c) wrap.append(c); }
    if (shown('tags')) { const c = tagsCard(cur.days, rows); if (c) wrap.append(c); }
    if (shown('body')) { const b = goalCard(); if (b) wrap.append(b); }
  }
  function highlights(months, byDate, cur, through, from, rows) {
    const items = [];
    items.push([String(cur.logged.length), t('p.daysLogged')]);
    items.push([String(cur.done.length), t('w.sessions'), t('w.hours', { h: fmt1(cur.minutes / 60) })]);
    let best = null; for (const r of rows) { if (isWeekly(r, [through])) continue; let run = 0, top = 0; for (const d of datesIn(from, through)) { const c = r.cell(d, byDate[d]); if (c == null || c === 'future') continue; if (c === 'met') { run++; top = Math.max(top, run); } else if (d !== today()) run = 0; } if (top && (!best || top > best.n)) best = { n: top, name: r.name }; }
    if (best) items.push([String(best.n), t('p.longestStreak'), best.name]);
    const busiest = months.map(m => [m, sum(cur.done.filter(s => s.date.slice(0, 7) === m.slice(0, 7)), s => num(s.minutes))]).sort((a, b) => b[1] - a[1])[0];
    if (busiest && busiest[1]) items.push([monthLabel(busiest[0], 'long'), t('p.mostTraining'), t('w.hours', { h: fmt1(busiest[1] / 60) })]);
    const w = cur.weights; if (w.length > 1) items.push([signed(Math.round((w[w.length - 1].v - w[0].v) * 10) / 10, fmt1) + ' ' + unit(), t('p.weightChange')]);
    const recs = recordsIn(from, through); if (recs.length) items.push([String(recs.length), t('p.recordsSet')]);
    return pcard('highlights', t('p.highlights'), null, h('div', { class: 'stats' }, items.map(([big, lab, sub]) => stat(big, lab, [sub]))));
  }

  /* Data: a month as a table, a row per day and a column per number. Sort by a column, choose columns, export CSV. */
  function dataColumns() {
    const st = S.settings, cols = [
      { key: 'kcal', label: t('c.kcal'), get: d => d.meals.length ? totals(d).kcal : null, fmt },
      { key: 'p', label: t('c.protein'), get: d => d.meals.length ? totals(d).p : null, fmt },
      { key: 'c', label: t('c.carbs'), get: d => d.meals.length ? totals(d).c : null, fmt },
      { key: 'f', label: t('c.fat'), get: d => d.meals.length ? totals(d).f : null, fmt },
      ...st.nutrients.map(n => ({ key: 'n.' + n.id, label: n.name, get: d => d.meals.length ? totals(d).n[n.id] || 0 : null, fmt: fmt1 })),
      ...st.trackers.filter(x => x.type !== 'weight').map(x => ({ key: 'tk.' + x.id, label: x.name, get: d => { const v = SC.trackerValue(x, d); return SC.hasValue(x, v) ? (x.type === 'check' ? 1 : x.type === 'time' ? String(v) : x.type === 'text' ? String(v) : num(v)) : null; }, show: v => x.type === 'check' ? '✓' : valueText(x, v), text: x.type === 'text' || x.type === 'time' })),
      { key: 'weight', label: t('m.weight') + ` (${unit()})`, get: d => d.weight, fmt: fmt1 },
      ...st.routines.filter(r => r.items.length).map(r => ({ key: 'r.' + r.id, label: r.name, get: d => { const n = r.items.filter(i => (d.checks[r.id] || {})[i.id]).length; return n || null; }, show: v => `${v}/${r.items.length}` })),
      { key: 'min', label: t('p.minCol'), get: d => { const m = sum(d.sessions.filter(s => s.done !== false), s => num(s.minutes)); return m || null; }, fmt },
      { key: 'load', label: t('p.loadCol'), get: d => { const l = sum(d.sessions.filter(s => s.done !== false), load); return l || null; }, fmt },
      { key: 'effort', label: t('p.effortShort'), get: d => { const e = d.sessions.filter(s => s.done !== false && s.effort).map(s => num(s.effort)); return e.length ? Math.max(...e) : null; }, fmt },
      /* each category's number and duration fields, summed over the day's sessions of that category */
      ...st.sessionKinds.flatMap(k => k.fields.filter(fd => fd.type === 'number' || fd.type === 'duration').map(fd => ({ key: `f.${k.id}.${fd.id}`, label: `${k.name} · ${fd.name}` + (fd.unit ? ` (${fd.unit})` : ''),
        get: d => { const vs = d.sessions.filter(s => s.done !== false && s.kind === k.id).map(s => s.fields && s.fields[fd.id]).filter(v => v != null && v !== '' && Number.isFinite(+v)); return vs.length ? sum(vs, v => num(v)) : null; }, fmt: fmt1 }))),
      { key: 'sessions', label: t('w.sessions'), get: d => d.sessions.filter(s => s.done !== false).map(s => s.name).join(', ') || null, text: true },
      { key: 'tags', label: t('dy.tags'), get: d => tagIdsOn(d.date, d).map(id => (st.tags.find(x => x.id === id) || {}).name).filter(Boolean).join(', ') || null, text: true },
      { key: 'events', label: t('ev.title'), get: d => eventsOn(d.date).map(e => e.title).join(', ') || null, text: true },
      { key: 'note', label: t('t.notes'), get: d => d.note || null, text: true }];
    return cols;
  }
  function dataView(wrap, ctx) {
    const { per } = ctx, hidden = new Set(readJSON('datacols', []));
    const cols = dataColumns().filter(c => !hidden.has(c.key)), days = datesIn(per.start, per.end).filter(d => d <= today()).map(d => ctx.byDate[d] || SC.emptyDay(d));
    const { key, dir } = S.dataSort, col = cols.find(c => c.key === key);
    const rowsData = days.map(d => ({ d, v: Object.fromEntries(cols.map(c => [c.key, c.get(d)])) }));
    if (col) rowsData.sort((a, b) => { const x = a.v[key], y = b.v[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (col.text ? String(x).localeCompare(String(y), I.locale()) : x - y) * dir; });
    else if (dir < 0) rowsData.reverse();
    const th = (k, label) => h('th', { class: (k === key ? 'on' : '') + (k !== 'date' && !(cols.find(c => c.key === k) || {}).text ? ' n' : ''), onclick: () => { S.dataSort = key === k ? { key: k, dir: -dir } : { key: k, dir: 1 }; render(); } }, label + (k === key ? (dir === 1 ? ' ↑' : ' ↓') : ''));
    const cellOf = (c, v) => v == null || v === '' ? '' : c.show ? c.show(v) : c.fmt ? c.fmt(v) : String(v);
    const table = h('table', { class: 'foods datatable' },
      h('thead', null, h('tr', null, th('date', t('p.dateCol')), cols.map(c => th(c.key, c.label)))),
      h('tbody', null, rowsData.map(({ d, v }) => h('tr', { class: skipDay(d) ? 'skipped' : '', onclick: () => { S.date = d.date; loadDay(d.date); location.hash = '#today'; } },
        h('td', { class: 'food' }, `${dayName(dow(d.date))} ${fmtDay(d.date)}`), cols.map(c => { const x = cellOf(c, v[c.key]); return h('td', { class: c.text ? 'txt' : 'n' }, c.text && x ? h('div', { class: 'clip', title: x }, x) : x); })))));
    wrap.append(h('div', { class: 'tablewrap' }, days.length ? table : h('p', { class: 'empty pad' }, t('p.future'))),
      h('div', { class: 'tablefoot' }, h('span', null, t('p.nDays', { n: days.filter(d => hasLog(d)).length })),
        h('span', { class: 'actions' }, h('button', { class: 'btn small', onclick: columnsSheet }, t('p.columns')), h('button', { class: 'btn small', onclick: () => exportDataCSV(days, cols, per) }, t('f.csv')), h('button', { class: 'btn small', onclick: () => exportDataCSV(allDays(), dataColumns(), null) }, t('p.csvAll')))));
  }
  function columnsSheet() {
    const hidden = new Set(readJSON('datacols', []));
    openSheet(t('p.columns'), h('div', null, h('p', { class: 'muted small' }, t('p.columnsSub')),
      dataColumns().map(c => h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: !hidden.has(c.key), onchange: e => { if (e.target.checked) hidden.delete(c.key); else hidden.add(c.key); } }), h('span', { class: 'row-name' }, c.label))),
      saveRow(() => { writeJSON('datacols', [...hidden]); closeSheet(); render(); })));
  }
  async function exportDataCSV(days, cols, per) {
    const raw = (c, v) => v == null ? '' : c.key.startsWith('tk.') && typeof v === 'number' ? v : v;
    const rows = [[t('p.dateCol'), ...cols.map(c => c.label)], ...days.map(d => [d.date, ...cols.map(c => raw(c, c.get(d)))])];
    await saveFile(fileBase() + (per ? '-' + per.start.slice(0, 7) : '-all') + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv', false);
  }

  /* which cards Progress shows */
  function customizeSheet() {
    const hide = new Set(S.settings.progress.hide);
    const row = (label, on, set) => h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: on, onchange: e => set(e.target.checked) }), h('span', { class: 'row-name' }, label));
    openSheet(t('p.customize'), h('div', null, h('p', { class: 'muted small' }, t('p.customizeSub')),
      PCARDS.map(k => row(t('p.card.' + k), !hide.has(k), on => { if (on) hide.delete(k); else hide.add(k); })),
      saveRow(() => { const s = latest(); s.progress.hide = [...hide]; saveAnd(s); })));
  }
  /* the goal: target weight and body fat, the band to stay in, a note, and checkpoints on the way (drag to order) */
  function goalSheet() {
    const g = clone(S.settings.goal), u = unit(), band = { lo: g.band ? g.band[0] : null, hi: g.band ? g.band[1] : null }, ms = g.milestones;
    const any = g.weight != null || g.bodyFat != null || g.band || g.note || ms.length;
    openSheet(t('s.goal'), h('div', null,
      h('div', { class: 'grid2' }, numField(t('s.goalWeight', { u }), g, 'weight'), numField(t('s.goalBf'), g, 'bodyFat')),
      h('div', { class: 'grid2' }, numField(t('s.bandLo', { u }), band, 'lo'), numField(t('s.bandHi', { u }), band, 'hi')),
      h('p', { class: 'muted small' }, t('s.bandHelp')),
      textField(t('s.goalNote'), g, 'note'),
      h('div', { class: 'subhead' }, t('p.milestones')), h('p', { class: 'muted small' }, t('s.milestonesSub')),
      listEditor(ms, [{ key: 'label', label: t('s.milestone') }, { key: 'date', label: t('ev.date'), type: 'date', small: true }, { key: 'bodyFat', label: '% ' + t('c.fat'), type: 'number', small: true }, { key: 'weight', label: u, type: 'number', small: true }], () => {}, t('s.addMilestone'), null, { sortable: true }),
      saveRow(() => { const s = latest(); s.goal = { weight: g.weight, bodyFat: g.bodyFat, note: g.note, band: band.lo != null && band.hi != null ? [band.lo, band.hi] : null, milestones: ms.filter(m => String(m.label || '').trim() || m.bodyFat != null || m.weight != null) }; saveAnd(s); },
        any ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.goal = { weight: null, bodyFat: null, band: null, note: '', milestones: [] }; saveAnd(s, null, t('p.goalCleared')); } }, t('p.clearGoal')) : null)), { wide: true });
  }

  /* ---------- Settings ---------- */
  /* Only what applies to the whole profile or app. Everything else is edited on the page that shows it. Saves at once. */
  function viewSettings() {
    const wrap = h('div', { class: 'page settings' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('s.title')), h('div', { class: 'sub' }, t('s.sub')))));
    wrap.append(section(t('s.profile'), null, profileBlock()));
    wrap.append(section(t('s.app'), null, appBlock()));
    wrap.append(syncCard());
    wrap.append(section(t('s.data'), null, h('div', null, h('p', { class: 'muted small storedin' }, storedInText()), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: exportSheet }, t('s.export')),
      h('button', { class: 'btn', onclick: () => openSheet(t('i.title'), importPanel(() => { closeSheet(); render(); }), { wide: true }) }, t('s.import')),
      h('a', { class: 'btn', href: '#start' }, t('nav.start')),
      h('button', { class: 'btn danger', onclick: () => confirmSheet(t('s.erase'), t('s.eraseConfirm') + cloudNote(), t('s.eraseBtn'), async () => { await store.eraseProfile(); hydrate(); location.hash = '#start'; render(); updateSyncUI(); toast(t('s.erased')); }, t('c.cancel')) }, t('s.erase'))))));
    return wrap;
  }
  /* this profile's name, units and day start, then the other profiles on this device */
  function profileBlock() {
    const prof = store.currentProfile(), list = h('div', { class: 'list' });
    const name = h('input', { type: 'text', value: prof.name || '', placeholder: t('c.optional'), onchange: e => { store.renameProfile(prof.id, e.target.value.trim()); refreshProfileButton(); drawList(); flashSaved(); } });
    const unitSel = h('select', { onchange: e => changeSystem(e.target.value) }, SC.SYSTEMS.map(v => h('option', { value: v, selected: v === S.settings.units.system }, t('s.sys.' + v))));
    const startSel = h('select', { onchange: e => { const s = latest(); s.dayStart = e.target.value; saveSettingsNow(s); render(); } },
      [0, 1, 2, 3, 4, 5, 6].map(n => { const v = pad2(n) + ':00'; return h('option', { value: v, selected: v === S.settings.dayStart }, n ? fmtTime(v) : t('s.midnight')); }));
    const drawList = () => {
      const profs = store.profiles(), cur = store.currentProfile().id;
      list.replaceChildren(...profs.map(p => h('div', { class: 'row pick' },
        h('div', { class: 'row-name' }, p.name || t('s.profile'), p.id === cur ? h('span', { class: 'badge' }, t('s.current')) : null),
        p.id !== cur ? h('button', { class: 'btn small', onclick: () => switchProfile(p.id) }, t('s.switch')) : null,
        profs.length > 1 ? h('button', { class: 'btn ghost icon', 'aria-label': t('s.deleteProfile'), onclick: () => confirmSheet(t('s.deleteProfile'), t('s.deleteProfileConfirm', { name: p.name || t('s.profile') }) + cloudNote(p.id), t('c.delete'), async () => { const was = store.currentProfile().id; await store.deleteProfile(p.id); hydrate(); rerenderAll(); if (store.currentProfile().id !== was) MB.sync.profileChanged(); }, t('c.cancel')) }, '×') : null)));
    };
    drawList();
    return h('div', null,
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('s.profileName')), name), h('label', { class: 'field' }, h('span', null, t('s.units')), unitSel)),
      h('p', { class: 'muted small' }, t('s.unitsHelp')),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('s.dayStart')), startSel), h('p', { class: 'muted small' }, t('s.dayStartHelp'))),
      h('div', { class: 'subhead' }, t('s.profiles')), h('p', { class: 'muted small' }, t('s.profilesSub')), list,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => newProfileSheet() }, t('s.addProfile'))));
  }
  /* Switching US and metric converts everything kept in those units, so the numbers keep their meaning: the goal, logged
     weights and set loads, number trackers and category fields in lb, in, mi, fl oz or °F (their values, targets and past
     targets), and back. */
  function changeSystem(to) {
    if (to === S.settings.units.system || !SC.SYSTEMS.includes(to)) return;
    const s = latest(), wFrom = s.units.weight, wTo = to === 'metric' ? 'kg' : 'lb', cw = v => v == null || v === '' ? v : SC.convertWeight(num(v), wFrom, wTo);
    s.units = { system: to, weight: wTo };
    s.goal.weight = cw(s.goal.weight); if (s.goal.band) s.goal.band = s.goal.band.map(cw);
    s.goal.milestones = s.goal.milestones.map(m => ({ ...m, weight: cw(m.weight) }));
    const conv = {}, fconv = {};
    s.trackers = s.trackers.map(x => { if (x.type !== 'number') return x; const c = SC.convertUnit(x.target, x.unit, to); if (!c) return x; const u = x.unit; conv[x.id] = v => SC.convertUnit(v, u, to).v; return { ...x, unit: c.unit, target: c.v }; });
    s.sessionKinds = s.sessionKinds.map(k => ({ ...k, fields: k.fields.map(fd => { if (fd.type !== 'number') return fd; const c = SC.convertUnit(null, fd.unit, to); if (!c) return fd; const u = fd.unit; fconv[k.id + '/' + fd.id] = v => SC.convertUnit(v, u, to).v; return { ...fd, unit: c.unit }; }) }));
    const ups = []; let n = 0;
    for (const raw of store.list('days')) {
      const d = SC.normalizeDay(raw, raw.date || raw.id); let hit = false;
      if (d.weight != null) { d.weight = cw(d.weight); hit = true; }
      for (const k of Object.keys(conv)) if (d.values[k] != null && Number.isFinite(+d.values[k])) { d.values[k] = conv[k](d.values[k]); hit = true; }
      for (const x of d.sessions) { for (const r of x.sets) if (r.wt != null) { r.wt = cw(r.wt); hit = true; } for (const fk of Object.keys(x.fields || {})) { const c = fconv[x.kind + '/' + fk]; if (c && Number.isFinite(+x.fields[fk])) { x.fields[fk] = c(x.fields[fk]); hit = true; } } }
      if (hit) { n++; ups.push(['days/' + d.date, { ...d, updatedAt: store.stamp() }]); }
    }
    /* past setups judge past days: their targets move too */
    for (const hx of S.history) { let hit = false; const trs = hx.trackers.map(y => conv[y.id] && y.target != null ? (hit = true, { ...y, target: conv[y.id](y.target) }) : y); if (hit) ups.push(['history/' + hx.date, { ...hx, trackers: trs, updatedAt: store.stamp() }]); }
    if (ups.length) { store.bulk({ upserts: ups }); loadHistory(); }
    saveSettingsNow(s); loadDay(S.date); render();
    toast(n ? t('s.convertedSys', { n, u: t('s.sys.' + to) }) : t('c.saved'));
  }
  function gatesEditor(draft, dirty) {
    const box = h('div', { class: 'editor' }), rows = h('div', { class: 'editor' });
    sortable(rows, (from, to) => { moveItem(draft.gates, from, to); dirty(); draw(); });
    const draw = () => rows.replaceChildren(...draft.gates.map((g, i) => h('div', { class: 'editor-row wrap', 'data-sort': '' }, dragHandle(),
      h('input', { type: 'text', placeholder: t('c.name'), value: g.name, oninput: e => { g.name = e.target.value; dirty(); } }),
      h('input', { type: 'text', placeholder: t('s.stages'), value: g.stages.join(', '), oninput: e => { g.stages = e.target.value.split(',').map(s => s.trim()).filter(Boolean); dirty(); } }),
      h('input', { type: 'number', class: 'xs', placeholder: '#', min: 1, value: g.current, oninput: e => { g.current = num(e.target.value) || 1; dirty(); } }),
      h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { draft.gates.splice(i, 1); dirty(); draw(); } }, '×'))));
    box.append(rows, h('div', null, h('button', { class: 'btn small', onclick: () => { draft.gates.push({ id: uid(), name: '', stages: [], current: 1 }); dirty(); draw(); } }, t('s.addGate'))));
    draw();
    return box;
  }
  /* language, theme, status colors and folding: this device only */
  function appBlock() {
    const langSel = h('select', { class: 'lang', onchange: e => { I.set(e.target.value); rerenderAll(); } }, Object.entries(I.LANGS).map(([c, n]) => h('option', { value: c, selected: c === I.lang }, n)));
    const themeSeg = segmented([{ value: 'auto', label: t('s.followDevice') }, { value: 'light', label: t('s.light') }, { value: 'dark', label: t('s.dark') }], themePref(), applyTheme);
    const palSeg = segmented([{ value: 'std', label: t('s.palStd') }, { value: 'cb', label: t('s.palCb') }], pref('palette', 'std'), v => { applyPalette(v); flashSaved(); });
    const swatch = h('span', { class: 'lg-bar', 'aria-hidden': 'true' }, SC.GRADES.map(g => h('i', { class: 'g-' + g })));
    return h('div', null, h('div', { class: 'grid2 stack' }, h('label', { class: 'field' }, h('span', null, t('s.language')), langSel), h('div', { class: 'field' }, h('span', null, t('s.theme')), themeSeg)),
      h('div', { class: 'field' }, h('span', null, t('s.palette')), h('div', { class: 'palrow' }, palSeg, swatch), h('small', { class: 'muted' }, t('s.paletteHelp'))),
      h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: autoFold(), onchange: e => { setPref('autofold', e.target.checked ? '1' : '0'); flashSaved(); } }), h('span', { class: 'row-name' }, t('s.autoFold'), h('div', { class: 'muted small' }, t('s.autoFoldHelp')))));
  }
  function newProfileSheet(onCreated) {
    const d = { name: '' };
    openSheet(t('pf.new'), h('div', null, textField(t('s.profileName'), d, 'name'), h('button', { class: 'btn primary', onclick: () => { const id = store.addProfile(d.name); closeSheet(); if (onCreated) onCreated(id); else switchProfile(id); } }, t('c.add'))));
  }
  function switchProfile(id) { if (!store.setProfile(id)) return; pendingPaths.clear(); hydrate(); S.foodTab = t('f.all'); rerenderAll(); MB.sync.profileChanged(); if (!store.get('settings/main') && !store.count()) location.hash = '#start'; }
  function profileSheet() {
    const profs = store.profiles(), cur = store.currentProfile().id;
    openSheet(t('pf.switch'), h('div', null, h('div', { class: 'list' }, profs.map(p => h('button', { class: 'row pick' + (p.id === cur ? ' on' : ''), onclick: () => { closeSheet(); if (p.id !== cur) switchProfile(p.id); } },
      h('span', { class: 'row-name' }, p.name || t('s.profile')), p.id === cur ? h('span', { class: 'badge' }, t('s.current')) : null))),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => newProfileSheet() }, t('s.addProfile')))));
  }
  /* ---------- Sync: status dot, Settings card, changes from other devices and tabs ---------- */
  const syncStateText = st => st.state === 'pending' ? t('sy.st.pending', { n: st.pending }) : t('sy.st.' + st.state);
  function syncErrorText(e) {
    const code = e && e.code;
    if (code === 'server') return t('sy.err.server', { status: e.status || '?' });
    if (code === 'tooLarge') return t('sy.err.tooLarge', { path: e.path || '' });
    if (code === 'badKey') return t('sy.badKey');
    return t(['key', 'invite', 'offline', 'timeout', 'upgrade'].includes(code) ? 'sy.err.' + code : 'sy.err.local');
  }
  const storedInText = () => t(MB.sync.status().linked ? 'sy.storedIn' : 's.storedIn', { kind: store.kind() });
  const cloudNote = id => { const m = store.syncMeta(id); return m && m.key ? ' ' + t('sy.cloudKept') : ''; };
  function fmtWhen(t0) {
    const d = new Date(t0);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(I.locale(), { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleString(I.locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  /* dot and card update in place; the card is rebuilt only when linking changes its layout */
  function updateSyncUI(st) {
    st = st || MB.sync.status();
    document.querySelectorAll('.syncdot').forEach(el => {
      el.classList.toggle('hidden', !st.linked);
      if (!st.linked) return;
      el.dataset.state = st.state;
      el.querySelector('.syncdot-n').textContent = (st.state === 'pending' || st.state === 'offline') && st.pending ? String(st.pending) : '';
      const label = t('sy.dot', { state: syncStateText(st) });
      el.setAttribute('aria-label', label); el.title = label;
    });
    const stored = $('.storedin'); if (stored) stored.textContent = storedInText();
    const card = $('.synccard');
    if (card) { if (card.dataset.linked !== String(st.linked)) card.replaceWith(syncCard()); else if (card.update) card.update(st); }
  }
  function syncDotTap() {
    const st = MB.sync.status();
    if (st.state === 'error') toast(syncErrorText(st.error), { action: t('sy.syncNow'), onAction: () => MB.sync.syncNow() });
    else { if (st.state === 'offline') toast(t('sy.st.offline')); MB.sync.syncNow(); }
  }
  function syncCard() {
    const st = MB.sync.status(), body = h('div'), card = section(t('sy.title'), t('sy.sub'), body, 'synccard');
    card.dataset.linked = String(st.linked);
    if (!st.linked) {
      body.append(h('p', { class: 'muted small' }, t('sy.intro')), h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: createVaultSheet }, t('sy.create')),
        h('button', { class: 'btn', onclick: linkSheet }, t('sy.link'))));
      return card;
    }
    const line = h('div', { class: 'syncline' }), when = h('p', { class: 'muted small' });
    card.update = s => {
      line.replaceChildren(...[h('i', { class: 'syncdot-i', 'data-state': s.state, 'aria-hidden': 'true' }), h('span', null, syncStateText(s)),
        s.state !== 'pending' && s.pending ? h('span', { class: 'muted' }, ' · ' + t('sy.st.pending', { n: s.pending })) : null,
        s.state === 'error' ? h('span', { class: 'err-line' }, syncErrorText(s.error)) : null].filter(Boolean));
      when.textContent = s.lastSync ? t('sy.lastSync', { when: fmtWhen(s.lastSync) }) : t('sy.never');
    };
    card.update(st);
    body.append(line, when,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => MB.sync.syncNow() }, t('sy.syncNow')),
        h('button', { class: 'btn', onclick: () => keySheet(MB.sync.status().key) }, t('sy.showKey')),
        h('button', { class: 'btn', onclick: downloadCloud }, t('sy.download'))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: unlinkSheet }, t('sy.unlink')),
        h('button', { class: 'btn danger', onclick: deleteCloudSheet }, t('sy.deleteCloud'))));
    return card;
  }
  const keyInput = (d, label) => {
    const f = textField(label, d, 'key', null, 'tly-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX'), inp = f.querySelector('input');
    inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('spellcheck', 'false');
    return f;
  };
  function busyButton(label, run) {
    const b = h('button', { class: 'btn primary', onclick: async () => { b.disabled = true; b.textContent = t('sy.working'); try { await run(); } finally { if (b.isConnected) { b.disabled = false; b.textContent = label; } } } }, label);
    return b;
  }
  function createVaultSheet() {
    const d = { invite: '' }, err = h('p', { class: 'err-line', role: 'alert' });
    const btn = busyButton(t('sy.createBtn'), async () => {
      err.textContent = '';
      if (!d.invite.trim()) { err.textContent = t('sy.needInvite'); return; }
      try { keySheet(await MB.sync.createVault(d.invite)); } catch (e) { err.textContent = syncErrorText(e); }
    });
    openSheet(t('sy.create'), h('div', null, h('p', { class: 'muted' }, t('sy.createHelp')), textField(t('sy.invite'), d, 'invite'), h('div', { class: 'actions' }, btn), err));
  }
  function keySheet(key) {
    const copy = async () => { try { await navigator.clipboard.writeText(key); toast(t('c.copied')); } catch (e) { toast(t('e.copyFailed')); } };
    openSheet(t('sy.keyTitle'), h('div', null, h('div', { class: 'synckey', tabindex: '0' }, key),
      h('div', { class: 'notice warn' }, h('span', null, t('sy.keyWarn'))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: copy }, t('c.copy')), h('button', { class: 'btn', onclick: closeSheet }, t('c.done')))));
  }
  function linkSheet() {
    const d = { key: '' }, err = h('p', { class: 'err-line', role: 'alert' });
    const btn = busyButton(t('sy.linkBtn'), async () => {
      err.textContent = '';
      if (!MB.sync.normalizeKey(d.key)) { err.textContent = t('sy.badKey'); return; }
      try { const st = await MB.sync.link(d.key); closeSheet(); toast(st.state === 'offline' ? t('sy.linkedOffline') : t('sy.linked')); }
      catch (e) { err.textContent = syncErrorText(e); }
    });
    openSheet(t('sy.link'), h('div', null, h('p', { class: 'muted' }, t('sy.linkHelp')), keyInput(d, t('sy.key')),
      h('p', { class: 'muted small' }, t('sy.iphone')), h('div', { class: 'actions' }, btn), err));
  }
  async function downloadCloud() {
    try {
      const text = JSON.stringify(JSON.parse(await MB.sync.exportCloud()), null, 2);
      if (await saveFile(fileBase() + '-cloud.json', text, 'application/json', false)) toast(t('sy.downloaded'));
    } catch (e) { toast(syncErrorText(e)); }
  }
  function unlinkSheet() {
    const n = MB.sync.status().pending;
    confirmSheet(t('sy.unlink'), t('sy.unlinkConfirm') + (n ? ' ' + t('sy.unlinkPending', { n }) : ''), t('sy.unlinkBtn'),
      async () => { await MB.sync.unlink(); toast(t('sy.unlinked')); }, t('c.cancel'));
  }
  function deleteCloudSheet() {
    confirmSheet(t('sy.deleteCloud'), t('sy.deleteConfirm'), t('sy.deleteBtn'),
      async () => { try { await MB.sync.deleteCloud(); toast(t('sy.deleted')); } catch (e) { toast(syncErrorText(e)); } }, t('c.cancel'));
  }

  /* Changes from another device (sync) or another tab. State is refreshed per document; the page re-renders in place only
     when it shows what changed, and never while a sheet is open or an input has focus (then it waits for close or blur). */
  const pendingPaths = new Set();
  const editing = () => { const a = document.activeElement, main = $('#main'); return !!(a && main && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  function changedElsewhere(paths) { paths.forEach(p => pendingPaths.add(p)); applyPending(); }
  function applyPending() {
    if (!pendingPaths.size || U.sheetOpen() || editing()) return;
    const paths = [...pendingPaths]; pendingPaths.clear();
    if (paths.includes('settings/main')) { S.settings = readSettings(); if (applyDayStart()) loadDay(S.date); }
    if (paths.some(p => p.startsWith('history/'))) loadHistory();
    if (paths.some(p => p.startsWith('events/'))) loadEvents();
    if (paths.some(p => p.startsWith('foods/'))) S.foods = store.list('foods').sort(byName);
    if (paths.some(p => p.startsWith('templates/'))) S.templates = store.list('templates');
    if (paths.includes('days/' + S.date)) loadDay(S.date);
    const r = S.route, shows = p => p === 'settings/main' || ((p.startsWith('days/') || p.startsWith('history/')) && (r === 'today' || r === 'progress')) || (p.startsWith('events/') && r !== 'library' && r !== 'settings') || (p.startsWith('foods/') && r === 'library') || (p === 'm/profiles' && r === 'settings');
    if (r !== 'start' && paths.some(shows)) render();
  }
  function otherTab({ docs, meta, profileGone }) {
    if (profileGone) { pendingPaths.clear(); hydrate(); rerenderAll(); MB.sync.profileChanged(); return; }
    if (meta.some(k => k.startsWith('sync:'))) MB.sync.refresh();
    if (meta.includes('profiles')) { refreshProfileButton(); pendingPaths.add('m/profiles'); }
    changedElsewhere(docs);
  }

  /* ---------- Get started ---------- */
  function viewStart() {
    const wrap = h('div', { class: 'page start' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('g.title')), h('div', { class: 'sub' }, t('g.tagline')))));
    const hasData = !!(S.foods.length || S.settings.sessionTypes.length || S.settings.mealSlots.length || S.settings.trackers.some(x => x.type !== 'weight' && !x.archived));
    const loadPack = async pack => { const r = SC.planImport(SC.starterProfile(pack, S.settings.units.system), { mode: 'replace', current: current() }); if (!r.ok) return; await applyPlan(r.plan); toast(t('g.packLoaded', { name: t('pk.' + pack) })); location.hash = '#today'; };
    const packTile = pack => h('button', { class: 'tile pack', onclick: () => hasData ? confirmSheet(t('pk.' + pack), t('g.replaceExample'), t('g.usePack'), () => loadPack(pack), t('c.cancel')) : loadPack(pack) }, h('b', null, t('pk.' + pack)), h('span', null, t('pk.' + pack + 'Sub')));
    wrap.append(h('div', { class: 'subhead' }, t('g.packs')), h('div', { class: 'tiles' }, SC.PACKS.map(packTile),
      h('button', { class: 'tile', onclick: () => { const p = $('#importpanel'); if (p) p.scrollIntoView({ behavior: 'smooth' }); } }, h('b', null, t('g.import')), h('span', null, t('i.helpMerge'))),
      h('a', { class: 'tile', href: '#today' }, h('b', null, t('g.blank')), h('span', null, t('g.blankSub')))));
    wrap.append(section(t('g.install'), null, h('div', null, h('p', { class: 'muted' }, t('g.installSub')), h('ul', { class: 'plain' }, h('li', null, t('g.installIos')), h('li', null, t('g.installAndroid')), h('li', null, t('g.installDesktop'))))));
    const panel = importPanel(() => render()); panel.id = 'importpanel';
    wrap.append(section(t('i.title'), null, panel));
    const ref = h('div', { class: 'docs' });
    ref.append(h('p', null, t('g.formatIntro')));
    ref.append(h('h3', null, t('g.modes')), h('ul', null, h('li', null, h('b', null, t('i.merge')), ' — ', t('i.helpMerge')), h('li', null, h('b', null, t('i.replace')), ' — ', t('i.helpReplace')), h('li', null, h('b', null, t('i.remove')), ' — ', t('i.helpRemove'))),
      h('pre', { class: 'code' }, JSON.stringify(SC.REMOVE_SAMPLE, null, 2)));
    for (const d of SC.DOCS) ref.append(h('h3', null, d.key), h('p', { class: 'muted small' }, d.fields.map(f => h('code', null, f))), h('pre', { class: 'code' }, JSON.stringify({ [d.key]: d.sample }, null, 2)));
    ref.append(h('p', { class: 'muted small' }, t('g.readme')));
    wrap.append(h('details', { class: 'card' }, h('summary', null, t('g.format')), ref));
    return wrap;
  }

  /* ---------- import ---------- */
  const msg = m => {
    const v = { ...(m.vars || {}) };
    if (v.section) { const s = t('sec.' + v.section); v.section = s === 'sec.' + v.section ? v.section : s; }
    if (m.code === 'rows') { v.kept = v.kept > 0 ? t('i.kept', { n: v.kept }) : ''; v.removed = v.removed > 0 ? t('i.removedN', { n: v.removed }) : ''; }
    return t('i.' + m.code, v);
  };
  function importPanel(onDone) {
    const st = { mode: 'merge', target: 'foods', text: '', into: 'current' };
    let plan = null, profileName = null;
    const HELP = { merge: t('i.helpMerge'), replace: t('i.helpReplace'), remove: t('i.helpRemove') };
    const help = h('p', { class: 'muted small' }, HELP.merge);
    const result = h('div', { class: 'preview' });
    const applyBtn = h('button', { class: 'btn primary', disabled: true, onclick: apply }, t('c.apply'));
    const ta = h('textarea', { class: 'json', placeholder: '{ "foods": [ { "name": "Oat milk", "serving": "1 cup", "kcal": 120, "p": 3, "c": 16, "f": 5 } ] }', rows: 6, oninput: e => { st.text = e.target.value; reset(); } });
    const targetSel = h('select', { onchange: e => { st.target = e.target.value; preview(); } }, SC.TARGETS.map(v => h('option', { value: v, selected: v === st.target }, t('sec.' + v.replace('settings.', '')))));
    const targetWrap = h('label', { class: 'field hidden' }, h('span', null, t('i.listTarget')), targetSel);
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: async e => { const f = e.target.files && e.target.files[0]; if (!f) return; setText(await f.text()); file.value = ''; } });
    const modeSeg = segmented([{ value: 'merge', label: t('i.merge') }, { value: 'replace', label: t('i.replace') }, { value: 'remove', label: t('i.remove') }], 'merge', v => { st.mode = v; help.textContent = HELP[v]; if (st.text.trim()) preview(); });
    const intoSeg = segmented([{ value: 'current', label: t('i.currentProfile') }, { value: 'new', label: t('i.newProfile') }], 'current', v => { st.into = v; if (st.text.trim()) preview(); });
    const drop = h('div', { class: 'drop' }, h('span', null, t('i.drop')), h('button', { class: 'btn small', onclick: () => file.click() }, t('i.chooseFile')),
      navigator.clipboard && navigator.clipboard.readText ? h('button', { class: 'btn small', onclick: async () => { try { setText(await navigator.clipboard.readText()); } catch (e) { toast(t('i.pasteFirst')); } } }, t('i.paste')) : null);
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', async e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setText(await f.text()); });
    function setText(text) { ta.value = text; st.text = text; preview(); ta.scrollIntoView({ block: 'nearest' }); }
    function reset() { plan = null; applyBtn.disabled = true; result.replaceChildren(); }
    function show(r) {
      result.replaceChildren(...r.errors.map(x => h('div', { class: 'line err' }, msg(x))), ...r.warnings.map(x => h('div', { class: 'line warn' }, msg(x))), ...r.summary.map(x => h('div', { class: 'line ok' }, msg(x))));
      applyBtn.disabled = !r.ok;
    }
    function preview() {
      let raw;
      try { raw = JSON.parse(st.text); } catch (e) { show({ ok: false, errors: [{ code: 'badJson', vars: { err: e.message } }], warnings: [], summary: [] }); return; }
      targetWrap.classList.toggle('hidden', !Array.isArray(raw));
      const cur = st.into === 'new' ? { settings: SC.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [], events: [] } : current();
      const r = SC.planImport(raw, { mode: st.mode, target: Array.isArray(raw) ? st.target : '', current: cur });
      plan = r.ok ? r.plan : null; profileName = r.profileName; show(r);
    }
    async function apply() {
      if (!plan) return;
      if (st.into === 'new') { const id = store.addProfile(profileName || ''); store.setProfile(id); hydrate(); }
      await applyPlan(plan);
      ta.value = ''; st.text = ''; plan = null; applyBtn.disabled = true;
      result.replaceChildren(h('div', { class: 'line ok' }, t('i.applied')));
      toast(t('i.applied')); onDone && onDone();
      if (st.into === 'new') { rerenderAll(); MB.sync.profileChanged(); }
    }
    const panel = h('div', { class: 'import' }, drop, file, ta, targetWrap,
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', null, t('i.mode')), modeSeg), h('div', { class: 'field' }, h('span', null, t('i.into')), intoSeg)),
      help, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { if (!st.text.trim()) { toast(t('i.pasteFirst')); return; } preview(); } }, t('c.preview')), applyBtn), result);
    panel.setText = setText;
    if (S.pendingImport) { const txt = S.pendingImport; S.pendingImport = null; setTimeout(() => { setText(txt); toast(t('i.shared')); }, 30); }
    return panel;
  }
  /* Merge keeps the file's timestamps so older rows never overwrite newer ones; Replace stamps now, so a restored
     backup also wins over newer copies on synced devices */
  async function applyPlan(plan) {
    const now = store.stamp(), upserts = [], deletes = [], at = t => (plan.mode !== 'replace' && t) || now;
    if (plan.settings) upserts.push(['settings/main', { ...plan.settings, updatedAt: now }]);
    for (const key of ['foods', 'templates']) {
      plan[key].remove.forEach(id => deletes.push(key + '/' + id));
      plan[key].upsert.forEach(r => { const { id, ...rest } = r; upserts.push([key + '/' + id, { ...rest, updatedAt: at(rest.updatedAt) }]); });
    }
    plan.days.remove.forEach(date => deletes.push('days/' + date));
    plan.days.upsert.forEach(d => upserts.push(['days/' + d.date, { ...d, updatedAt: at(d.updatedAt) }]));
    const evp = plan.events || { upsert: [], remove: [] };
    evp.remove.forEach(id => deletes.push('events/' + id));
    evp.upsert.forEach(r => { const { id, ...rest } = r; upserts.push(['events/' + id, { ...rest, updatedAt: at(rest.updatedAt) }]); });
    const hist = plan.history || { upsert: [], remove: [] };
    hist.remove.forEach(date => deletes.push('history/' + date));
    hist.upsert.forEach(x => upserts.push(['history/' + x.date, { ...x, updatedAt: at(x.updatedAt) }]));
    const prev = S.settings;
    await store.bulk({ upserts, deletes });
    hydrate(); S.foodTab = t('f.all');
    /* new settings take effect today; imported days before that are judged by the file's own history, or by these settings */
    if (plan.settings) { const hw = historyWrites(prev, S.settings, true); if (hw.length) { await store.bulk({ upserts: hw }); loadHistory(); } }
  }
  function receiveText(text, label) { S.pendingImport = text; if (S.route === 'start') render(); else location.hash = '#start'; if (label) toast(t('i.opened', { name: label })); }

  /* ---------- export ---------- */
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const canShareFiles = () => { try { return isMobile() && !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }); } catch (e) { return false; } };
  const fileBase = () => { const p = store.currentProfile().name; return MB.APP.id + (p ? '-' + U.slug(p) : '') + '-' + today(); };
  async function saveFile(filename, text, mime, share) {
    const blob = new Blob([text], { type: mime });
    if (share) { try { await navigator.share({ files: [new File([blob], filename, { type: mime })], title: filename }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true; } catch (e) { return false; }
  }
  function exportSheet() {
    const sc = { kind: 'all', since: addDays(today(), -30) };
    const cur = current();
    const summary = h('p', { class: 'muted small' });
    const sinceIn = h('label', { class: 'field hidden' }, h('span', null, t('e.since')), h('input', { type: 'date', value: sc.since, onchange: e => { sc.since = e.target.value; draw(); } }));
    const draw = () => { const o = SC.exportProfile(cur, sc); summary.textContent = t('e.summary', { days: (o.days || []).length, foods: (o.foods || []).length, templates: (o.templates || []).length }); sinceIn.classList.toggle('hidden', sc.kind !== 'days'); };
    const done = ok => { if (!ok) return; store.setMeta('backup', { exportedAt: new Date().toISOString() }); closeSheet(); if (S.route === 'today') render(); };
    const text = () => JSON.stringify(SC.exportProfile(cur, sc), null, 2);
    draw();
    openSheet(t('e.title'), h('div', null,
      h('div', { class: 'field' }, h('span', null, t('e.scope')), segmented([{ value: 'all', label: t('e.everything') }, { value: 'setup', label: t('e.setup') }, { value: 'days', label: t('e.since') }], 'all', v => { sc.kind = v; draw(); })),
      sinceIn, summary,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: async () => done(await saveFile(fileBase() + '.json', text(), 'application/json', false)) }, t('e.file')),
        canShareFiles() ? h('button', { class: 'btn', onclick: async () => done(await saveFile(fileBase() + '.json', text(), 'application/json', true)) }, t('e.share')) : null,
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text()); toast(t('e.copied')); done(true); } catch (e) { toast(t('e.copyFailed')); } } }, t('e.copy')))));
  }
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  async function exportFoodsCSV() {
    const rows = [[t('f.food'), t('f.category'), t('f.serving'), t('c.kcal'), t('c.protein'), t('c.carbs'), t('c.fat'), t('f.note')], ...S.foods.slice().sort(byName).map(f => [f.name, f.category, f.serving, f.kcal, f.p, f.c, f.f, f.note])];
    await saveFile(fileBase() + '-foods.csv', rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv', false);
  }

  /* ---------- shell, routing, boot ---------- */
  const ICONS = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="1.7" fill="currentColor" stroke="none"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v11M15 10v11M8 3v4M16 3v4"/></svg>',
    progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/></svg>',
    library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h5v16H4zM10 4h5v16h-5zM16.5 5l4 1-3.5 14-4-1z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    /* card icons */
    s_plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    s_meals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10M17 21V3c-2.2 1.2-3 3.6-3 7v3h3"/></svg>',
    s_habits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/></svg>',
    s_checklists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6.5h10M10 12h10M10 17.5h10M4 6.5l1.2 1.2L7.5 5.3M4 12l1.2 1.2 2.3-2.4M4 17.5l1.2 1.2 2.3-2.4"/></svg>',
    s_training: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/></svg>',
    s_glance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>',
    s_nutrition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10M17 21V3c-2.2 1.2-3 3.6-3 7v3h3"/></svg>',
    s_weight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l5-6 4 3 5-7 4 4"/></svg>',
    s_consistency: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/></svg>',
    s_events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M12 12.3l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z"/></svg>',
    s_highlights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    s_cycle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/></svg>',
    s_day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>',
    s_trackers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M7.5 15l3.5-4 3 2.5 4.5-6"/></svg>',
    s_tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg>',
    s_body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 10.5a5 5 0 0 1 7 0M12 10.5l1.5-2"/></svg>'
  };
  const NAV = ['today', 'plan', 'progress', 'library', 'settings'], ROUTES = [...NAV, 'start'], ALIAS = { week: 'progress' };
  function shell() {
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, MB.APP.name),
        h('button', { class: 'syncdot hidden', type: 'button', onclick: syncDotTap }, h('i', { 'aria-hidden': 'true' }), h('span', { class: 'syncdot-n' })),
        h('span', { class: 'status', 'data-state': '' }, '')),
      h('div', { class: 'topbar-actions' },
        profileButton(),
        h('button', { class: 'btn ghost icon theme-btn', 'aria-label': t('s.theme'), onclick: toggleTheme, html: effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon })));
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(r => h('a', { href: '#' + r, 'data-route': r, html: ICONS[r] + '<span>' + t('nav.' + r) + '</span>' })));
    return h('div', { class: 'app' }, top, nav, h('main', { id: 'main', class: 'main' }));
  }
  function profileButton() {
    const prof = store.currentProfile(), many = store.profiles().length > 1;
    if (!many && !prof.name) return null;
    const b = h('button', { class: 'btn ghost small profile-btn', onclick: profileSheet, html: ICONS.user });
    b.append(h('span', null, prof.name || t('s.profile')));
    return b;
  }
  /* profile list changed in another tab: swap the button in place */
  function refreshProfileButton() {
    const bar = $('.topbar-actions'); if (!bar) return;
    const old = bar.querySelector('.profile-btn'), next = profileButton();
    if (old && next) old.replaceWith(next); else if (old) old.remove(); else if (next) bar.prepend(next);
  }
  const VIEWS = { today: viewToday, plan: viewPlan, progress: viewProgress, library: viewLibrary, settings: viewSettings, start: viewStart };
  function render() {
    const main = $('#main'); if (!main) return;
    const y = window.scrollY;
    S.refs = { cards: [] }; startMemo = null;
    try { main.replaceChildren(VIEWS[S.route]()); }
    catch (e) { console.error(e); main.replaceChildren(h('p', { class: 'empty pad' }, 'Something went wrong drawing this page.')); }
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === S.route));
    window.scrollTo(0, y);
  }
  function rerenderAll() { const app = $('.app'); if (app) app.remove(); document.body.append(shell()); setStatus(storageLabel(), ''); render(); updateSyncUI(); }
  /* #workouts, #routines, #exercises and #foods open that Library tab */
  const routeFromHash = () => { let r = location.hash.replace('#', '').split('?')[0]; if (LIB[r]) { S.libTab = r; r = 'library'; } else if (ALIAS[r]) { if (r === 'week') S.pTab = 'week'; r = ALIAS[r]; } return ROUTES.includes(r) ? r : 'today'; };
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast(t('c.newVersion'), { action: t('c.reload'), onAction: () => location.reload(), sticky: true }); }); });
    }).catch(e => console.warn('service worker', e));
  }
  async function checkInbox() {
    /* a file shared into the app (Android share target) is parked in a cache by the service worker */
    try { if (!window.caches) return; const c = await caches.open('inbox'); const r = await c.match('./shared.json'); if (!r) return; const text = await r.text(); await c.delete('./shared.json'); receiveText(text); } catch (e) {}
  }
  function fileHandlers() {
    if (!('launchQueue' in window)) return;
    try { window.launchQueue.setConsumer(async p => { for (const fh of (p.files || [])) { try { const f = await fh.getFile(); receiveText(await f.text(), f.name); } catch (e) {} } }); } catch (e) {}
  }
  async function boot() {
    I.set(I.detect(), false);
    applyTheme(themePref());
    applyPalette(pref('palette', 'std'));
    await store.init();
    document.body.append(shell());
    store.onerror = () => setStatus(t('c.saveFailed'), 'error');
    hydrate();
    const firstRun = !store.get('settings/main') && !store.count();
    if (firstRun && !location.hash) location.hash = '#start';
    S.route = routeFromHash();
    setStatus(storageLabel(), '');
    render();
    window.addEventListener('hashchange', () => { const r = routeFromHash(); if (r !== S.route || r === 'library') { S.route = r; closeSheet(); render(); window.scrollTo(0, 0); } });
    let resizeTimer = null; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
      if (S.route === 'plan') { const cal = $('.calwrap'); if (cal) drawCalendar(cal); }
      if (S.route === 'today' && S.refs.wide !== wideLayout() && !U.sheetOpen() && !editing()) render();
    }, 150); });
    let minute = nowMin(); setInterval(() => { const m = nowMin(); if (m === minute) return; minute = m; if (S.route === 'today' && S.date === today()) drawTimeline(); }, 15000);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.openedOn !== today()) { const stale = S.date === S.openedOn; S.openedOn = today(); if (stale) { S.date = today(); loadDay(S.date); if (S.route === 'today') render(); } } });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref()));
    document.addEventListener('dragover', e => { if (S.route !== 'start') e.preventDefault(); });
    document.addEventListener('drop', async e => { if (S.route === 'start') return; e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /json$/i.test(f.name)) receiveText(await f.text(), f.name); });
    store.onexternal = otherTab;
    MB.sync.onchange = updateSyncUI;
    MB.sync.onremote = changedElsewhere;
    U.onSheetClosed(applyPending);
    document.addEventListener('focusout', () => setTimeout(applyPending, 0));
    MB.sync.init();
    registerSW(); checkInbox(); fileHandlers();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
