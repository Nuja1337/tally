/* Tally — pages, routing, import/export and boot. Depends on MB.ui, MB.i18n, MB.schema, MB.store */
(() => {
  'use strict';
  const U = MB.ui, SC = MB.schema, store = MB.store, I = MB.i18n, t = I.t;
  const { $, h, svg, uid, clone, fmt, fmt1, num, byName, today, addDays, dow, DAYS, dayName, fmtLong, fmtShort, fmtDay, fmtTime, weekStart, thumb, isImageUrl,
    openSheet, closeSheet, toast, confirmSheet, section, statCard, numField, textField, selectField, segmented, helpTip, listEditor, ring, bars, trend, heat } = U;

  const S = { route: 'today', date: today(), weekDate: today(), settings: SC.normalizeSettings(null),
    day: SC.emptyDay(today()), foods: [], templates: [], foodTab: 'All', foodQ: '', foodSort: { key: 'name', dir: 1 }, libTab: 'workouts', exQ: '', planDay: dow(today()), planEdit: false,
    refs: {}, openedOn: today(), pendingImport: null };
  const unit = () => S.settings.units.weight;
  const kindName = id => { const k = S.settings.sessionKinds.find(x => x.id === id); return k ? k.name : (id || t('c.other')); };
  const allDays = () => store.list('days').map(d => SC.normalizeDay(d, d.date || d.id)).sort((a, b) => a.date < b.date ? -1 : 1);
  function current() { return { settings: S.settings, hasSettings: !!store.get('settings/main'), foods: S.foods, templates: S.templates, days: allDays(), profileName: store.currentProfile().name }; }
  const exById = id => id ? S.settings.exercises.find(e => e.id === id) : null;
  const exFor = item => exById(item.exerciseId) || SC.resolveExercise(item.name, S.settings.exercises);
  const gateLabel = gate => { const g = gate && S.settings.gates.find(x => x.id === gate.id); return g ? `${g.name} · ${g.stages[gate.at - 1] || gate.at}` : ''; };
  const fmtDur = m => m == null ? '' : m < 60 ? `${m} ${t('c.min')}` : (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} ${t('c.min')}` : `${m / 60} h`);
  const KIND_CLASS = { session: 'k-session', routine: 'k-routine', meal: 'k-meal', sleep: 'k-sleep', work: 'k-work', rest: 'k-rest', other: 'k-other' };

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

  /* ---------- status and state ---------- */
  let statusTimer = null;
  function setStatus(text, cls) { document.querySelectorAll('.status').forEach(el => { el.textContent = text; el.dataset.state = cls || ''; }); }
  const storageLabel = () => store.kind() === 'memory' ? t('c.notSaved') : t('c.onDevice');
  function flashSaved() { setStatus(t('c.saved'), 'ok'); clearTimeout(statusTimer); statusTimer = setTimeout(() => setStatus(storageLabel(), ''), 1400); }
  function hydrate() {
    S.settings = SC.normalizeSettings(store.get('settings/main'));
    S.foods = store.list('foods').sort(byName);
    S.templates = store.list('templates');
    loadDay(S.date);
  }
  function loadDay(date) { const d = store.get('days/' + date); S.day = d ? SC.normalizeDay(d, date) : SC.emptyDay(date); }
  function saveDay() { S.day.date = S.date; S.day.updatedAt = store.stamp(); store.setDoc('days/' + S.date, S.day); flashSaved(); }
  function saveSettingsNow(next) { S.settings = SC.normalizeSettings(next); S.settings.updatedAt = store.stamp(); store.setDoc('settings/main', S.settings); flashSaved(); }
  function setDate(d) { S.date = d; loadDay(d); render(); window.scrollTo(0, 0); }
  function totals(day) {
    const x = { kcal: 0, p: 0, c: 0, f: 0, burn: 0 };
    for (const m of day.meals) { x.kcal += num(m.kcal); x.p += num(m.p); x.c += num(m.c); x.f += num(m.f); }
    for (const s of day.sessions) if (s.done !== false) x.burn += num(s.kcal);
    return x;
  }
  const routinesFor = date => S.settings.routines.filter(r => !r.days.length || r.days.includes(dow(date)));
  const habitsDone = day => S.settings.habits.filter(hb => SC.habitDone(hb, day.habits[hb.id])).length;
  const routineDone = (r, day) => r.items.length > 0 && r.items.every(i => (day.checks[r.id] || {})[i.id]);
  const waveLabel = w => w ? `${t('pl.week', { n: w.week, of: w.of })} · ${t('pl.' + w.phase)}` : '';

  /* ---------- Today ---------- */
  /* A day's page: totals up top, then the day in time order, then everything you log. Each card edits its own setup in
     a sheet (targets, habits, meal slots), so nothing here sends you to Settings. Counts and checks update in place. */
  const finalDay = () => S.date < today();
  const wideLayout = () => window.innerWidth >= 900;
  function card(key, title, right, body) {
    return h('section', { class: 'card', id: 'c-' + key }, h('div', { class: 'card-head' }, h('h2', null, h('span', { class: 'hico hico-' + key, html: ICONS['s_' + key] }), title), right), body);
  }
  const editBtn = (fn, label) => h('button', { class: 'btn ghost small', onclick: fn }, label || t('c.edit'));
  const emptyAdd = (text, label, fn) => h('div', { class: 'empty-add' }, h('p', { class: 'empty' }, text), h('button', { class: 'btn small', onclick: fn }, label));
  const scrollToCard = key => { const el = document.getElementById('c-' + key); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  function viewToday() {
    const st = S.settings, wrap = h('div', { class: 'page today' }), isToday = S.date === today(), wave = SC.waveWeek(st.wave, S.date);
    const sub = [isToday ? fmtLong(S.date) : null, wave ? waveLabel(wave) : null].filter(Boolean).join(' · ');
    wrap.append(h('div', { class: 'dayhead' },
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.prev'), onclick: () => setDate(addDays(S.date, -1)) }, '‹'),
      h('div', { class: 'daytitle' }, h('h1', null, isToday ? t('c.today') : fmtLong(S.date)),
        h('div', { class: 'sub' }, isToday ? sub : [h('button', { class: 'linkbtn', onclick: () => setDate(today()) }, t('t.backToToday')), wave ? ' · ' + waveLabel(wave) : null])),
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.next'), onclick: () => setDate(addDays(S.date, 1)) }, '›')));
    S.refs = {};
    const empty = !st.habits.length && !st.routines.length && !st.sessionTypes.length && !st.mealSlots.length;
    if (empty) wrap.append(h('div', { class: 'notice' }, h('span', null, t('t.notSetUp')), h('a', { class: 'btn primary small', href: '#start' }, t('nav.start'))));
    wrap.append(summaryCard());
    if (wave && wave.phase === 'deload') wrap.append(h('div', { class: 'notice soft' }, h('span', null, t('pl.deloadHint'))));
    S.refs.alerts = h('div'); wrap.append(S.refs.alerts);
    const nudge = backupNudge(); if (nudge) wrap.append(nudge);
    const c = { plan: planCard(), meals: mealsCard(), habits: habitsCard(), checklists: checklistsCard(), training: trainingCard(), body: bodyCard() };
    S.refs.wide = wideLayout();
    if (S.refs.wide) wrap.append(h('div', { class: 'cols' }, h('div', null, c.plan, c.checklists, c.training), h('div', null, c.meals, c.habits, c.body)));
    else wrap.append(...[c.plan, c.meals, c.habits, c.checklists, c.training, c.body].filter(Boolean));
    updateCounts();
    return wrap;
  }

  /* totals: rings for calories and protein (tap to edit targets), other macros, and how much of the day is done */
  function summaryCard() {
    S.refs.rings = h('div', { class: 'rings' }); S.refs.tallies = h('div', { class: 'tallies' });
    drawRings();
    return h('section', { class: 'card summary' }, S.refs.rings, S.refs.tallies);
  }
  const STATUS_COLOR = { met: 'var(--green)', close: 'var(--amber)', miss: 'var(--red)', over: 'var(--red)' };
  function statusNote(value, target, status, u) {
    if (!status) return '';
    const gap = Math.abs(target - value), n = fmt(gap) + (u ? ' ' + u : '');
    if (status === 'met') return '✓ ' + t('t.onTarget');
    if (status === 'progress') return t('t.toGo', { n });
    return value > target ? t('t.overBy', { n }) : t('t.short', { n });
  }
  function drawRings() {
    const st = S.settings, x = totals(S.day), el = S.refs.rings; if (!el) return;
    const fin = finalDay();
    const one = (key, value, label, u, color) => {
      const target = st.targets[key], status = SC.targetStatus(value, target, st.targets.aim[key], fin);
      return h('button', { class: 'ringbox', type: 'button', 'aria-label': t('t.editTargets'), onclick: targetsSheet },
        h('span', { class: 'ringsvg', html: ring(value, target, { label, unit: u, color: STATUS_COLOR[status] || color }) }),
        h('span', { class: 'ringlab' }, label), h('span', { class: 'ringnote st-' + (status || 'none') }, target > 0 ? statusNote(value, target, status, u) : t('t.setTarget')));
    };
    const macro = (key, value, label) => {
      const target = st.targets[key], status = SC.targetStatus(value, target, st.targets.aim[key], fin);
      return h('div', { class: 'macro' }, h('span', null, label), h('b', { class: 'st-' + (status || 'none') }, fmt(value) + (target > 0 ? ` / ${fmt(target)}` : '') + ' g'));
    };
    el.replaceChildren(one('kcal', x.kcal, t('c.kcal'), '', 'var(--accent)'), one('protein', x.p, t('c.protein'), 'g', 'var(--blue)'),
      h('div', { class: 'ringmeta' }, macro('carbs', x.c, t('c.carbs')), macro('fat', x.f, t('c.fat')),
        x.burn ? h('div', { class: 'macro' }, h('span', null, t('t.burnedLabel')), h('b', null, fmt(x.burn) + ' kcal')) : null));
    drawTallies();
  }
  /* habits, checklists and planned training done today; green when all done, red when a finished day fell short */
  function drawTallies() {
    const el = S.refs.tallies; if (!el) return;
    const st = S.settings, d = S.day, fin = finalDay();
    const lists = routinesFor(S.date).filter(r => !r.alertAt && r.items.length), planned = SC.plannedFor(st, dow(S.date));
    const done = d.sessions.filter(s => s.done !== false);
    const items = [
      st.habits.length ? ['habits', t('t.habits'), habitsDone(d), st.habits.length] : null,
      lists.length ? ['checklists', t('t.checklists'), lists.filter(r => routineDone(r, d)).length, lists.length] : null,
      planned.length ? ['training', t('t.training'), planned.filter(p => done.some(s => s.typeId === p.type.id)).length, planned.length] : (done.length ? ['training', t('t.training'), done.length, 0] : null)
    ].filter(Boolean);
    el.classList.toggle('hidden', !items.length);
    el.replaceChildren(...items.map(([key, label, a, b]) => {
      const status = !b ? 'met' : a >= b ? 'met' : fin ? (a ? 'close' : 'miss') : 'progress';
      return h('button', { class: 'tally st-' + status, type: 'button', onclick: () => scrollToCard(key) }, h('b', null, b ? `${a}/${b}` : String(a)), h('span', null, label));
    }));
  }
  function drawAlerts() {
    const el = S.refs.alerts; if (!el) return;
    el.replaceChildren(...routinesFor(S.date).filter(r => r.alertAt).map(r => { const n = r.items.filter(i => (S.day.checks[r.id] || {})[i.id]).length; return n >= r.alertAt ? h('div', { class: 'notice bad' }, h('span', null, h('b', null, r.name + ': '), r.alertText || t('t.alertDefault', { n }))) : null; }).filter(Boolean));
  }

  /* the day in time order: what is on now, what is next, what got done (green) or was missed (red). A tap acts on the block. */
  const BLOCK_COLOR = { routine: 'var(--kc-teal)', meal: 'var(--kc-gold)', sleep: 'var(--kc-slate)', work: 'var(--track2)', rest: 'var(--kc-blue)', other: 'var(--track2)' };
  const kindColor = id => { const c = SC.kindColors(S.settings.sessionKinds)[id]; return c ? `var(--kc-${c})` : 'var(--accent)'; };
  const blockColor = b => b.kind === 'session' ? kindColor((S.settings.sessionTypes.find(x => x.id === b.typeId) || {}).kind) : BLOCK_COLOR[b.kind];
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  function blockDone(b, d) {
    if (b.kind === 'session') return d.sessions.some(s => s.typeId === b.typeId && s.done !== false);
    if (b.kind === 'routine') { const r = S.settings.routines.find(x => x.id === b.routineId); return r && r.items.length && !r.alertAt ? routineDone(r, d) : null; }
    if (b.kind === 'meal') return d.meals.some(m => m.slot === b.slotId);
    return null;
  }
  function planCard() {
    if (!SC.blocksFor(S.settings, dow(S.date)).length) return null;
    S.refs.timeline = h('div', { class: 'timeline' });
    return card('plan', t('t.plan'), h('a', { class: 'btn ghost small', href: '#plan' }, t('nav.plan')), S.refs.timeline);
  }
  function drawTimeline() {
    const el = S.refs.timeline; if (!el) return;
    const st = S.settings, d = S.day, blocks = SC.blocksFor(st, dow(S.date));
    const isToday = S.date === today(), past = S.date < today(), now = nowMin();
    const next = isToday ? blocks.findIndex(b => SC.hm(b.start) != null && SC.hm(b.start) > now) : -1;
    el.replaceChildren(...blocks.map((b, i) => {
      const a = SC.hm(b.start), end = a == null ? null : a + (SC.duration(b) || 0);
      const current = isToday && a != null && a <= now && now < end, ended = past || (isToday && a != null && end <= now);
      const done = blockDone(b, d), missed = done === false && ended, late = missed && !past;
      const title = SC.blockTitle(b, st) || t('pl.' + b.kind), dur = SC.duration(b);
      const tag = current ? h('span', { class: 'tl-tag now' }, t('t.now')) : i === next ? h('span', { class: 'tl-tag' }, t('t.inTime', { t: fmtDur(a - now) })) : null;
      return h('button', { class: ['tl-row', current ? 'now' : '', ended ? 'past' : '', done ? 'done' : '', missed ? (late ? 'late' : 'miss') : ''].filter(Boolean).join(' '), style: { '--kc': blockColor(b) }, onclick: () => blockTap(b) },
        h('span', { class: 'tl-time' }, b.start ? fmtTime(b.start) : '·'), h('span', { class: 'tl-dot' }),
        h('span', { class: 'tl-title' }, title, dur ? h('small', null, ' ' + fmtDur(dur)) : null), tag,
        done != null ? h('span', { class: 'tl-check', 'aria-label': done ? t('c.done') : missed ? (late ? t('t.notLogged') : t('t.missed')) : '' }, done ? '✓' : missed ? '✕' : '') : null);
    }));
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
        p.type.plan.length ? h('button', { class: 'btn primary', onclick: () => sessionSheet(newSession(p.type, p.minutes, p.kcal), true) }, t('t.logSets')) : null,
        h('button', { class: p.type.plan.length ? 'btn' : 'btn primary', onclick: () => { closeSheet(); markDone(p.type, p.minutes, p.kcal); } }, t('t.markDone')),
        p.type.plan.length ? h('button', { class: 'btn ghost', onclick: () => workoutSheet(p.type) }, t('pl.viewWorkout')) : null)));
  }
  function updateCounts() {
    const st = S.settings, d = S.day; if (!d) return;
    for (const r of st.routines) { const el = S.refs['r_' + r.id]; if (el && el.paint) el.paint(); }
    if (S.refs.habCount) { const n = habitsDone(d), m = st.habits.length; S.refs.habCount.textContent = m ? `${n}/${m}` : ''; S.refs.habCount.className = 'count' + (m && n >= m ? ' st-met' : ''); }
    drawAlerts(); drawTimeline(); drawTallies();
  }

  /* checklists (routines): one row each, opened with a tap; the open ones are remembered on this device */
  const OPEN_KEY = 'tally:open';
  const openState = (() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const isOpen = r => r.id in openState ? !!openState[r.id] : (r.items.length <= 6 && !routineDone(r, S.day));
  function setOpen(id, open) { openState[id] = open; try { localStorage.setItem(OPEN_KEY, JSON.stringify(openState)); } catch (e) {} }
  function checklistsCard() {
    const rs = routinesFor(S.date); if (!rs.length) return null;
    return card('checklists', t('t.checklists'), h('a', { class: 'btn ghost small', href: '#routines' }, t('c.edit')), h('div', { class: 'cls' }, rs.map(checklistRow)));
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
      const status = r.alertAt ? (n >= r.alertAt ? 'over' : 'none') : !all ? 'none' : n >= all ? 'met' : finalDay() ? (n ? 'close' : 'miss') : 'progress';
      count.textContent = all ? `${n}/${all}` : ''; row.dataset.status = status;
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
    row.open(); row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function checklist(routine, items) {
    const d = S.day; d.checks[routine.id] = d.checks[routine.id] || {};
    const map = d.checks[routine.id];
    return h('div', { class: 'list' }, items.map(it => {
      const cb = h('input', { type: 'checkbox', checked: !!map[it.id] });
      const ex = exFor(it);
      const name = ex ? h('button', { class: 'linkish', onclick: e => { e.preventDefault(); exerciseCard(ex); } }, it.name) : it.name;
      const row = h('label', { class: 'row' + (map[it.id] ? ' done' : '') }, cb, ex ? (thumb(ex.image, 'thumb sm') || null) : null, h('span', { class: 'row-name' }, name), it.target ? h('span', { class: 'row-target' }, it.target) : null);
      cb.addEventListener('change', () => { if (cb.checked) map[it.id] = true; else delete map[it.id]; row.classList.toggle('done', cb.checked); saveDay(); updateCounts(); });
      return row;
    }));
  }

  /* habits: tiles you tap; the dots are the last 7 days (green done, red missed on a day you logged) */
  function habitsCard() {
    const st = S.settings;
    S.refs.habCount = h('small', { class: 'count' });
    return card('habits', t('t.habits'), h('div', { class: 'head-r' }, S.refs.habCount, editBtn(habitsSheet)),
      st.habits.length ? habitGrid() : emptyAdd(t('t.noHabits'), t('t.addHabits'), habitsSheet));
  }
  function habitGrid() {
    const d = S.day, days7 = [...Array(7)].map((_, i) => addDays(S.date, i - 6)), hist = {}, logged = {};
    days7.forEach(x => { const raw = x === S.date ? d : store.get('days/' + x); logged[x] = !!raw; hist[x] = x === S.date ? d : SC.normalizeDay(raw || null, x); });
    return h('div', { class: 'habits' }, S.settings.habits.map(hb => {
      const tile = h('div', { class: 'habit', role: 'button', tabindex: '0' });
      const paint = () => {
        const v = d.habits[hb.id], done = SC.habitDone(hb, v), n = num(v);
        tile.classList.toggle('on', done); tile.classList.toggle('part', !done && !!v); tile.setAttribute('aria-pressed', done ? 'true' : 'false');
        const pct = hb.target ? Math.min(1, n / hb.target) : (done ? 1 : 0);
        const dots = h('div', { class: 'dots' }, days7.map(x => { const ok = SC.habitDone(hb, (hist[x].habits || {})[hb.id]); return h('span', { class: 'dot' + (ok ? ' on' : x < S.date && logged[x] ? ' off' : '') + (x === S.date ? ' cur' : '') }); }));
        tile.replaceChildren(
          h('div', { class: 'habit-top' }, h('span', { class: 'habit-ring', html: `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--track)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(pct * 94.2).toFixed(1)} 94.2" transform="rotate(-90 18 18)"/></svg>${done ? '<i>✓</i>' : ''}` }),
            hb.target ? h('button', { class: 'habit-minus', 'aria-label': t('t.minusOne'), onclick: e => { e.stopPropagation(); if (n > 0) { d.habits[hb.id] = n - 1 > 0 ? n - 1 : undefined; if (!d.habits[hb.id]) delete d.habits[hb.id]; paint(); saveDay(); updateCounts(); } } }, '−') : null),
          h('div', { class: 'habit-name' }, hb.name),
          h('div', { class: 'habit-sub' }, hb.target ? `${n} / ${hb.target}${hb.unit ? ' ' + hb.unit : ''}` : (done ? t('c.done') : t('t.tapToDo'))),
          dots);
      };
      const act = () => {
        if (hb.target) { const v = num(d.habits[hb.id]); if (v >= hb.target) delete d.habits[hb.id]; else d.habits[hb.id] = v + 1; }
        else { if (d.habits[hb.id]) delete d.habits[hb.id]; else d.habits[hb.id] = true; }
        paint(); saveDay(); updateCounts();
      };
      tile.addEventListener('click', act); tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      paint();
      return tile;
    }));
  }
  function backupNudge() {
    const meta = store.getMeta('backup'); const days = allDays();
    const since = meta && meta.exportedAt ? days.filter(d => (d.updatedAt || d.date) > meta.exportedAt).length : days.length;
    if (since < 7) return null;
    return h('div', { class: 'nudge' }, h('span', null, t('t.backupHint', { n: since })), h('button', { class: 'linkbtn', onclick: exportSheet }, t('t.exportNow')));
  }
  function mealsCard() {
    const st = S.settings, prev = store.get('days/' + addDays(S.date, -1));
    const canCopy = !S.day.meals.length && prev && Array.isArray(prev.meals) && prev.meals.length;
    return card('meals', t('t.meals'), h('div', { class: 'head-r' }, canCopy ? h('button', { class: 'btn small', onclick: copyYesterday }, t('t.copyYesterday')) : null, editBtn(slotsSheet)),
      st.mealSlots.length ? h('div', null, st.mealSlots.map(slotBlock)) : emptyAdd(t('t.noSlots'), t('t.addSlots'), slotsSheet));
  }
  const trainingCard = () => card('training', t('t.training'), h('button', { class: 'btn small', onclick: addSessionSheet }, t('t.addSession')), trainingList());
  const bodyCard = () => card('body', t('t.body'), null, bodyBlock());

  /* setup edited from Today; saves start from the stored settings, so changes synced in while a sheet was open are kept */
  const latest = () => SC.normalizeSettings(store.get('settings/main'));
  const saveRow = (onSave, extra) => h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: onSave }, t('c.save')), extra);
  function targetsSheet() {
    const d = clone(S.settings.targets), aims = SC.AIMS.map(a => ({ value: a, label: t('s.aim.' + a) }));
    const line = (key, label) => h('div', { class: 'grid2' }, numField(label, d, key), selectField(t('s.aim'), d.aim, key, aims));
    openSheet(t('s.targets'), h('div', null, h('p', { class: 'muted small' }, t('s.targetsHelp')),
      line('kcal', t('s.calories')), line('protein', t('s.proteinG')), line('carbs', t('s.carbsG')), line('fat', t('s.fatG')),
      saveRow(() => { const s = latest(); s.targets = { kcal: num(d.kcal), protein: num(d.protein), carbs: num(d.carbs), fat: num(d.fat), aim: d.aim }; saveAnd(s); })));
  }
  function habitsSheet() {
    const list = clone(S.settings.habits);
    openSheet(t('s.habits'), h('div', null, h('p', { class: 'muted small' }, t('s.habitsSub')),
      listEditor(list, [{ key: 'name', label: t('s.habit') }, { key: 'target', label: t('s.target'), type: 'number', small: true }, { key: 'unit', label: t('s.habitUnit'), small: true }], () => {}, t('s.addHabit')),
      saveRow(() => { const s = latest(); s.habits = list.filter(x => String(x.name || '').trim()); saveAnd(s); })));
  }
  function slotsSheet() {
    const list = clone(S.settings.mealSlots);
    openSheet(t('s.slots'), h('div', null, listEditor(list, [{ key: 'name', label: t('s.slotName') }], () => {}, t('s.addSlot')),
      saveRow(() => { const s = latest(); s.mealSlots = list.filter(x => String(x.name || '').trim()); saveAnd(s); })));
  }

  /* meals */
  function slotBlock(w) {
    const meals = S.day.meals.filter(m => m.slot === w.id), block = S.settings.calendar.find(b => b.kind === 'meal' && b.slotId === w.id && b.days.includes(dow(S.date)));
    const sub = { kcal: 0, p: 0, c: 0, f: 0 };
    meals.forEach(m => { sub.kcal += num(m.kcal); sub.p += num(m.p); sub.c += num(m.c); sub.f += num(m.f); });
    return h('div', { class: 'slot' },
      h('div', { class: 'slot-head' }, h('h3', null, w.name, block && block.start ? h('small', { class: 'muted' }, ' ' + fmtTime(block.start)) : null), h('span', { class: 'muted' }, meals.length ? t('t.slotTotal', { kcal: fmt(sub.kcal), p: fmt(sub.p) }) : t('t.nothingLogged')),
        h('button', { class: 'btn small primary', onclick: () => addMealSheet(w) }, t('c.add'))),
      meals.length ? h('div', { class: 'list' }, meals.map(m => h('button', { class: 'meal', onclick: () => editMeal(m) },
        h('span', { class: 'meal-name' }, m.name), h('span', { class: 'meal-macros' }, `${fmt(m.kcal)} · ${fmt(m.p)}P ${fmt(m.c)}C ${fmt(m.f)}F`)))) : null,
      meals.length ? h('div', { class: 'actions end' }, h('button', { class: 'btn ghost small', onclick: () => saveAsTemplate(w, sub) }, t('t.saveTemplate'))) : null);
  }
  function addMeal(slotId, m) {
    S.day.meals.push({ id: uid(), slot: slotId, name: m.name, kcal: num(m.kcal), p: num(m.p), c: num(m.c), f: num(m.f) });
    saveDay(); closeSheet(); render(); toast(t('t.logged', { name: m.name }));
  }
  function removeMeal(id) {
    const gone = S.day.meals.find(m => m.id === id);
    S.day.meals = S.day.meals.filter(m => m.id !== id); saveDay(); render();
    if (gone) toast(t('t.removed', { name: gone.name }), { action: t('c.undo'), onAction: () => { S.day.meals.push(gone); saveDay(); render(); } });
  }
  function recentMeals() {
    const seen = new Set(), out = [];
    for (const d of allDays().reverse()) for (const m of d.meals.slice().reverse()) { const k = m.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m); } if (out.length >= 24) return out; }
    return out;
  }
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
              qty, h('button', { class: 'btn small primary', onclick: () => { const k = num(qty.value) || 1; addMeal(w.id, { name: k === 1 ? f.name : `${f.name} ×${k}`, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k }); } }, t('c.add')));
          }));
          if (!rows.length) list.append(h('p', { class: 'empty' }, S.foods.length ? t('t.noMatches') : t('t.noFoods')));
        };
        q.addEventListener('input', redraw); redraw(); pane.append(q, list); setTimeout(() => q.focus(), 50);
      } else if (tab === 'templates') {
        const tpls = S.templates.slice().sort(byName);
        pane.append(tpls.length ? h('div', { class: 'list' }, tpls.map(tp => h('div', { class: 'row pick' },
          h('div', { class: 'row-name' }, h('div', null, tp.name), h('div', { class: 'muted small' }, `${fmt(tp.kcal)} kcal · ${fmt(tp.p)} g`)),
          h('button', { class: 'btn ghost icon', 'aria-label': t('c.delete'), onclick: () => { store.deleteDoc('templates/' + tp.id); S.templates = store.list('templates'); draw('templates'); } }, '\u00d7'),
          h('button', { class: 'btn small primary', onclick: () => addMeal(w.id, tp) }, t('t.log'))))) : h('p', { class: 'empty' }, t('t.noTemplates')));
      } else {
        const m = { name: '', kcal: null, p: null, c: null, f: null };
        pane.append(textField(t('t.whatAte'), m, 'name'), h('div', { class: 'grid4' }, numField(t('c.kcal'), m, 'kcal'), numField(t('c.protein'), m, 'p'), numField(t('c.carbs'), m, 'c'), numField(t('c.fat'), m, 'f')),
          h('button', { class: 'btn primary', onclick: () => { if (!m.name.trim()) { toast(t('t.needName')); return; } addMeal(w.id, m); } }, t('t.log')));
      }
    };
    body.append(segmented(tabs.map(([v, l]) => ({ value: v, label: l })), recentMeals().length ? 'recent' : 'foods', draw), pane);
    draw(recentMeals().length ? 'recent' : 'foods');
    openSheet(t('t.addTo', { slot: w.name }), body);
  }
  function editMeal(m) {
    const d = clone(m);
    openSheet(t('t.editMeal'), h('div', null, textField(t('c.name'), d, 'name'),
      selectField(t('t.slot'), d, 'slot', S.settings.mealSlots.map(s => ({ value: s.id, label: s.name }))),
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const i = S.day.meals.findIndex(x => x.id === m.id); if (i >= 0) S.day.meals[i] = { ...d, kcal: num(d.kcal), p: num(d.p), c: num(d.c), f: num(d.f) }; saveDay(); closeSheet(); render(); toast(t('t.mealSaved')); } }, t('c.save')),
        h('button', { class: 'btn ghost danger', onclick: () => { closeSheet(); removeMeal(m.id); } }, t('c.remove')))));
  }
  function copyYesterday() {
    const prev = store.get('days/' + addDays(S.date, -1)); if (!prev) return;
    const meals = SC.normalizeDay(prev).meals.map(m => ({ ...m, id: uid() }));
    S.day.meals.push(...meals); saveDay(); render(); toast(t('t.copied', { n: meals.length }));
  }
  function saveAsTemplate(w, sub) {
    const tp = { name: w.name, ...sub };
    openSheet(t('t.saveTemplate'), h('div', null, textField(t('t.templateName'), tp, 'name'), h('p', { class: 'muted small' }, `${fmt(tp.kcal)} kcal · ${fmt(tp.p)}P ${fmt(tp.c)}C ${fmt(tp.f)}F`),
      h('button', { class: 'btn primary', onclick: () => { store.setDoc('templates/' + uid(), { name: tp.name, kcal: tp.kcal, p: tp.p, c: tp.c, f: tp.f, slot: w.id, updatedAt: store.stamp() }); S.templates = store.list('templates'); closeSheet(); toast(t('t.templateSaved')); } }, t('c.save'))));
  }

  /* training */
  function trainingList() {
    const st = S.settings, d = S.day, isToday = S.date === today(), past = S.date < today(), now = nowMin();
    const planned = SC.plannedFor(st, dow(S.date));
    const loggedTypes = new Set(d.sessions.map(s => s.typeId));
    const rows = [];
    planned.filter(p => !loggedTypes.has(p.type.id)).forEach(p => {
      const a = SC.hm(p.block.start), late = !past && isToday && a != null && a + (SC.duration(p.block) || 0) <= now;
      rows.push(h('div', { class: 'sess', style: { '--kc': kindColor(p.type.kind) } },
        h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, p.type.name, p.block.start ? h('small', { class: 'muted' }, ' ' + fmtTime(p.block.start)) : null,
          past ? h('span', { class: 'tag st-miss' }, t('t.missed')) : late ? h('span', { class: 'tag st-close' }, t('t.notLogged')) : null),
          h('div', { class: 'muted small' }, t('t.planned', { min: p.minutes, kcal: fmt(p.kcal) }))),
        h('div', { class: 'sess-actions' }, p.type.plan.length ? h('button', { class: 'btn small primary', onclick: () => sessionSheet(newSession(p.type, p.minutes, p.kcal), true) }, t('t.log')) : null,
          h('button', { class: 'btn small', onclick: () => markDone(p.type, p.minutes, p.kcal) }, t('t.markDone')))));
    });
    d.sessions.forEach(s => rows.push(h('div', { class: 'sess done', style: { '--kc': kindColor(s.kind) } },
      h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, s.name),
        h('div', { class: 'muted small' }, `${kindName(s.kind)} · ${num(s.minutes)} ${t('c.min')} · ${fmt(s.kcal)} kcal` + (s.sets && s.sets.length ? ` · ${t('t.setsCount', { n: s.sets.length })}` : '') + (s.notes ? ` · ${s.notes}` : ''))),
      h('div', { class: 'sess-actions' }, h('button', { class: 'btn small', onclick: () => sessionSheet(s, false) }, t('t.details')),
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => removeSession(s.id) }, '×')))));
    if (!rows.length) rows.push(h('p', { class: 'empty' }, t('t.nothingScheduled')));
    return h('div', { class: 'list' }, rows);
  }
  const newSession = (type, minutes, kcal) => ({ id: uid(), typeId: type.id, name: type.name, kind: type.kind || '', minutes: num(minutes != null ? minutes : type.minutes), kcal: num(kcal != null ? kcal : type.kcal), done: true, notes: '', sets: [] });
  function markDone(type, minutes, kcal) { S.day.sessions.push(newSession(type, minutes, kcal)); saveDay(); render(); }
  function removeSession(id) {
    const gone = S.day.sessions.find(s => s.id === id);
    S.day.sessions = S.day.sessions.filter(s => s.id !== id); saveDay(); render();
    if (gone) toast(t('t.removed', { name: gone.name }), { action: t('c.undo'), onAction: () => { S.day.sessions.push(gone); saveDay(); render(); } });
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
        if (x) { if (x.plan.length) { sessionSheet(newSession(x), true); return; } markDone(x); }
        else { if (!pick.name.trim()) { toast(t('t.needName')); return; } S.day.sessions.push({ id: uid(), typeId: '', name: pick.name, kind: pick.kind, minutes: num(pick.minutes), kcal: num(pick.kcal), done: true, notes: '', sets: [] }); saveDay(); render(); }
        closeSheet();
      } }, t('t.logSession')))));
  }
  /* session sheet: plan-driven rows (per exercise, per set, per side) plus free rows; isNew adds the session on save */
  function sessionSheet(s, isNew) {
    const d = clone(s); d.sets = d.sets || [];
    const type = S.settings.sessionTypes.find(x => x.id === d.typeId), plan = type ? type.plan : [];
    const groups = [];
    for (const b of plan) for (const it of b.items) { const ex = exById(it.exerciseId) || SC.resolveExercise(it.name, S.settings.exercises); groups.push({ key: it.exerciseId || it.name, block: b.label, item: it, ex, perSide: it.perSide, rows: [] }); }
    d.sets.forEach(r => { const g = groups.find(x => (r.exerciseId && x.key === r.exerciseId) || x.item.name === r.ex); if (g) g.rows.push(r); else { let f = groups.find(x => x.free && x.key === (r.exerciseId || r.ex)); if (!f) { f = { key: r.exerciseId || r.ex, free: true, item: { name: r.ex, sets: 0, reps: '', perSide: false }, ex: exById(r.exerciseId), perSide: !!(exById(r.exerciseId) || {}).perSide, rows: [] }; groups.push(f); } f.rows.push(r); } });
    for (const g of groups) if (!g.free && !g.rows.length) for (let i = 0; i < Math.max(1, g.item.sets); i++) g.rows.push({ ex: g.item.name, exerciseId: g.ex ? g.ex.id : '', wt: null, reps: null, reps2: null });
    const box = h('div');
    const rowEl = (g, r, i) => {
      const gap = () => { if (!g.perSide || r.reps == null || r.reps2 == null || !Math.max(r.reps, r.reps2)) return ''; const p = Math.round(Math.abs(r.reps - r.reps2) / Math.max(r.reps, r.reps2) * 100); return p + '%'; };
      const gapEl = h('span', { class: 'gap' }, gap());
      const upd = () => { gapEl.textContent = gap(); gapEl.classList.toggle('bad', parseInt(gapEl.textContent, 10) > 10); };
      return h('div', { class: 'setrow' }, h('span', { class: 'setno' }, i + 1),
        h('input', { type: 'number', placeholder: unit(), inputmode: 'decimal', 'aria-label': unit(), value: r.wt == null ? '' : r.wt, oninput: e => r.wt = e.target.value === '' ? null : num(e.target.value) }),
        h('input', { type: 'number', placeholder: g.perSide ? t('t.left') : t('t.reps'), inputmode: 'numeric', value: r.reps == null ? '' : r.reps, oninput: e => { r.reps = e.target.value === '' ? null : num(e.target.value); upd(); } }),
        g.perSide ? h('input', { type: 'number', placeholder: t('t.right'), inputmode: 'numeric', value: r.reps2 == null ? '' : r.reps2, oninput: e => { r.reps2 = e.target.value === '' ? null : num(e.target.value); upd(); } }) : null,
        g.perSide ? gapEl : null,
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { g.rows.splice(i, 1); draw(); } }, '\u00d7'));
    };
    const draw = () => box.replaceChildren(...groups.map(g => {
      const locked = g.ex && g.ex.gate && !SC.gateOpen(S.settings, g.ex.gate);
      const target = [g.item.sets ? `${g.item.sets} ×` : '', g.item.reps, g.perSide ? t('t.perSide') : '', g.item.rir ? `${g.item.rir} RIR` : '', g.item.rest].filter(Boolean).join(' · ');
      return h('div', { class: 'exgroup' + (locked ? ' locked' : '') },
        h('div', { class: 'exhead' }, g.block ? h('span', { class: 'blocklab' }, g.block) : null,
          g.ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(g.ex) }, g.item.name) : h('span', null, g.item.name),
          h('span', { class: 'muted small' }, target), locked ? h('span', { class: 'lock' }, t('t.locked', { gate: gateLabel(g.ex.gate) })) : null),
        g.item.note ? h('div', { class: 'muted small' }, g.item.note) : null,
        g.rows.map((r, i) => rowEl(g, r, i)),
        h('button', { class: 'btn ghost small', onclick: () => { const last = g.rows[g.rows.length - 1]; g.rows.push({ ex: g.item.name, exerciseId: g.ex ? g.ex.id : '', wt: last ? last.wt : null, reps: null, reps2: null }); draw(); } }, t('t.addSet')));
    }));
    draw();
    const addFree = () => { const ex = { name: '' }; openSheet(t('t.exercise'), h('div', null, exercisePicker(ex), h('button', { class: 'btn primary', onclick: () => { if (!ex.name.trim()) return; const e = SC.resolveExercise(ex.name, S.settings.exercises); groups.push({ key: e ? e.id : ex.name, free: true, item: { name: e ? e.name : ex.name, sets: 0, reps: '', perSide: false }, ex: e, perSide: !!(e && e.perSide), rows: [{ ex: e ? e.name : ex.name, exerciseId: e ? e.id : '', wt: null, reps: null, reps2: null }] }); open(); draw(); } }, t('c.add')))); };
    const open = () => openSheet(d.name, h('div', null, h('div', { class: 'grid2' }, numField(t('t.minutes'), d, 'minutes'), numField(t('t.kcalBurned'), d, 'kcal')),
      h('div', { class: 'subhead' }, t('t.sets')), box,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: addFree }, t('t.addExercise'))),
      h('label', { class: 'field' }, h('span', null, t('t.notes')), h('textarea', { value: d.notes || '', oninput: e => d.notes = e.target.value })),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        d.sets = groups.flatMap(g => g.rows).filter(r => r.wt != null || r.reps != null || r.reps2 != null).map(r => ({ ex: r.ex, exerciseId: r.exerciseId, wt: r.wt, reps: r.reps, reps2: r.reps2 }));
        const i = S.day.sessions.findIndex(x => x.id === d.id);
        const out = { ...d, minutes: num(d.minutes), kcal: num(d.kcal), notes: d.notes || '' };
        if (i >= 0) S.day.sessions[i] = out; else S.day.sessions.push(out);
        saveDay(); closeSheet(); render();
      } }, t('c.save')))), { wide: true });
    open();
  }
  function exercisePicker(obj) {
    const inp = h('input', { type: 'text', list: 'exlist', placeholder: t('t.exercise'), value: obj.name || '', oninput: e => obj.name = e.target.value });
    return h('label', { class: 'field' }, h('span', null, t('t.exercise')), inp, h('datalist', { id: 'exlist' }, S.settings.exercises.map(e => h('option', { value: e.name }))));
  }
  function exerciseCard(ex) {
    const locked = ex.gate && !SC.gateOpen(S.settings, ex.gate);
    const im = thumb(ex.image, 'exhero');
    openSheet(ex.name, h('div', { class: 'excard' }, im,
      ex.cues ? h('p', null, ex.cues) : null,
      h('p', { class: 'muted small' }, [ex.category, t('u.' + ex.unit), ex.perSide ? t('t.perSide') : null, ex.gate ? (locked ? t('t.locked', { gate: gateLabel(ex.gate) }) : t('t.unlocked', { gate: gateLabel(ex.gate) })) : null].filter(Boolean).join(' · ')),
      h('div', { class: 'actions' },
        ex.image && !isImageUrl(ex.image) ? h('a', { class: 'btn', href: ex.image, target: '_blank', rel: 'noopener' }, t('l.images')) : null,
        ex.video ? h('a', { class: 'btn', href: ex.video, target: '_blank', rel: 'noopener' }, t('l.video')) : null,
        h('button', { class: 'btn ghost', onclick: () => exerciseForm(ex) }, t('c.edit')))));
  }
  function bodyBlock() {
    const d = S.day, u = unit();
    const last = store.list('days').filter(x => (x.date || x.id) < S.date && x.weight != null).sort((a, b) => (a.date || a.id) < (b.date || b.id) ? 1 : -1)[0];
    const w = h('input', { type: 'number', step: '0.1', inputmode: 'decimal', placeholder: last ? t('t.lastWeight', { w: fmt1(last.weight) + ' ' + u }) : u, value: d.weight == null ? '' : d.weight, onchange: e => { d.weight = e.target.value === '' ? null : num(e.target.value); saveDay(); } });
    const n = h('textarea', { placeholder: t('t.notesPh'), value: d.note || '', onchange: e => { d.note = e.target.value; saveDay(); } });
    const has = Object.keys(d.measures).length;
    const meas = h('details', { class: 'inline', open: has ? true : null }, h('summary', null, t('t.measures'), h('small', { class: 'muted' }, ' ' + t('t.measuresSub'))),
      h('div', { class: 'grid3' }, SC.MEASURES.map(k => h('label', { class: 'field' }, h('span', null, t('m.' + k)), h('input', { type: 'number', step: '0.1', inputmode: 'decimal', value: d.measures[k] == null ? '' : d.measures[k], onchange: e => { if (e.target.value === '') delete d.measures[k]; else d.measures[k] = num(e.target.value); saveDay(); } })))));
    return h('div', null, h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('t.weight', { u })), w)), meas, h('label', { class: 'field' }, h('span', null, t('t.notes')), n));
  }

  /* ---------- Plan: the ideal week ---------- */
  function viewPlan() {
    const st = S.settings, wrap = h('div', { class: 'page' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('nav.plan')), h('div', { class: 'sub' }, t('pl.sub'))),
      h('button', { class: 'btn small' + (S.planEdit ? ' primary' : ''), onclick: () => { S.planEdit = !S.planEdit; render(); } }, S.planEdit ? t('c.done') : t('c.edit'))));
    const wave = SC.waveWeek(st.wave, today());
    if (st.wave.pattern.length || st.gates.length) {
      const body = h('div');
      if (st.wave.pattern.length) body.append(h('div', { class: 'wave' }, st.wave.pattern.map((ph, i) => h('div', { class: 'wave-cell' + (wave && wave.week === i + 1 ? ' on' : '') }, h('b', null, i + 1), h('span', null, t('pl.' + ph))))),
        h('p', { class: 'muted small' }, wave ? t('pl.cycle', { n: wave.cycle }) + ' · ' + waveLabel(wave) : t('pl.waveStarts', { d: st.wave.start ? fmtShort(st.wave.start) : '—' })));
      if (st.gates.length) body.append(h('div', { class: 'gates' }, st.gates.map(g => S.planEdit
        ? h('label', { class: 'field' }, h('span', null, g.name), h('select', { onchange: e => { const s = latest(), x = s.gates.find(y => y.id === g.id); if (!x) return; x.current = +e.target.value; saveSettingsNow(s); render(); toast(t('c.saved')); } }, g.stages.map((sname, i) => h('option', { value: i + 1, selected: g.current === i + 1 }, sname))))
        : h('span', { class: 'chip small on' }, `${g.name} · ${g.stages[g.current - 1] || g.current}`))));
      wrap.append(section(t('pl.wave'), st.gates.length ? t('pl.gatesSub') : null, body));
    }
    const cal = h('div', { class: 'calwrap' }); wrap.append(section(t('pl.calendar'), S.planEdit ? h('button', { class: 'btn small primary', onclick: () => blockForm(null) }, t('pl.addBlock')) : null, cal));
    drawCalendar(cal);
    const withPlans = st.sessionTypes.filter(x => x.plan.length);
    wrap.append(section(t('pl.workouts'), S.planEdit ? h('button', { class: 'btn small', onclick: () => workoutPick() }, t('pl.editWorkout')) : null,
      withPlans.length ? h('div', { class: 'list' }, withPlans.map(x => h('button', { class: 'row pick', onclick: () => workoutSheet(x) }, h('span', { class: 'row-name' }, x.name), h('span', { class: 'muted small' }, t('pl.blocksCount', { b: x.plan.length, e: x.plan.reduce((a, b) => a + b.items.length, 0) })))))
        : h('p', { class: 'empty' }, t('pl.noWorkoutsLib'), ' ', h('a', { href: '#workouts' }, t('l.addWorkout')))));
    return wrap;
  }
  function drawCalendar(cal) {
    const st = S.settings, wide = window.innerWidth >= 900;
    if (!st.calendar.length) { cal.replaceChildren(h('p', { class: 'empty' }, t('pl.empty'))); return; }
    const times = st.calendar.flatMap(b => [SC.hm(b.start), SC.hm(b.end)]).filter(x => x != null);
    const lo = Math.min(6 * 60, ...times.map(x => Math.floor(x / 60) * 60)), hi = Math.max(22 * 60, ...times.map(x => Math.ceil(x / 60) * 60));
    const blockEl = (b, positioned) => {
      const title = SC.blockTitle(b, st) || t('pl.' + b.kind), dur = SC.duration(b);
      const el = h('button', { class: 'cblock ' + KIND_CLASS[b.kind], onclick: () => blockSheet(b), title: title }, h('b', null, title), b.start ? h('span', null, `${fmtTime(b.start)}${b.end ? '–' + fmtTime(b.end) : ''}`) : null);
      if (positioned && b.start) { const a = SC.hm(b.start), z = a + (dur || 30); const end = Math.min(z, hi); el.style.top = ((a - lo) / (hi - lo) * 100) + '%'; el.style.height = Math.max(2.2, (end - a) / (hi - lo) * 100) + '%'; el.classList.add('pos'); }
      return el;
    };
    if (wide) {
      const hours = []; for (let m = lo; m < hi; m += 60) hours.push(h('div', { class: 'cal-hour', style: { top: ((m - lo) / (hi - lo) * 100) + '%' } }, fmtTime(String(m / 60).padStart(2, '0') + ':00')));
      cal.replaceChildren(h('div', { class: 'calgrid' }, h('div', { class: 'cal-axis' }, h('div', { class: 'cal-head' }), h('div', { class: 'cal-axis-in' }, hours)), DAYS.map(day => {
        const bs = SC.blocksFor(st, day), timed = bs.filter(b => b.start), untimed = bs.filter(b => !b.start);
        const wrapsOver = timed.filter(b => SC.hm(b.end) != null && SC.hm(b.end) < SC.hm(b.start));
        return h('div', { class: 'cal-day' + (day === dow(today()) ? ' today' : '') }, h('div', { class: 'cal-head' }, dayName(day)),
          untimed.length ? h('div', { class: 'cal-untimed' }, untimed.map(b => blockEl(b, false))) : null,
          h('div', { class: 'cal-col' }, hours.map(x => x.cloneNode(false)), timed.map(b => blockEl(b, true)),
            wrapsOver.map(b => { const el = blockEl({ ...b, start: String(Math.floor(lo / 60)).padStart(2, '0') + ':00' }, true); const z = SC.hm(b.end); el.style.top = '0%'; el.style.height = Math.max(2.2, (z - lo) / (hi - lo) * 100) + '%'; el.classList.add('cont'); return el; })));
      })));
    } else {
      const seg = segmented(DAYS.map(d => ({ value: d, label: dayName(d, 'narrow') })), S.planDay, v => { S.planDay = v; drawCalendar(cal); });
      const bs = SC.blocksFor(st, S.planDay);
      cal.replaceChildren(seg, h('div', { class: 'timeline' }, bs.length ? bs.map(b => { const dur = SC.duration(b); return h('button', { class: 'tl-row ' + KIND_CLASS[b.kind], onclick: () => blockSheet(b) },
        h('span', { class: 'tl-time' }, b.start ? fmtTime(b.start) : '·'), h('span', { class: 'tl-dot' }), h('span', { class: 'tl-title' }, SC.blockTitle(b, st) || t('pl.' + b.kind), dur ? h('small', null, ' ' + fmtDur(dur)) : null)); })
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
      S.planEdit ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => blockForm(b) }, t('c.edit')),
        h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.calendar = s.calendar.filter(x => x.id !== b.id); saveSettingsNow(s); closeSheet(); render(); } }, t('c.delete'))) : null);
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
        saveSettingsNow(s); closeSheet(); render(); toast(t('c.saved'));
      } }, t('c.save')))));
  }
  function workoutSheet(type) {
    const body = h('div', null, h('p', { class: 'muted small' }, `${kindName(type.kind)} · ${num(type.minutes)} ${t('c.min')} · ${fmt(type.kcal)} kcal`), type.note ? h('p', null, type.note) : null,
      type.plan.map(b => h('div', { class: 'wblock' }, h('div', { class: 'subhead' }, b.label, b.note ? h('small', { class: 'muted' }, ' ' + b.note) : null),
        h('div', { class: 'list' }, b.items.map(it => { const ex = exById(it.exerciseId) || SC.resolveExercise(it.name, S.settings.exercises); const locked = ex && ex.gate && !SC.gateOpen(S.settings, ex.gate);
          const target = [it.sets ? `${it.sets} ×` : '', it.reps, it.perSide ? t('t.perSide') : '', it.rir ? `${it.rir} RIR` : '', it.rest].filter(Boolean).join(' · ');
          return h('div', { class: 'row pick' + (locked ? ' locked' : '') }, ex ? thumb(ex.image, 'thumb sm') : null, h('span', { class: 'row-name' }, ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(ex) }, it.name) : it.name, h('div', { class: 'muted small' }, target, locked ? ' · ' + t('t.locked', { gate: gateLabel(ex.gate) }) : '', it.note ? ' · ' + it.note : ''))); })))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => workoutForm(type) }, t('c.edit'))));
    openSheet(type.name, body, { wide: true });
  }
  function workoutPick() {
    const st = S.settings;
    openSheet(t('pl.editWorkout'), h('div', { class: 'list' }, st.sessionTypes.map(x => h('button', { class: 'row pick', onclick: () => workoutForm(x) }, h('span', { class: 'row-name' }, x.name), h('span', { class: 'muted small' }, x.plan.length ? t('pl.blocksCount', { b: x.plan.length, e: x.plan.reduce((a, b) => a + b.items.length, 0) }) : t('pl.noPlan'))))));
  }
  /* blocks and their exercises; edits the given plan array in place */
  function planEditor(plan) {
    const st = S.settings, box = h('div');
    const exOptions = () => [{ value: '', label: '—' }, ...st.exercises.slice().sort(byName).map(e => ({ value: e.id, label: e.name }))];
    const draw = () => box.replaceChildren(...plan.map((b, bi) => h('div', { class: 'routine' },
      h('div', { class: 'editor-row' }, h('input', { type: 'text', placeholder: t('pl.blockLabel'), value: b.label, oninput: e => b.label = e.target.value }), h('input', { type: 'text', placeholder: t('f.note'), value: b.note || '', oninput: e => b.note = e.target.value }),
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { plan.splice(bi, 1); draw(); } }, '\u00d7')),
      h('div', { class: 'editor' }, b.items.map((it, ii) => h('div', { class: 'editor-row wrap' },
        h('select', { 'aria-label': t('t.exercise'), onchange: e => { it.exerciseId = e.target.value; const ex = exById(it.exerciseId); if (ex) { it.name = ex.name; it.perSide = ex.perSide; } draw(); } }, exOptions().map(o => h('option', { value: o.value, selected: o.value === it.exerciseId }, o.label))),
        it.exerciseId ? null : h('input', { type: 'text', placeholder: t('c.name'), value: it.name, oninput: e => it.name = e.target.value }),
        h('input', { type: 'number', class: 'xs', placeholder: t('t.sets'), inputmode: 'numeric', value: it.sets || '', oninput: e => it.sets = num(e.target.value) }),
        h('input', { type: 'text', class: 'xs', placeholder: t('t.reps'), value: it.reps, oninput: e => it.reps = e.target.value }),
        h('input', { type: 'text', class: 'xs', placeholder: 'RIR', value: it.rir, oninput: e => it.rir = e.target.value }),
        h('input', { type: 'text', class: 'xs', placeholder: t('pl.rest'), value: it.rest, oninput: e => it.rest = e.target.value }),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!it.perSide, onchange: e => it.perSide = e.target.checked }), t('t.perSide')),
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { b.items.splice(ii, 1); draw(); } }, '\u00d7')))),
      h('button', { class: 'btn ghost small', onclick: () => { b.items.push({ id: uid(), exerciseId: '', name: '', sets: 3, reps: '8-12', perSide: false, rir: '', rest: '', note: '' }); draw(); } }, t('s.addExercise')))),
      h('button', { class: 'btn small', onclick: () => { plan.push({ id: uid(), label: String.fromCharCode(65 + plan.length), note: '', items: [] }); draw(); } }, t('pl.addBlock')));
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
  const planCount = x => { const e = x.plan.reduce((a, b) => a + b.items.length, 0); return e ? t('pl.blocksCount', { b: x.plan.length, e }) : null; };
  const confirmDelete = (name, text, onYes) => confirmSheet(t('c.delete') + ' · ' + name, text, t('c.delete'), onYes, t('c.cancel'));
  function workoutsTab() {
    const st = S.settings, box = h('div');
    box.append(section(null, null, st.sessionTypes.length
      ? h('div', { class: 'list' }, st.sessionTypes.map(x => pickRow(x.name, [kindName(x.kind), x.minutes ? `${num(x.minutes)} ${t('c.min')}` : null, planCount(x)].filter(Boolean).join(' · '), () => workoutForm(x))))
      : h('p', { class: 'empty' }, t('l.noWorkouts'))));
    const editBtn = fn => h('button', { class: 'btn small', onclick: fn }, t('c.edit'));
    box.append(section(t('s.kinds'), editBtn(kindsSheet), st.sessionKinds.length ? h('div', { class: 'chips' }, st.sessionKinds.map(k => h('span', { class: 'chip small static' }, k.name))) : h('p', { class: 'empty' }, t('l.none'))));
    const wave = SC.waveWeek(st.wave, today());
    box.append(section(t('pl.wave'), editBtn(waveSheet), h('p', { class: 'muted small' }, st.wave.pattern.length ? st.wave.pattern.map(p => t('pl.' + p)).join(' · ') + (wave ? ' · ' + waveLabel(wave) : '') : t('l.none'))));
    box.append(section(t('s.gates'), editBtn(gatesSheet), st.gates.length ? h('div', { class: 'chips' }, st.gates.map(g => h('span', { class: 'chip small static' }, `${g.name} · ${g.stages[g.current - 1] || g.current}`))) : h('p', { class: 'empty' }, t('l.none'))));
    return box;
  }
  function saveAnd(next, then) { saveSettingsNow(next); closeSheet(); render(); toast(t('c.saved')); if (then) then(); }
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
        type ? h('button', { class: 'btn ghost danger', onclick: () => confirmDelete(type.name, t('l.deleteWorkout', { name: type.name }), () => { const s = latest(); s.sessionTypes = s.sessionTypes.filter(x => x.id !== type.id); saveAnd(s); }) }, t('c.delete')) : null)), { wide: true });
  }
  function kindsSheet() {
    const kinds = clone(S.settings.sessionKinds);
    openSheet(t('s.kinds'), h('div', null, listEditor(kinds, [{ key: 'name', label: t('s.kind') }], () => {}, t('s.addKind')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { const s = latest(); s.sessionKinds = kinds.filter(k => String(k.name || '').trim()); saveAnd(s); } }, t('c.save')))));
  }
  function waveSheet() {
    const w = { start: S.settings.wave.start || '', pattern: S.settings.wave.pattern.join(', ') };
    openSheet(t('pl.wave'), h('div', null, h('p', { class: 'muted small' }, t('s.waveSub')),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, t('s.waveStart')), h('input', { type: 'date', value: w.start, onchange: e => { w.start = e.target.value; } })),
        h('label', { class: 'field' }, h('span', null, t('s.wavePattern')), h('input', { type: 'text', value: w.pattern, placeholder: 'ramp, ramp, full, deload', oninput: e => { w.pattern = e.target.value; } }))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
        const s = latest();
        s.wave = { start: w.start || null, pattern: w.pattern.split(',').map(x => x.trim().toLowerCase()).filter(x => SC.WAVE.includes(x)) };
        saveAnd(s);
      } }, t('c.save')))));
  }
  function gatesSheet() {
    const draft = { gates: clone(S.settings.gates) };
    openSheet(t('s.gates'), h('div', null, h('p', { class: 'muted small' }, t('s.gatesSub')), gatesEditor(draft, () => {}),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { const s = latest(); s.gates = draft.gates.filter(g => String(g.name || '').trim()); saveAnd(s); } }, t('c.save')))));
  }
  function routinesTab() {
    const st = S.settings;
    return section(null, null, st.routines.length
      ? h('div', { class: 'list' }, st.routines.map(r => pickRow(r.name, [r.days.length ? r.days.map(x => dayName(x)).join(', ') : t('l.everyDay'), `${r.items.length} ${I.unit('l.items', r.items.length)}`].join(' · '), () => routineForm(r))))
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
      listEditor(d.items, [{ key: 'name', label: t('s.exercise') }, { key: 'target', label: t('s.setsReps'), small: true }], () => {}, t('s.addExercise')),
      h('div', { class: 'grid2 mt' }, numField(t('s.alertAt'), d, 'alertAt', null, '1'), textField(t('s.alertText'), d, 'alertText', null, t('c.optional'))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          const s = latest(), i = r ? s.routines.findIndex(x => x.id === r.id) : -1;
          if (!d.id) d.id = U.slug(d.name);
          if (i >= 0) s.routines[i] = d; else s.routines.push(d);
          saveAnd(s);
        } }, t('c.save')),
        r ? h('button', { class: 'btn ghost danger', onclick: () => confirmDelete(r.name, t('l.deleteRoutine', { name: r.name }), () => { const s = latest(); s.routines = s.routines.filter(x => x.id !== r.id); saveAnd(s); }) }, t('c.delete')) : null)), { wide: true });
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
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!String(d.name).trim()) { toast(t('t.needName')); return; }
          store.setDoc('templates/' + tp.id, { name: String(d.name).trim(), slot: d.slot || '', kcal: num(d.kcal), p: num(d.p), c: num(d.c), f: num(d.f), updatedAt: store.stamp() });
          S.templates = store.list('templates'); closeSheet(); render(); toast(t('c.saved'));
        } }, t('c.save')),
        h('button', { class: 'btn ghost danger', onclick: () => { store.deleteDoc('templates/' + tp.id); S.templates = store.list('templates'); closeSheet(); render(); toast(t('f.deleted', { name: tp.name })); } }, t('c.delete')))));
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
          saveSettingsNow(s); closeSheet(); render(); toast(t('c.saved'));
        } }, t('c.save')),
        ex ? h('button', { class: 'btn ghost danger', onclick: () => { const s = latest(); s.exercises = s.exercises.filter(x => x.id !== ex.id); saveSettingsNow(s); closeSheet(); render(); } }, t('c.delete')) : null)));
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
      rows.sort((a, b) => (textKey(key) ? String(a[key] || '').localeCompare(String(b[key] || ''), I.locale()) : num(a[key]) - num(b[key])) * dir);
      const cols = [['name', t('f.food')], ['serving', t('f.serving')], ['kcal', t('c.kcal'), 'n'], ['p', t('c.protein'), 'n'], ['c', t('c.carbs'), 'n'], ['f', t('c.fat'), 'n']];
      if (all) cols.splice(2, 0, ['category', t('f.category')]);
      const table = h('table', { class: 'foods' },
        h('thead', null, h('tr', null, cols.map(([k, lab, n]) => h('th', { class: (n ? 'n' : '') + (key === k ? ' on' : ''), onclick: () => { S.foodSort = key === k ? { key: k, dir: -dir } : { key: k, dir: textKey(k) ? 1 : -1 }; drawTable(); } }, lab + (key === k ? (dir === 1 ? ' ↑' : ' ↓') : ''))))),
        h('tbody', null, rows.map(f => h('tr', { onclick: () => foodActions(f) }, cols.map(([k, lab, n]) => h('td', { class: k === 'name' ? 'food' : k === 'serving' ? 'serving' : (n ? 'n' : '') }, textKey(k) ? (f[k] || '') : fmt(f[k])))))));
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
      h('p', { class: 'muted small' }, `${f.serving || ''}${f.serving ? ' · ' : ''}${fmt(f.kcal)} kcal · ${fmt(f.p)}P ${fmt(f.c)}C ${fmt(f.f)}F` + (f.note ? ` · ${f.note}` : '')),
      h('div', { class: 'subhead' }, t('f.logTo', { date: S.date === today() ? t('c.today').toLowerCase() : fmtShort(S.date) })), chips,
      h('div', { class: 'grid2 mt' }, numField(t('t.servings'), pick, 'qty', null, '0.5')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { const k = num(pick.qty) || 1; if (!pick.slot) { toast(t('t.noSlots')); return; } addMeal(pick.slot, { name: k === 1 ? f.name : `${f.name} ×${k}`, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k }); } }, t('f.logIt')),
        h('button', { class: 'btn', onclick: () => foodForm(f) }, t('c.edit')))));
  }
  function foodForm(f) {
    const cats = [...new Set(S.foods.map(x => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, I.locale()));
    const d = f ? clone(f) : { name: '', category: S.foodTab !== t('f.all') ? S.foodTab : (cats[0] || ''), serving: '', kcal: null, p: null, c: null, f: null, note: '' };
    const catIn = h('input', { type: 'text', list: 'cats', value: d.category || '', oninput: e => d.category = e.target.value });
    const dl = h('datalist', { id: 'cats' }, cats.map(c => h('option', { value: c })));
    openSheet(f ? t('f.editFood') : t('f.addFood'), h('div', null,
      textField(t('c.name'), d, 'name'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('f.category')), catIn, dl), textField(t('f.serving'), d, 'serving', null, t('f.servingPh'))),
      h('div', { class: 'grid4' }, numField(t('c.kcal'), d, 'kcal'), numField(t('c.protein'), d, 'p'), numField(t('c.carbs'), d, 'c'), numField(t('c.fat'), d, 'f')),
      textField(t('f.note'), d, 'note', null, t('c.optional')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => {
          if (!d.name.trim()) { toast(t('t.needName')); return; }
          const row = SC.normalizeFood({ ...d, id: f ? f.id : undefined }); const { id, ...rest } = row;
          store.setDoc('foods/' + id, { ...rest, updatedAt: store.stamp() }); S.foods = store.list('foods').sort(byName);
          closeSheet(); render(); toast(f ? t('f.updated', { name: d.name }) : t('f.added', { name: d.name }));
        } }, t('c.save')),
        f ? h('button', { class: 'btn ghost danger', onclick: () => { store.deleteDoc('foods/' + f.id); S.foods = store.list('foods').sort(byName); closeSheet(); render(); toast(t('f.deleted', { name: f.name })); } }, t('c.delete')) : null)));
  }

  /* ---------- Progress: this week, then the longer view ---------- */
  function rankSVG(r) {
    const n = Math.max(0, Math.min(r.maxSublevel || 0, r.sublevel || 0));
    const color = SC.BELT_COLORS[String(r.level || '').toLowerCase()];
    if (color) {
      const bar = String(r.level).toLowerCase() === 'black' ? '#B4423C' : '#141414';
      const tape = [...Array(Math.min(n, 6))].map((_, i) => `<rect x="${446 + i * 15}" y="8" width="7" height="44" fill="#F4F2EA"/>`).join('');
      return `<svg class="belt" viewBox="0 0 600 60" role="img" aria-label="${r.level} ${n}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="8" width="600" height="44" rx="5" fill="${color}" stroke="rgba(0,0,0,.28)"/><line x1="6" y1="18" x2="594" y2="18" stroke="rgba(0,0,0,.14)" stroke-width="1.5" stroke-dasharray="6 5"/><line x1="6" y1="42" x2="594" y2="42" stroke="rgba(0,0,0,.14)" stroke-width="1.5" stroke-dasharray="6 5"/><rect x="432" y="8" width="104" height="44" fill="${bar}"/>${tape}</svg>`;
    }
    const max = Math.max(1, r.maxSublevel || 1), gap = 6, w = (600 - gap * (max - 1)) / max;
    return `<svg class="belt" viewBox="0 0 600 60" role="img" aria-label="${r.level} ${n}/${max}" xmlns="http://www.w3.org/2000/svg">${[...Array(max)].map((_, i) => `<rect x="${(i * (w + gap)).toFixed(1)}" y="14" width="${w.toFixed(1)}" height="32" rx="6" fill="${i < n ? 'var(--accent)' : 'var(--track)'}"/>`).join('')}</svg>`;
  }
  function phaseFor(sub, phases) { let cur = null; for (const p of phases) if (sub >= p.minSublevel) cur = p; return cur; }
  function weekReview() {
    const st = S.settings, start = weekStart(S.weekDate), days = [...Array(7)].map((_, i) => addDays(start, i)), box = h('div');
    box.append(h('div', { class: 'dayhead' },
      h('button', { class: 'btn ghost icon', 'aria-label': t('w.prev'), onclick: () => { S.weekDate = addDays(S.weekDate, -7); render(); } }, '\u2039'),
      h('div', { class: 'daytitle' }, h('h1', null, start === weekStart(today()) ? t('w.thisWeek') : t('w.weekOf', { d: fmtShort(start) })), h('div', { class: 'sub' }, `${fmtShort(start)} – ${fmtShort(days[6])}`)),
      h('button', { class: 'btn ghost icon', 'aria-label': t('w.next'), onclick: () => { S.weekDate = addDays(S.weekDate, 7); render(); } }, '\u203a')));
    const byDate = {}; store.query('days', [['date', '>=', start], ['date', '<=', days[6]]], ['date', 'asc'], 14).forEach(x => byDate[x.date || x.id] = SC.normalizeDay(x, x.date || x.id));
    let kcalSum = 0, pSum = 0, nDays = 0, sessions = 0, minutes = 0, habDone = 0, habTot = 0;
    const items = days.map(d => { const day = byDate[d]; const v = day ? totals(day).kcal : 0; return { label: dayName(dow(d), 'narrow'), value: v, hit: !st.targets.kcal || v >= st.targets.kcal * 0.9, color: d === today() ? 'var(--accent)' : 'var(--accent2)' }; });
    if (items.some(i => i.value > 0)) box.append(section(t('w.calories'), null, svg(bars(items, { target: st.targets.kcal, height: 140, label: t('w.calories') }))));
    box.append(h('div', { class: 'week' }, days.map(d => {
      const day = byDate[d]; let body;
      if (!day) body = h('div', { class: 'wday-body' }, h('span', { class: 'muted' }, d > today() ? t('w.upcoming') : t('w.nothing')));
      else {
        const x = totals(day), done = day.sessions.filter(s => s.done !== false), hd = habitsDone(day);
        if (day.meals.length) { kcalSum += x.kcal; pSum += x.p; nDays++; }
        sessions += done.length; minutes += done.reduce((a, s) => a + num(s.minutes), 0);
        if (d <= today()) { habDone += hd; habTot += st.habits.length; }
        const kcalHit = st.targets.kcal > 0 && x.kcal >= st.targets.kcal * 0.95, pHit = st.targets.protein > 0 && x.p >= st.targets.protein * 0.95;
        body = h('div', { class: 'wday-body' },
          h('span', null, day.meals.length ? [h('b', { class: kcalHit ? 'hit' : '' }, fmt(x.kcal)), ' kcal · ', h('b', { class: pHit ? 'hit' : '' }, fmt(x.p)), ' g'] : t('w.noMeals')),
          h('span', null, done.length ? done.map(s => s.name).join(', ') : t('w.noTraining')),
          st.habits.length ? h('span', null, t('w.habits', { a: hd, b: st.habits.length })) : null,
          day.weight != null ? h('span', null, `${fmt1(day.weight)} ${unit()}`) : null);
      }
      return h('button', { class: 'wday' + (d === today() ? ' today' : '') + (d > today() ? ' future' : ''), onclick: () => { S.date = d; loadDay(d); location.hash = '#today'; } },
        h('div', { class: 'wday-date' }, dayName(dow(d)), h('span', null, fmtDay(d))), body);
    })), h('div', { class: 'stats' },
      statCard(nDays ? fmt(kcalSum / nDays) : '–', t('w.avgKcal'), `${nDays} ${t('w.loggedDays')}`),
      statCard(nDays ? fmt(pSum / nDays) : '–', t('w.avgProtein')),
      statCard(String(sessions), t('w.sessions'), t('w.hours', { h: fmt1(minutes / 60) })),
      statCard(habTot ? Math.round(habDone / habTot * 100) + '%' : '–', t('w.adherence'))));
    return box;
  }
  function viewProgress() {
    const st = S.settings, wrap = h('div', { class: 'page' }), u = unit();
    wrap.append(weekReview());
    const goalText = st.goal.weight ? t('p.toward', { w: st.goal.weight, u }) + (st.goal.bodyFat ? ' ' + t('p.atBf', { bf: st.goal.bodyFat }) : '') : t('p.noGoal');
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('p.title')), h('div', { class: 'sub' }, goalText + (st.goal.note ? ' · ' + st.goal.note : ''))),
      editBtn(goalSheet, st.goal.weight ? t('p.editGoal') : t('p.setGoalBtn'))));
    const r = st.rank;
    if (r.enabled) {
      const phase = phaseFor(r.sublevel, r.phases), next = r.phases.find(p => p.minSublevel > r.sublevel);
      const sub = r.maxSublevel > 0 ? ` · ${r.sublevel} ${r.sublevelName}` : '';
      wrap.append(section(r.system || t('p.rank'), h('div', { class: 'head-r' }, h('button', { class: 'btn small', onclick: promote }, t('s.promoted')), editBtn(rankSheet)), h('div', null, svg(rankSVG(r)),
        h('p', null, `${r.level || t('p.unranked')}${sub}` + (phase ? ` · ${phase.name}` : '') + (next ? ` · ${t('p.phaseAt', { phase: next.name, n: next.minSublevel, sub: r.sublevelName })}` : '')),
        r.history.length ? h('p', { class: 'muted small' }, t('p.history') + ': ' + r.history.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => `${x.level}${x.sublevel != null ? ' ' + x.sublevel : ''} · ${fmtShort(x.date)}`).join(', ')) : null)));
    }
    const all = allDays().filter(d => d.date >= addDays(today(), -90) && d.date <= today());
    const from30 = addDays(today(), -29), last30 = all.filter(d => d.date >= from30), fed = last30.filter(d => d.meals.length);
    const kcal = fed.reduce((a, d) => a + totals(d).kcal, 0), p = fed.reduce((a, d) => a + totals(d).p, 0);
    const done = last30.flatMap(d => d.sessions.filter(s => s.done !== false));
    const habTot = st.habits.length, logged = last30.filter(d => Object.keys(d.habits).length || d.meals.length || d.sessions.length);
    const adh = habTot && logged.length ? Math.round(logged.reduce((a, d) => a + habitsDone(d), 0) / (logged.length * habTot) * 100) : null;
    const byDate = {}; all.forEach(d => byDate[d.date] = d);
    const complete = d => byDate[d] && habTot && habitsDone(byDate[d]) === habTot;
    let streak = 0, cur = complete(today()) ? today() : addDays(today(), -1);
    while (complete(cur)) { streak++; cur = addDays(cur, -1); }
    const kindCards = st.sessionKinds.map(k => { const ss = done.filter(s => s.kind === k.id); if (!ss.length) return null; return statCard(String(ss.length), t('p.kindSessions', { kind: k.name }), t('w.hours', { h: fmt1(ss.reduce((a, s) => a + num(s.minutes), 0) / 60) })); }).filter(Boolean);
    const other = done.filter(s => !st.sessionKinds.some(k => k.id === s.kind));
    wrap.append(section(t('p.last30'), null, h('div', { class: 'stats' },
      statCard(fed.length ? fmt(kcal / fed.length) : '–', t('p.avgCalories'), t('p.loggedDays', { n: fed.length })),
      statCard(fed.length ? fmt(p / fed.length) : '–', t('w.avgProtein')),
      kindCards, other.length ? statCard(String(other.length), t('p.otherSessions')) : null,
      statCard(adh == null ? '–' : adh + '%', t('p.adherence')),
      statCard(String(streak), t('p.streak'), t('p.streakSub')))));
    if (fed.length) {
      const items = [...Array(30)].map((_, i) => { const d = addDays(from30, i); const day = byDate[d]; const v = day ? totals(day).kcal : 0; return { label: i % 7 === 0 ? fmtDay(d) : '', value: v, hit: !st.targets.kcal || v >= st.targets.kcal * 0.9, color: 'var(--accent2)' }; });
      wrap.append(section(t('p.calories'), null, svg(bars(items, { target: st.targets.kcal, height: 150, label: t('p.calories') }))));
    }
    const pts = all.filter(d => d.weight != null).map(d => ({ date: d.date, v: num(d.weight) }));
    const box = h('div');
    if (!pts.length) box.append(h('p', { class: 'empty' }, t('p.logWeight')));
    else {
      const latest = pts[pts.length - 1], first = pts[0], delta = Math.round((latest.v - first.v) * 10) / 10, g = num(st.goal.weight);
      const last7 = pts.slice(-7), avg7 = last7.reduce((a, q) => a + q.v, 0) / last7.length, band = st.goal.band;
      box.append(svg(trend(pts, { goal: g || null, goalLabel: g ? `${g} ${u}` : '', label: t('p.bodyweight') })),
        h('p', { class: 'muted small' }, [t('p.latest', { w: fmt1(latest.v), u }), pts.length > 1 ? t('p.change', { d: (delta >= 0 ? '+' : '') + fmt1(delta), u, date: fmtShort(first.date) }) : null, g ? t('p.toGoal', { d: fmt1(Math.round((g - latest.v) * 10) / 10), u }) : null].filter(Boolean).join(' · ') + ` · ${t('p.avg7')}`));
      if (band) { const state = avg7 < band[0] ? 'below' : avg7 > band[1] ? 'above' : 'inside'; box.append(h('div', { class: 'notice soft ' + (state === 'inside' ? '' : 'warn') }, h('span', null, t('p.band' + state.charAt(0).toUpperCase() + state.slice(1), { avg: fmt1(avg7), u, lo: band[0], hi: band[1] })))); }
    }
    wrap.append(section(t('p.bodyweight'), t('p.last90'), box));
    const measured = allDays().filter(d => Object.keys(d.measures).length);
    {
      const mbox = h('div');
      if (!measured.length && !st.goal.milestones.length) mbox.append(h('p', { class: 'empty' }, t('p.noBodyComp')));
      if (measured.length) {
        const latest = measured[measured.length - 1], first = measured[0];
        mbox.append(h('div', { class: 'stats' }, SC.MEASURES.filter(k => latest.measures[k] != null).map(k => { const f = measured.find(d => d.measures[k] != null); const dlt = f && f !== latest ? latest.measures[k] - f.measures[k] : null; return statCard(fmt1(latest.measures[k]), t('m.' + k), dlt == null ? fmtShort(latest.date) : `${dlt >= 0 ? '+' : ''}${fmt1(dlt)} · ${fmtShort(f.date)}`); })));
        const waist = measured.filter(d => d.measures.waist != null).map(d => ({ date: d.date, v: d.measures.waist }));
        if (waist.length > 1) mbox.append(h('div', { class: 'subhead' }, t('m.waist')), svg(trend(waist, { label: t('m.waist') })));
      }
      if (st.goal.milestones.length) mbox.append(h('div', { class: 'subhead' }, t('p.milestones')), h('table', { class: 'plain' }, h('tbody', null, st.goal.milestones.map(m => h('tr', null, h('td', null, m.label), h('td', { class: 'n' }, m.bodyFat != null ? `${m.bodyFat}%` : ''), h('td', { class: 'n muted' }, m.weight != null ? `${m.weight} ${u}` : ''), h('td', { class: 'n muted' }, m.lean != null ? `${m.lean} / ${m.fat != null ? m.fat : '–'}` : ''))))));
      wrap.append(section(t('p.bodyComp'), editBtn(milestonesSheet, t('p.editMilestones')), mbox));
    }
    const weeks = [...Array(8)].map((_, i) => weekStart(addDays(today(), -7 * (7 - i))));
    const tw = weeks.map(ws => { const we = addDays(ws, 6); const mins = all.filter(d => d.date >= ws && d.date <= we).flatMap(d => d.sessions.filter(s => s.done !== false)).reduce((a, s) => a + num(s.minutes), 0); return { label: fmtShort(ws), value: mins, color: 'var(--blue)' }; });
    wrap.append(section(t('p.training'), null, tw.some(x => x.value) ? svg(bars(tw, { height: 140, label: t('p.training') })) : h('p', { class: 'empty' }, t('p.noTraining'))));
    if (habTot) {
      const map = {}; all.forEach(d => { if (Object.keys(d.habits).length || d.meals.length || d.sessions.length) map[d.date] = habitsDone(d) / habTot; });
      wrap.append(section(t('p.habitsHeat'), null, svg(heat(map, 12, today()))));
    }
    if (!r.enabled) wrap.append(h('div', { class: 'actions center' }, h('button', { class: 'btn ghost small', onclick: () => rankSheet(true) }, t('p.trackRank'))));
    return wrap;
  }
  function goalSheet() {
    const g = clone(S.settings.goal), u = unit(), band = { lo: g.band ? g.band[0] : null, hi: g.band ? g.band[1] : null };
    openSheet(t('s.goal'), h('div', null,
      h('div', { class: 'grid2' }, numField(t('s.goalWeight', { u }), g, 'weight'), numField(t('s.goalBf'), g, 'bodyFat')),
      h('div', { class: 'grid2' }, numField(t('s.bandLo', { u }), band, 'lo'), numField(t('s.bandHi', { u }), band, 'hi')),
      h('p', { class: 'muted small' }, t('s.bandHelp')),
      textField(t('s.goalNote'), g, 'note'),
      saveRow(() => { const s = latest(); s.goal = { ...s.goal, weight: g.weight, bodyFat: g.bodyFat, note: g.note, band: band.lo != null && band.hi != null ? [band.lo, band.hi] : null }; saveAnd(s); })));
  }
  function milestonesSheet() {
    const ms = clone(S.settings.goal.milestones), u = unit();
    openSheet(t('p.milestones'), h('div', null, h('p', { class: 'muted small' }, t('s.milestonesSub')),
      listEditor(ms, [{ key: 'label', label: t('s.milestone') }, { key: 'bodyFat', label: '% ' + t('c.fat'), type: 'number', small: true }, { key: 'weight', label: u, type: 'number', small: true }], () => {}, t('s.addMilestone')),
      saveRow(() => { const s = latest(); s.goal.milestones = ms.filter(m => String(m.label || '').trim() || m.bodyFat != null || m.weight != null); saveAnd(s); })));
  }
  function rankSheet(turnOn) {
    const draft = { rank: clone(S.settings.rank) };
    if (turnOn === true) draft.rank.enabled = true;
    openSheet(t('s.rank'), h('div', null, h('p', { class: 'muted small' }, t('s.rankSub')), rankEditor(draft, () => {}),
      saveRow(() => { const s = latest(); s.rank = draft.rank; saveAnd(s); })), { wide: true });
  }
  /* one more stripe (or whatever the sub-level is called), dated today; undo puts the rank back */
  function promote() {
    const s = latest(), before = clone(s.rank), r = s.rank;
    r.sublevel = num(r.sublevel) + 1; r.history.push({ id: uid(), date: today(), level: r.level, sublevel: r.sublevel });
    saveSettingsNow(s); render();
    toast(t('s.recorded', { level: r.level, n: r.sublevel }), { action: t('c.undo'), onAction: () => { const b = latest(); b.rank = before; saveSettingsNow(b); render(); } });
  }

  /* ---------- Settings ---------- */
  /* Only what applies to the whole profile or app. Everything else is edited on the page that shows it. Saves at once. */
  function viewSettings() {
    const wrap = h('div', { class: 'page settings' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('s.title')), h('div', { class: 'sub' }, t('s.sub')))));
    wrap.append(section(t('s.profile'), null, profileBlock()));
    wrap.append(section(t('s.app'), null, appBlock()));
    wrap.append(syncCard());
    wrap.append(section(t('s.data'), h('small', { class: 'storedin' }, storedInText()), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: exportSheet }, t('s.export')),
      h('button', { class: 'btn', onclick: () => openSheet(t('i.title'), importPanel(() => { closeSheet(); render(); }), { wide: true }) }, t('s.import')),
      h('a', { class: 'btn', href: '#start' }, t('nav.start')),
      h('button', { class: 'btn danger', onclick: () => confirmSheet(t('s.erase'), t('s.eraseConfirm') + cloudNote(), t('s.eraseBtn'), async () => { await store.eraseProfile(); hydrate(); location.hash = '#start'; render(); updateSyncUI(); toast(t('s.erased')); }, t('c.cancel')) }, t('s.erase')))));
    return wrap;
  }
  /* this profile's name and weight unit, then the other profiles on this device */
  function profileBlock() {
    const prof = store.currentProfile(), list = h('div', { class: 'list' });
    const name = h('input', { type: 'text', value: prof.name || '', placeholder: t('c.optional'), onchange: e => { store.renameProfile(prof.id, e.target.value.trim()); refreshProfileButton(); drawList(); flashSaved(); } });
    const unitSel = h('select', { onchange: e => changeUnit(e.target.value) }, [['lb', t('s.lb')], ['kg', t('s.kg')]].map(([v, l]) => h('option', { value: v, selected: v === unit() }, l)));
    const drawList = () => {
      const profs = store.profiles(), cur = store.currentProfile().id;
      list.replaceChildren(...profs.map(p => h('div', { class: 'row pick' },
        h('div', { class: 'row-name' }, p.name || t('s.profile'), p.id === cur ? h('span', { class: 'badge' }, t('s.current')) : null),
        p.id !== cur ? h('button', { class: 'btn small', onclick: () => switchProfile(p.id) }, t('s.switch')) : null,
        profs.length > 1 ? h('button', { class: 'btn ghost icon', 'aria-label': t('s.deleteProfile'), onclick: () => confirmSheet(t('s.deleteProfile'), t('s.deleteProfileConfirm', { name: p.name || t('s.profile') }) + cloudNote(p.id), t('c.delete'), async () => { const was = store.currentProfile().id; await store.deleteProfile(p.id); hydrate(); rerenderAll(); if (store.currentProfile().id !== was) MB.sync.profileChanged(); }, t('c.cancel')) }, '×') : null)));
    };
    drawList();
    return h('div', null,
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('s.profileName')), name), h('label', { class: 'field' }, h('span', null, t('s.unit')), unitSel)),
      h('div', { class: 'subhead' }, t('s.profiles')), h('p', { class: 'muted small' }, t('s.profilesSub')), list,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => newProfileSheet() }, t('s.addProfile'))));
  }
  /* switching units converts the goal and every logged weight, so the numbers keep meaning the same */
  function changeUnit(to) {
    const from = unit(); if (to === from) return;
    const s = latest(); s.units.weight = to;
    if (s.goal.weight != null) s.goal.weight = SC.convertWeight(s.goal.weight, from, to);
    if (s.goal.band) s.goal.band = s.goal.band.map(v => SC.convertWeight(v, from, to));
    s.goal.milestones = s.goal.milestones.map(m => ({ ...m, weight: SC.convertWeight(m.weight, from, to) }));
    const ups = store.list('days').filter(d => d.weight != null).map(d => { const { id, ...rest } = d; return ['days/' + (d.date || id), { ...rest, weight: SC.convertWeight(num(d.weight), from, to), updatedAt: store.stamp() }]; });
    if (ups.length) store.bulk({ upserts: ups });
    saveSettingsNow(s); loadDay(S.date);
    toast(ups.length ? t('s.converted', { n: ups.length, u: to }) : t('c.saved'));
  }
  function gatesEditor(draft, dirty) {
    const box = h('div', { class: 'editor' });
    const draw = () => box.replaceChildren(...draft.gates.map((g, i) => h('div', { class: 'editor-row wrap' },
      h('input', { type: 'text', placeholder: t('c.name'), value: g.name, oninput: e => { g.name = e.target.value; dirty(); } }),
      h('input', { type: 'text', placeholder: t('s.stages'), value: g.stages.join(', '), oninput: e => { g.stages = e.target.value.split(',').map(s => s.trim()).filter(Boolean); dirty(); } }),
      h('input', { type: 'number', class: 'xs', placeholder: '#', min: 1, value: g.current, oninput: e => { g.current = num(e.target.value) || 1; dirty(); } }),
      h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { draft.gates.splice(i, 1); dirty(); draw(); } }, '\u00d7'))),
      h('div', null, h('button', { class: 'btn small', onclick: () => { draft.gates.push({ id: uid(), name: '', stages: [], current: 1 }); dirty(); draw(); } }, t('s.addGate'))));
    draw();
    return box;
  }
  function appBlock() {
    const langSel = h('select', { onchange: e => { I.set(e.target.value); rerenderAll(); } }, Object.entries(I.LANGS).map(([c, n]) => h('option', { value: c, selected: c === I.lang }, n)));
    const themeSeg = segmented([{ value: 'auto', label: t('s.followDevice') }, { value: 'light', label: t('s.light') }, { value: 'dark', label: t('s.dark') }], themePref(), applyTheme);
    return h('div', { class: 'grid2 stack' }, h('label', { class: 'field' }, h('span', null, t('s.language')), langSel), h('div', { class: 'field' }, h('span', null, t('s.theme')), themeSeg));
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
  function rankEditor(draft, dirty) {
    const r = draft.rank, box = h('div'), body = h('div', { style: { display: r.enabled ? 'block' : 'none' } });
    const levelSel = h('select', { onchange: e => { r.level = e.target.value; dirty(); } });
    const drawLevels = () => levelSel.replaceChildren(...(r.levels.length ? r.levels : ['']).map(l => h('option', { value: l, selected: l === r.level }, l || t('s.setLevels'))));
    drawLevels();
    body.append(
      h('div', { class: 'grid2' }, textField(t('s.system'), r, 'system', dirty, t('s.systemPh')),
        h('label', { class: 'field' }, h('span', null, t('s.levels')), h('input', { type: 'text', value: r.levels.join(', '), placeholder: 'White, Blue, Purple, Brown, Black', oninput: e => { r.levels = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (!r.levels.includes(r.level)) r.level = r.levels[0] || ''; drawLevels(); dirty(); } }))),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('s.currentLevel')), levelSel), textField(t('s.sublevelName'), r, 'sublevelName', dirty, t('s.sublevelPh'))),
      h('div', { class: 'grid2' }, numField(t('s.sublevel'), r, 'sublevel', dirty, '1'), numField(t('s.maxSublevel'), r, 'maxSublevel', dirty, '1')),
      h('div', { class: 'subhead' }, t('s.phases'), ' ', helpTip(t('s.phasesSub'))),
      listEditor(r.phases, [{ key: 'name', label: t('s.phaseName') }, { key: 'minSublevel', label: t('s.from'), type: 'number', small: true }], dirty, t('s.addPhase')),
      h('div', { class: 'subhead' }, t('s.history')),
      listEditor(r.history, [{ key: 'date', label: 'Date', type: 'date' }, { key: 'level', label: t('s.currentLevel') }, { key: 'sublevel', label: '#', type: 'number', small: true }], dirty, t('s.addPromotion')));
    box.append(h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: !!r.enabled, onchange: e => { r.enabled = e.target.checked; body.style.display = r.enabled ? 'block' : 'none'; dirty(); } }), h('span', { class: 'row-name' }, t('s.showRank'))), body);
    return box;
  }
  /* ---------- Sync: status dot, Settings card, changes from other devices and tabs ---------- */
  const syncStateText = st => st.state === 'pending' ? t('sy.st.pending', { n: st.pending }) : t('sy.st.' + st.state);
  function syncErrorText(e) {
    const code = e && e.code;
    if (code === 'server') return t('sy.err.server', { status: e.status || '?' });
    if (code === 'tooLarge') return t('sy.err.tooLarge', { path: e.path || '' });
    if (code === 'badKey') return t('sy.badKey');
    return t(['key', 'invite', 'offline', 'timeout'].includes(code) ? 'sy.err.' + code : 'sy.err.local');
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
      body.append(h('p', { class: 'muted' }, t('sy.intro')), h('div', { class: 'actions' },
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
    if (paths.includes('settings/main')) S.settings = SC.normalizeSettings(store.get('settings/main'));
    if (paths.some(p => p.startsWith('foods/'))) S.foods = store.list('foods').sort(byName);
    if (paths.some(p => p.startsWith('templates/'))) S.templates = store.list('templates');
    if (paths.includes('days/' + S.date)) loadDay(S.date);
    const r = S.route, shows = p => p === 'settings/main' || (p.startsWith('days/') && (r === 'today' || r === 'progress')) || (p.startsWith('foods/') && r === 'library') || (p === 'm/profiles' && r === 'settings');
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
    const hasData = !!(S.foods.length || S.settings.habits.length || S.settings.sessionTypes.length || S.settings.mealSlots.length);
    const loadExample = async () => { const r = SC.planImport(SC.starterProfile(), { mode: 'replace', current: current() }); if (!r.ok) return; await applyPlan(r.plan); toast(t('g.exampleLoaded')); location.hash = '#today'; };
    wrap.append(h('div', { class: 'tiles' },
      h('button', { class: 'tile', onclick: () => hasData ? confirmSheet(t('g.example'), t('g.replaceExample'), t('g.example'), loadExample, t('c.cancel')) : loadExample() }, h('b', null, t('g.example')), h('span', null, t('g.exampleSub'))),
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
      const cur = st.into === 'new' ? { settings: SC.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [] } : current();
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
    await store.bulk({ upserts, deletes });
    hydrate(); S.foodTab = t('f.all');
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
    s_body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 10.5a5 5 0 0 1 7 0M12 10.5l1.5-2"/></svg>'
  };
  const NAV = ['today', 'plan', 'progress', 'library', 'settings'], ROUTES = [...NAV, 'start'], ALIAS = { week: 'progress' };
  function shell() {
    const langSel = h('select', { class: 'lang', 'aria-label': t('s.language'), onchange: e => { I.set(e.target.value); rerenderAll(); } }, Object.entries(I.LANGS).map(([c, n]) => h('option', { value: c, selected: c === I.lang }, n)));
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, MB.APP.name),
        h('button', { class: 'syncdot hidden', type: 'button', onclick: syncDotTap }, h('i', { 'aria-hidden': 'true' }), h('span', { class: 'syncdot-n' })),
        h('span', { class: 'status', 'data-state': '' }, '')),
      h('div', { class: 'topbar-actions' },
        profileButton(),
        h('button', { class: 'btn ghost icon theme-btn', 'aria-label': t('s.theme'), onclick: toggleTheme, html: effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon }),
        langSel));
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
    try { main.replaceChildren(VIEWS[S.route]()); }
    catch (e) { console.error(e); main.replaceChildren(h('p', { class: 'empty pad' }, 'Something went wrong drawing this page.')); }
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === S.route));
    window.scrollTo(0, y);
  }
  function rerenderAll() { const app = $('.app'); if (app) app.remove(); document.body.append(shell()); setStatus(storageLabel(), ''); render(); updateSyncUI(); }
  /* #workouts, #routines, #exercises and #foods open that Library tab */
  const routeFromHash = () => { let r = location.hash.replace('#', '').split('?')[0]; if (LIB[r]) { S.libTab = r; r = 'library'; } else if (ALIAS[r]) r = ALIAS[r]; return ROUTES.includes(r) ? r : 'today'; };
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
    await store.init();
    document.body.append(shell());
    store.onerror = () => setStatus(t('c.saveFailed'), 'error');
    hydrate();
    const firstRun = !store.get('settings/main') && !store.count();
    if (firstRun && !location.hash) location.hash = '#start';
    S.route = routeFromHash();
    setStatus(storageLabel(), '');
    render();
    window.addEventListener('hashchange', () => { const r = routeFromHash(); if (r !== S.route || r === 'library') { if (r !== 'plan') S.planEdit = false; S.route = r; closeSheet(); render(); window.scrollTo(0, 0); } });
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
