/* Tally — pages, routing, import/export and boot. Depends on MB.ui, MB.i18n, MB.schema, MB.store */
(() => {
  'use strict';
  const U = MB.ui, SC = MB.schema, store = MB.store, I = MB.i18n, t = I.t;
  const { $, h, svg, uid, clone, fmt, fmt1, num, byName, today, addDays, dow, DAYS, dayName, fmtLong, fmtShort, fmtDay, fmtTime, weekStart, thumb, isImageUrl,
    openSheet, closeSheet, toast, confirmSheet, section, statCard, numField, textField, selectField, segmented, helpTip, listEditor, ring, bars, trend, heat } = U;

  const S = { route: 'today', date: today(), weekDate: today(), settings: SC.normalizeSettings(null), settingsDraft: null, settingsDirty: false,
    day: SC.emptyDay(today()), foods: [], templates: [], foodTab: 'All', foodQ: '', foodSort: { key: 'name', dir: 1 }, libTab: 'exercises', exQ: '', planDay: dow(today()), planEdit: false,
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
    S.settingsDirty = false; S.settingsDraft = null;
    loadDay(S.date);
  }
  function loadDay(date) { const d = store.get('days/' + date); S.day = d ? SC.normalizeDay(d, date) : SC.emptyDay(date); }
  function saveDay() { S.day.date = S.date; S.day.updatedAt = new Date().toISOString(); store.setDoc('days/' + S.date, S.day); flashSaved(); }
  function saveSettingsNow(next) { S.settings = SC.normalizeSettings(next); S.settings.updatedAt = new Date().toISOString(); store.setDoc('settings/main', S.settings); flashSaved(); }
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
  function viewToday() {
    const st = S.settings, wrap = h('div', { class: 'page' }), isToday = S.date === today(), wave = SC.waveWeek(st.wave, S.date);
    const sub = [isToday ? fmtLong(S.date) : null, wave ? waveLabel(wave) : null].filter(Boolean).join(' · ');
    wrap.append(h('div', { class: 'dayhead' },
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.prev'), onclick: () => setDate(addDays(S.date, -1)) }, '\u2039'),
      h('div', { class: 'daytitle' }, h('h1', null, isToday ? t('c.today') : fmtLong(S.date)),
        h('div', { class: 'sub' }, isToday ? sub : [h('button', { class: 'linkbtn', onclick: () => setDate(today()) }, t('t.backToToday')), wave ? ' · ' + waveLabel(wave) : null])),
      h('button', { class: 'btn ghost icon', 'aria-label': t('t.next'), onclick: () => setDate(addDays(S.date, 1)) }, '\u203a')));
    const day = S.day;
    S.refs = {};
    const empty = !st.habits.length && !st.routines.length && !st.sessionTypes.length && !st.mealSlots.length;
    if (empty) wrap.append(h('div', { class: 'notice' }, h('span', null, t('t.notSetUp')), h('a', { class: 'btn primary small', href: '#start' }, t('nav.start'))));
    S.refs.rings = h('div', { class: 'rings' });
    wrap.append(S.refs.rings); drawRings();
    if (wave && wave.phase === 'deload') wrap.append(h('div', { class: 'notice soft' }, h('span', null, t('pl.deloadHint'))));
    S.refs.alerts = h('div'); wrap.append(S.refs.alerts); drawAlerts();
    const nudge = backupNudge(); if (nudge) wrap.append(nudge);
    const cols = h('div', { class: 'cols' }); const left = h('div'), right = h('div'); cols.append(left, right); wrap.append(cols);
    const blocks = SC.blocksFor(st, dow(S.date));
    if (blocks.length) { S.refs.timeline = h('div'); left.append(section(t('t.plan'), h('a', { class: 'btn ghost small', href: '#plan' }, t('nav.plan')), S.refs.timeline)); drawTimeline(); }
    for (const r of routinesFor(S.date)) { const count = h('small'); S.refs['r_' + r.id] = count; left.append(section(r.name, count, r.items.length ? checklist(r, r.items) : h('p', { class: 'empty' }, t('t.noItems')))); }
    S.refs.habCount = h('small');
    left.append(section(t('t.habits'), S.refs.habCount, st.habits.length ? habitGrid() : h('p', { class: 'empty' }, t('t.noHabits'), ' ', h('a', { href: '#settings' }, t('t.inSettings')))));
    left.append(section(t('t.training'), h('button', { class: 'btn small', onclick: addSessionSheet }, t('t.addSession')), trainingList()));
    left.append(section(t('t.body'), null, bodyBlock()));
    const prev = store.get('days/' + addDays(S.date, -1));
    const canCopy = !day.meals.length && prev && Array.isArray(prev.meals) && prev.meals.length;
    right.append(section(t('t.meals'), canCopy ? h('button', { class: 'btn small', onclick: copyYesterday }, t('t.copyYesterday')) : null,
      st.mealSlots.length ? h('div', null, st.mealSlots.map(slotBlock)) : h('p', { class: 'empty' }, t('t.noSlots'), ' ', h('a', { href: '#settings' }, t('t.inSettings')))));
    updateCounts();
    return wrap;
  }
  function drawRings() {
    const st = S.settings, x = totals(S.day), el = S.refs.rings; if (!el) return;
    el.replaceChildren(
      h('div', { class: 'ringbox', html: ring(x.kcal, st.targets.kcal, { label: t('c.kcal') }) + `<div class="ringlab">${t('c.kcal')}</div>` }),
      h('div', { class: 'ringbox', html: ring(x.p, st.targets.protein, { label: t('c.protein'), color: 'var(--blue)', unit: 'g' }) + `<div class="ringlab">${t('c.protein')}</div>` }),
      h('div', { class: 'ringmeta' }, h('div', null, t('t.macros', { c: fmt(x.c), f: fmt(x.f) })),
        st.targets.carbs > 0 ? h('div', { class: 'mini' }, `${t('c.carbs')} ${fmt(x.c)} / ${fmt(st.targets.carbs)} g`) : null,
        st.targets.fat > 0 ? h('div', { class: 'mini' }, `${t('c.fat')} ${fmt(x.f)} / ${fmt(st.targets.fat)} g`) : null,
        x.burn ? h('div', null, t('t.burned', { n: fmt(x.burn) })) : null));
  }
  function drawAlerts() {
    const el = S.refs.alerts; if (!el) return;
    el.replaceChildren(...routinesFor(S.date).filter(r => r.alertAt).map(r => { const n = r.items.filter(i => (S.day.checks[r.id] || {})[i.id]).length; return n >= r.alertAt ? h('div', { class: 'notice warn' }, h('b', null, r.name + ': '), r.alertText || t('t.alertDefault', { n })) : null; }).filter(Boolean));
  }
  function drawTimeline() {
    const el = S.refs.timeline; if (!el) return;
    const st = S.settings, d = S.day, blocks = SC.blocksFor(st, dow(S.date));
    el.replaceChildren(h('div', { class: 'timeline' }, blocks.map(b => {
      const title = SC.blockTitle(b, st) || t('pl.' + b.kind);
      let done = null;
      if (b.kind === 'session') done = d.sessions.some(s => s.typeId === b.typeId && s.done !== false);
      else if (b.kind === 'routine') { const r = st.routines.find(x => x.id === b.routineId); done = r ? routineDone(r, d) : null; }
      else if (b.kind === 'meal') done = d.meals.some(m => m.slot === b.slotId);
      const dur = SC.duration(b);
      const row = h('button', { class: 'tl-row ' + KIND_CLASS[b.kind] + (done ? ' done' : ''), onclick: () => blockSheet(b) },
        h('span', { class: 'tl-time' }, b.start ? fmtTime(b.start) : '·'), h('span', { class: 'tl-dot' }),
        h('span', { class: 'tl-title' }, title, dur ? h('small', null, ' ' + fmtDur(dur)) : null),
        done != null ? h('span', { class: 'tl-check' }, done ? '\u2713' : '') : null);
      return row;
    })));
  }
  function updateCounts() {
    const st = S.settings, d = S.day; if (!d) return;
    for (const r of st.routines) { const el = S.refs['r_' + r.id]; if (el) { const done = r.items.filter(i => (d.checks[r.id] || {})[i.id]).length; el.textContent = r.items.length ? `${done}/${r.items.length}` : ''; } }
    if (S.refs.habCount) S.refs.habCount.textContent = st.habits.length ? `${habitsDone(d)}/${st.habits.length}` : '';
    drawAlerts(); drawTimeline();
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
  function habitGrid() {
    const d = S.day, days7 = [...Array(7)].map((_, i) => addDays(S.date, i - 6)), hist = {}; days7.forEach(x => { hist[x] = x === S.date ? d : (SC.normalizeDay(store.get('days/' + x) || null, x)); });
    return h('div', { class: 'habits' }, S.settings.habits.map(hb => {
      const tile = h('div', { class: 'habit', role: 'button', tabindex: '0' });
      const paint = () => {
        const v = d.habits[hb.id], done = SC.habitDone(hb, v), n = num(v);
        tile.classList.toggle('on', done); tile.classList.toggle('part', !done && !!v); tile.setAttribute('aria-pressed', done ? 'true' : 'false');
        const pct = hb.target ? Math.min(1, n / hb.target) : (done ? 1 : 0);
        const dots = h('div', { class: 'dots' }, days7.map(x => h('span', { class: 'dot' + (SC.habitDone(hb, (hist[x].habits || {})[hb.id]) ? ' on' : '') + (x === S.date ? ' cur' : '') })));
        tile.replaceChildren(
          h('div', { class: 'habit-top' }, h('span', { class: 'habit-ring', html: `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--track)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(pct * 94.2).toFixed(1)} 94.2" transform="rotate(-90 18 18)"/></svg>${done ? '<i>\u2713</i>' : ''}` }),
            hb.target ? h('button', { class: 'habit-minus', 'aria-label': t('t.minusOne'), onclick: e => { e.stopPropagation(); if (n > 0) { d.habits[hb.id] = n - 1 > 0 ? n - 1 : undefined; if (!d.habits[hb.id]) delete d.habits[hb.id]; paint(); saveDay(); updateCounts(); } } }, '\u2212') : null),
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
      h('button', { class: 'btn primary', onclick: () => { store.setDoc('templates/' + uid(), { name: tp.name, kcal: tp.kcal, p: tp.p, c: tp.c, f: tp.f, slot: w.id, updatedAt: new Date().toISOString() }); S.templates = store.list('templates'); closeSheet(); toast(t('t.templateSaved')); } }, t('c.save'))));
  }

  /* training */
  function trainingList() {
    const st = S.settings, d = S.day;
    const planned = SC.plannedFor(st, dow(S.date));
    const loggedTypes = new Set(d.sessions.map(s => s.typeId));
    const rows = [];
    planned.filter(p => !loggedTypes.has(p.type.id)).forEach(p => rows.push(h('div', { class: 'sess' },
      h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, p.type.name, p.block.start ? h('small', { class: 'muted' }, ' ' + fmtTime(p.block.start)) : null), h('div', { class: 'muted small' }, t('t.planned', { min: p.minutes, kcal: fmt(p.kcal) }))),
      h('div', { class: 'sess-actions' }, p.type.plan.length ? h('button', { class: 'btn small primary', onclick: () => sessionSheet(newSession(p.type, p.minutes, p.kcal), true) }, t('t.log')) : null,
        h('button', { class: 'btn small', onclick: () => markDone(p.type, p.minutes, p.kcal) }, t('t.markDone'))))));
    d.sessions.forEach(s => rows.push(h('div', { class: 'sess done' },
      h('div', { class: 'sess-main' }, h('div', { class: 'sess-name' }, s.name),
        h('div', { class: 'muted small' }, `${kindName(s.kind)} · ${num(s.minutes)} ${t('c.min')} · ${fmt(s.kcal)} kcal` + (s.sets && s.sets.length ? ` · ${t('t.setsCount', { n: s.sets.length })}` : '') + (s.notes ? ` · ${s.notes}` : ''))),
      h('div', { class: 'sess-actions' }, h('button', { class: 'btn small', onclick: () => sessionSheet(s, false) }, t('t.details')),
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => removeSession(s.id) }, '\u00d7')))));
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
    const w = h('input', { type: 'number', step: '0.1', inputmode: 'decimal', placeholder: u, value: d.weight == null ? '' : d.weight, onchange: e => { d.weight = e.target.value === '' ? null : num(e.target.value); saveDay(); } });
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
        ? h('label', { class: 'field' }, h('span', null, g.name), h('select', { onchange: e => { const s = clone(st); s.gates.find(x => x.id === g.id).current = +e.target.value; saveSettingsNow(s); render(); toast(t('c.saved')); } }, g.stages.map((sname, i) => h('option', { value: i + 1, selected: g.current === i + 1 }, sname))))
        : h('span', { class: 'chip small on' }, `${g.name} · ${g.stages[g.current - 1] || g.current}`))));
      wrap.append(section(t('pl.wave'), st.gates.length ? t('pl.gatesSub') : null, body));
    }
    const cal = h('div', { class: 'calwrap' }); wrap.append(section(t('pl.calendar'), S.planEdit ? h('button', { class: 'btn small primary', onclick: () => blockForm(null) }, t('pl.addBlock')) : null, cal));
    drawCalendar(cal);
    const withPlans = st.sessionTypes.filter(x => x.plan.length);
    wrap.append(section(t('pl.workouts'), S.planEdit ? h('button', { class: 'btn small', onclick: () => workoutPick() }, t('pl.editWorkout')) : null,
      withPlans.length ? h('div', { class: 'list' }, withPlans.map(x => h('button', { class: 'row pick', onclick: () => workoutSheet(x) }, h('span', { class: 'row-name' }, x.name), h('span', { class: 'muted small' }, t('pl.blocksCount', { b: x.plan.length, e: x.plan.reduce((a, b) => a + b.items.length, 0) })))))
        : h('p', { class: 'empty' }, t('pl.noWorkouts'))));
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
        h('button', { class: 'btn ghost danger', onclick: () => { const s = clone(st); s.calendar = s.calendar.filter(x => x.id !== b.id); saveSettingsNow(s); closeSheet(); render(); } }, t('c.delete'))) : null);
    openSheet(SC.blockTitle(b, st) || t('pl.' + b.kind), body);
  }
  function blockForm(b) {
    const st = S.settings, d = b ? clone(b) : { id: uid(), days: [S.planDay], start: '', end: '', kind: 'session', title: '', note: '', typeId: st.sessionTypes[0] ? st.sessionTypes[0].id : '', routineId: st.routines[0] ? st.routines[0].id : '', slotId: st.mealSlots[0] ? st.mealSlots[0].id : '' };
    const linkBox = h('div');
    const drawLink = () => {
      linkBox.replaceChildren();
      if (d.kind === 'session') linkBox.append(st.sessionTypes.length ? selectField(t('t.session'), d, 'typeId', st.sessionTypes.map(x => ({ value: x.id, label: x.name }))) : h('p', { class: 'empty' }, t('s.addTypesFirst')));
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
        const s = clone(st); const i = s.calendar.findIndex(x => x.id === d.id); if (i >= 0) s.calendar[i] = d; else s.calendar.push(d);
        saveSettingsNow(s); closeSheet(); render(); toast(t('c.saved'));
      } }, t('c.save')))));
  }
  function workoutSheet(type) {
    const body = h('div', null, h('p', { class: 'muted small' }, `${kindName(type.kind)} · ${num(type.minutes)} ${t('c.min')} · ${fmt(type.kcal)} kcal`), type.note ? h('p', null, type.note) : null,
      type.plan.map(b => h('div', { class: 'wblock' }, h('div', { class: 'subhead' }, b.label, b.note ? h('small', { class: 'muted' }, ' ' + b.note) : null),
        h('div', { class: 'list' }, b.items.map(it => { const ex = exById(it.exerciseId) || SC.resolveExercise(it.name, S.settings.exercises); const locked = ex && ex.gate && !SC.gateOpen(S.settings, ex.gate);
          const target = [it.sets ? `${it.sets} ×` : '', it.reps, it.perSide ? t('t.perSide') : '', it.rir ? `${it.rir} RIR` : '', it.rest].filter(Boolean).join(' · ');
          return h('div', { class: 'row pick' + (locked ? ' locked' : '') }, ex ? thumb(ex.image, 'thumb sm') : null, h('span', { class: 'row-name' }, ex ? h('button', { class: 'linkish', onclick: () => exerciseCard(ex) }, it.name) : it.name, h('div', { class: 'muted small' }, target, locked ? ' · ' + t('t.locked', { gate: gateLabel(ex.gate) }) : '', it.note ? ' · ' + it.note : ''))); })))),
      S.planEdit ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => workoutEditor(type) }, t('c.edit'))) : null);
    openSheet(type.name, body, { wide: true });
  }
  function workoutPick() {
    const st = S.settings;
    openSheet(t('pl.editWorkout'), h('div', { class: 'list' }, st.sessionTypes.map(x => h('button', { class: 'row pick', onclick: () => workoutEditor(x) }, h('span', { class: 'row-name' }, x.name), h('span', { class: 'muted small' }, x.plan.length ? t('pl.blocksCount', { b: x.plan.length, e: x.plan.reduce((a, b) => a + b.items.length, 0) }) : t('pl.noPlan'))))));
  }
  function workoutEditor(type) {
    const st = S.settings, plan = clone(type.plan), box = h('div');
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
    openSheet(t('pl.editWorkout') + ' · ' + type.name, h('div', null, box, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
      const s = clone(st); s.sessionTypes.find(x => x.id === type.id).plan = plan; saveSettingsNow(s); closeSheet(); render(); toast(t('c.saved'));
    } }, t('c.save')))), { wide: true });
  }

  /* ---------- Library: exercises and foods ---------- */
  function viewLibrary() {
    const wrap = h('div', { class: 'page' });
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('nav.library')), h('div', { class: 'sub' }, S.libTab === 'exercises' ? t('l.exSub') : t('f.sub'))),
      h('button', { class: 'btn primary', onclick: () => S.libTab === 'exercises' ? exerciseForm(null) : foodForm(null) }, S.libTab === 'exercises' ? t('l.addExercise') : t('f.addFood'))));
    wrap.append(h('div', { class: 'tools row2' }, segmented([{ value: 'exercises', label: t('l.exercises') }, { value: 'foods', label: t('nav.foods') }], S.libTab, v => { S.libTab = v; render(); })));
    wrap.append(S.libTab === 'exercises' ? exerciseList() : foodsBlock());
    return wrap;
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
          const s = clone(st); if (!d.id) d.id = U.slug(d.name); const i = s.exercises.findIndex(x => x.id === d.id);
          if (i >= 0) s.exercises[i] = d; else s.exercises.push(d);
          saveSettingsNow(s); closeSheet(); render(); toast(t('c.saved'));
        } }, t('c.save')),
        ex ? h('button', { class: 'btn ghost danger', onclick: () => { const s = clone(st); s.exercises = s.exercises.filter(x => x.id !== ex.id); saveSettingsNow(s); closeSheet(); render(); } }, t('c.delete')) : null)));
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
          store.setDoc('foods/' + id, { ...rest, updatedAt: new Date().toISOString() }); S.foods = store.list('foods').sort(byName);
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
    const goalText = st.goal.weight ? t('p.toward', { w: st.goal.weight, u }) + (st.goal.bodyFat ? ' ' + t('p.atBf', { bf: st.goal.bodyFat }) : '') : t('p.setGoal');
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('p.title')), h('div', { class: 'sub' }, goalText + (st.goal.note ? ' · ' + st.goal.note : '')))));
    const r = st.rank;
    if (r.enabled) {
      const phase = phaseFor(r.sublevel, r.phases), next = r.phases.find(p => p.minSublevel > r.sublevel);
      const sub = r.maxSublevel > 0 ? ` · ${r.sublevel} ${r.sublevelName}` : '';
      wrap.append(section(r.system || t('p.rank'), null, h('div', null, svg(rankSVG(r)),
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
    if (measured.length || st.goal.milestones.length) {
      const mbox = h('div');
      if (measured.length) {
        const latest = measured[measured.length - 1], first = measured[0];
        mbox.append(h('div', { class: 'stats' }, SC.MEASURES.filter(k => latest.measures[k] != null).map(k => { const f = measured.find(d => d.measures[k] != null); const dlt = f && f !== latest ? latest.measures[k] - f.measures[k] : null; return statCard(fmt1(latest.measures[k]), t('m.' + k), dlt == null ? fmtShort(latest.date) : `${dlt >= 0 ? '+' : ''}${fmt1(dlt)} · ${fmtShort(f.date)}`); })));
        const waist = measured.filter(d => d.measures.waist != null).map(d => ({ date: d.date, v: d.measures.waist }));
        if (waist.length > 1) mbox.append(h('div', { class: 'subhead' }, t('m.waist')), svg(trend(waist, { label: t('m.waist') })));
      }
      if (st.goal.milestones.length) mbox.append(h('div', { class: 'subhead' }, t('p.milestones')), h('table', { class: 'plain' }, h('tbody', null, st.goal.milestones.map(m => h('tr', null, h('td', null, m.label), h('td', { class: 'n' }, m.bodyFat != null ? `${m.bodyFat}%` : ''), h('td', { class: 'n muted' }, m.weight != null ? `${m.weight} ${u}` : ''), h('td', { class: 'n muted' }, m.lean != null ? `${m.lean} / ${m.fat != null ? m.fat : '–'}` : ''))))));
      wrap.append(section(t('p.bodyComp'), t('p.bodyCompSub'), mbox));
    }
    const weeks = [...Array(8)].map((_, i) => weekStart(addDays(today(), -7 * (7 - i))));
    const tw = weeks.map(ws => { const we = addDays(ws, 6); const mins = all.filter(d => d.date >= ws && d.date <= we).flatMap(d => d.sessions.filter(s => s.done !== false)).reduce((a, s) => a + num(s.minutes), 0); return { label: fmtShort(ws), value: mins, color: 'var(--blue)' }; });
    wrap.append(section(t('p.training'), null, tw.some(x => x.value) ? svg(bars(tw, { height: 140, label: t('p.training') })) : h('p', { class: 'empty' }, t('p.noTraining'))));
    if (habTot) {
      const map = {}; all.forEach(d => { if (Object.keys(d.habits).length || d.meals.length || d.sessions.length) map[d.date] = habitsDone(d) / habTot; });
      wrap.append(section(t('p.habitsHeat'), null, svg(heat(map, 12, today()))));
    }
    return wrap;
  }

  /* ---------- Settings ---------- */
  function viewSettings() {
    const draft = (S.settingsDirty && S.settingsDraft) ? S.settingsDraft : clone(S.settings);
    S.settingsDraft = draft;
    const wrap = h('div', { class: 'page settings' });
    const saveBar = h('div', { class: 'savebar' + (S.settingsDirty ? ' show' : '') }, h('span', null, t('s.unsaved')), h('button', { class: 'btn primary', onclick: saveSettings }, t('c.save')));
    const redraws = [];
    const dirty = () => { S.settingsDirty = true; saveBar.classList.add('show'); redraws.forEach(fn => fn()); };
    const kindOptions = () => draft.sessionKinds.map(k => ({ value: k.id, label: k.name || '—' }));
    wrap.append(h('div', { class: 'dayhead' }, h('div', { class: 'daytitle' }, h('h1', null, t('s.title')))));
    wrap.append(section(t('s.profile'), null, h('div', { class: 'grid2' }, textField(t('c.name'), draft, 'name', dirty, t('c.optional')), selectField(t('s.unit'), draft.units, 'weight', [{ value: 'lb', label: t('s.lb') }, { value: 'kg', label: t('s.kg') }], dirty))));
    wrap.append(section(t('s.targets'), null, h('div', { class: 'grid2' }, numField(t('s.calories'), draft.targets, 'kcal', dirty), numField(t('s.proteinG'), draft.targets, 'protein', dirty), numField(t('s.carbsG'), draft.targets, 'carbs', dirty), numField(t('s.fatG'), draft.targets, 'fat', dirty))));
    const band = { lo: draft.goal.band ? draft.goal.band[0] : null, hi: draft.goal.band ? draft.goal.band[1] : null };
    const bandUpd = () => { draft.goal.band = band.lo != null && band.hi != null ? [band.lo, band.hi] : null; dirty(); };
    wrap.append(section(t('s.goal'), null, h('div', null, h('div', { class: 'grid2' }, numField(t('s.goalWeight', { u: draft.units.weight }), draft.goal, 'weight', dirty), numField(t('s.goalBf'), draft.goal, 'bodyFat', dirty)),
      h('div', { class: 'grid2' }, numField(t('s.bandLo', { u: draft.units.weight }), band, 'lo', bandUpd), numField(t('s.bandHi', { u: draft.units.weight }), band, 'hi', bandUpd)),
      textField(t('s.goalNote'), draft.goal, 'note', dirty),
      h('div', { class: 'subhead' }, t('p.milestones'), ' ', helpTip(t('s.milestonesSub'))),
      listEditor(draft.goal.milestones, [{ key: 'label', label: t('s.milestone') }, { key: 'bodyFat', label: '% ' + t('c.fat'), type: 'number', small: true }, { key: 'weight', label: draft.units.weight, type: 'number', small: true }], dirty, t('s.addMilestone')))));
    wrap.append(section(t('s.slots'), null, listEditor(draft.mealSlots, [{ key: 'name', label: t('s.slotName') }], dirty, t('s.addSlot'))));
    wrap.append(section(t('s.habits'), t('s.habitsSub'), listEditor(draft.habits, [{ key: 'name', label: t('s.habit') }, { key: 'target', label: t('s.target'), type: 'number', small: true }, { key: 'unit', label: t('s.habitUnit'), small: true }], dirty, t('s.addHabit'))));
    wrap.append(section(t('s.routines'), t('s.routinesSub'), routinesEditor(draft, dirty)));
    const kindsEd = listEditor(draft.sessionKinds, [{ key: 'name', label: t('s.kind') }], dirty, t('s.addKind'));
    wrap.append(section(t('s.kinds'), null, kindsEd));
    const typesEd = listEditor(draft.sessionTypes, [{ key: 'name', label: t('c.name') }, { key: 'kind', label: t('s.kind'), type: 'select', small: true, options: kindOptions }, { key: 'minutes', label: t('c.min'), type: 'number', small: true }, { key: 'kcal', label: t('c.kcal'), type: 'number', small: true }], dirty, t('s.addType'));
    redraws.push(() => { if (document.activeElement && kindsEd.contains(document.activeElement)) return; typesEd.redraw(); });
    wrap.append(section(t('s.types'), t('s.typesSub2'), typesEd));
    wrap.append(section(t('s.gates'), t('s.gatesSub'), gatesEditor(draft, dirty)));
    const waveObj = { start: draft.wave.start || '', pattern: draft.wave.pattern.join(', ') };
    wrap.append(section(t('s.wave'), t('s.waveSub'), h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, t('s.waveStart')), h('input', { type: 'date', value: waveObj.start, onchange: e => { draft.wave.start = e.target.value || null; dirty(); } })),
      h('label', { class: 'field' }, h('span', null, t('s.wavePattern')), h('input', { type: 'text', value: waveObj.pattern, placeholder: 'ramp, ramp, full, deload', oninput: e => { draft.wave.pattern = e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(s => SC.WAVE.includes(s)); dirty(); } })))));
    wrap.append(section(t('s.rank'), t('s.rankSub'), rankEditor(draft, dirty)));
    wrap.append(section(t('s.app'), null, appBlock()));
    wrap.append(section(t('s.data'), t('s.storedIn', { kind: store.kind() }), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: exportSheet }, t('s.export')),
      h('button', { class: 'btn', onclick: () => openSheet(t('i.title'), importPanel(() => { closeSheet(); render(); }), { wide: true }) }, t('s.import')),
      h('a', { class: 'btn', href: '#start' }, t('nav.start')),
      h('button', { class: 'btn danger', onclick: () => confirmSheet(t('s.erase'), t('s.eraseConfirm'), t('s.eraseBtn'), async () => { await store.eraseProfile(); hydrate(); location.hash = '#start'; render(); toast(t('s.erased')); }, t('c.cancel')) }, t('s.erase')))));
    wrap.append(saveBar);
    return wrap;
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
    const profs = store.profiles(), cur = store.currentProfile().id;
    const list = h('div', { class: 'list' }, profs.map(p => h('div', { class: 'row pick' },
      h('div', { class: 'row-name' }, p.name || t('s.profile'), p.id === cur ? h('span', { class: 'badge' }, t('s.current')) : null),
      h('button', { class: 'btn small', onclick: () => { const d = { name: p.name }; openSheet(t('s.rename'), h('div', null, textField(t('s.profileName'), d, 'name'), h('button', { class: 'btn primary', onclick: () => { store.renameProfile(p.id, d.name); closeSheet(); rerenderAll(); } }, t('c.save')))); } }, t('s.rename')),
      p.id !== cur ? h('button', { class: 'btn small', onclick: () => switchProfile(p.id) }, t('s.switch')) : null,
      profs.length > 1 ? h('button', { class: 'btn ghost icon', 'aria-label': t('s.deleteProfile'), onclick: () => confirmSheet(t('s.deleteProfile'), t('s.deleteProfileConfirm', { name: p.name || t('s.profile') }), t('c.delete'), async () => { await store.deleteProfile(p.id); hydrate(); rerenderAll(); }, t('c.cancel')) }, '\u00d7') : null)));
    return h('div', null,
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, t('s.language')), langSel), h('div', { class: 'field' }, h('span', null, t('s.theme')), themeSeg)),
      h('div', { class: 'subhead' }, t('s.profiles')), h('p', { class: 'muted small' }, t('s.profilesSub')), list,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => newProfileSheet() }, t('s.addProfile'))));
  }
  function newProfileSheet(onCreated) {
    const d = { name: '' };
    openSheet(t('pf.new'), h('div', null, textField(t('s.profileName'), d, 'name'), h('button', { class: 'btn primary', onclick: () => { const id = store.addProfile(d.name); closeSheet(); if (onCreated) onCreated(id); else switchProfile(id); } }, t('c.add'))));
  }
  function switchProfile(id) { if (!store.setProfile(id)) return; hydrate(); S.foodTab = t('f.all'); rerenderAll(); if (!store.get('settings/main') && !store.count()) location.hash = '#start'; }
  function profileSheet() {
    const profs = store.profiles(), cur = store.currentProfile().id;
    openSheet(t('pf.switch'), h('div', null, h('div', { class: 'list' }, profs.map(p => h('button', { class: 'row pick' + (p.id === cur ? ' on' : ''), onclick: () => { closeSheet(); if (p.id !== cur) switchProfile(p.id); } },
      h('span', { class: 'row-name' }, p.name || t('s.profile')), p.id === cur ? h('span', { class: 'badge' }, t('s.current')) : null))),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => newProfileSheet() }, t('s.addProfile')))));
  }
  function routinesEditor(draft, dirty) {
    const box = h('div', { class: 'routines' });
    const draw = () => box.replaceChildren(...draft.routines.map((r, i) => h('div', { class: 'routine' },
      h('div', { class: 'editor-row' }, h('input', { type: 'text', placeholder: t('s.routineName'), 'aria-label': t('s.routineName'), value: r.name || '', oninput: e => { r.name = e.target.value; dirty(); } }),
        h('button', { class: 'btn ghost icon', 'aria-label': t('c.remove'), onclick: () => { draft.routines.splice(i, 1); dirty(); draw(); } }, '\u00d7')),
      h('div', { class: 'chips small-gap' }, DAYS.map(d => { r.days = r.days || []; const on = r.days.includes(d); return h('button', { class: 'chip small' + (on ? ' on' : ''), onclick: e => { const now = !r.days.includes(d); r.days = now ? [...r.days, d] : r.days.filter(x => x !== d); e.currentTarget.classList.toggle('on', now); dirty(); } }, dayName(d)); })),
      listEditor(r.items = r.items || [], [{ key: 'name', label: t('s.exercise') }, { key: 'target', label: t('s.setsReps'), small: true }], dirty, t('s.addExercise')),
      h('div', { class: 'grid2 mt' }, numField(t('s.alertAt'), r, 'alertAt', dirty, '1'), textField(t('s.alertText'), r, 'alertText', dirty, t('c.optional'))))),
      h('div', null, h('button', { class: 'btn small', onclick: () => { draft.routines.push({ id: uid(), name: '', items: [], days: [], alertAt: null, alertText: '' }); dirty(); draw(); const inp = box.querySelector('.routine:last-of-type input'); if (inp) inp.focus(); } }, t('s.addRoutine'))));
    draw();
    return box;
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
      listEditor(r.history, [{ key: 'date', label: 'Date', type: 'date' }, { key: 'level', label: t('s.currentLevel') }, { key: 'sublevel', label: '#', type: 'number', small: true }], dirty, t('s.addPromotion')),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => { r.sublevel = num(r.sublevel) + 1; r.history.push({ id: uid(), date: today(), level: r.level, sublevel: r.sublevel }); dirty(); render(); toast(t('s.recorded', { level: r.level, n: r.sublevel })); } }, t('s.promoted'))));
    box.append(h('label', { class: 'row noline' }, h('input', { type: 'checkbox', checked: !!r.enabled, onchange: e => { r.enabled = e.target.checked; body.style.display = r.enabled ? 'block' : 'none'; dirty(); } }), h('span', { class: 'row-name' }, t('s.showRank'))), body);
    return box;
  }
  function saveSettings() {
    const prevUnit = S.settings.units.weight;
    const merged = SC.normalizeSettings(S.settingsDraft);
    merged.updatedAt = new Date().toISOString();
    if (merged.units.weight !== prevUnit) {
      const from = prevUnit, to = merged.units.weight;
      if (merged.goal.weight != null) merged.goal.weight = SC.convertWeight(merged.goal.weight, from, to);
      if (merged.goal.band) merged.goal.band = merged.goal.band.map(v => SC.convertWeight(v, from, to));
      const ups = store.list('days').filter(d => d.weight != null).map(d => { const { id, ...rest } = d; return ['days/' + (d.date || id), { ...rest, weight: SC.convertWeight(num(d.weight), from, to) }]; });
      if (ups.length) { store.bulk({ upserts: ups }); toast(t('s.converted', { n: ups.length, u: to })); }
    }
    S.settings = merged; S.settingsDirty = false; S.settingsDraft = null;
    store.setDoc('settings/main', merged); flashSaved(); loadDay(S.date); render(); toast(t('c.saved'));
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
      h('a', { class: 'tile', href: '#settings' }, h('b', null, t('g.blank')), h('span', null, t('s.title')))));
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
      if (st.into === 'new') rerenderAll();
    }
    const panel = h('div', { class: 'import' }, drop, file, ta, targetWrap,
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', null, t('i.mode')), modeSeg), h('div', { class: 'field' }, h('span', null, t('i.into')), intoSeg)),
      help, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { if (!st.text.trim()) { toast(t('i.pasteFirst')); return; } preview(); } }, t('c.preview')), applyBtn), result);
    panel.setText = setText;
    if (S.pendingImport) { const txt = S.pendingImport; S.pendingImport = null; setTimeout(() => { setText(txt); toast(t('i.shared')); }, 30); }
    return panel;
  }
  async function applyPlan(plan) {
    const now = new Date().toISOString(), upserts = [], deletes = [];
    if (plan.settings) upserts.push(['settings/main', { ...plan.settings, updatedAt: now }]);
    for (const key of ['foods', 'templates']) {
      plan[key].remove.forEach(id => deletes.push(key + '/' + id));
      plan[key].upsert.forEach(r => { const { id, ...rest } = r; upserts.push([key + '/' + id, { ...rest, updatedAt: rest.updatedAt || now }]); });
    }
    plan.days.remove.forEach(date => deletes.push('days/' + date));
    plan.days.upsert.forEach(d => upserts.push(['days/' + d.date, { ...d, updatedAt: d.updatedAt || now }]));
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
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
  };
  const NAV = ['today', 'plan', 'progress', 'library', 'settings'], ROUTES = [...NAV, 'start'], ALIAS = { week: 'progress', foods: 'library' };
  function shell() {
    const langSel = h('select', { class: 'lang', 'aria-label': t('s.language'), onchange: e => { I.set(e.target.value); rerenderAll(); } }, Object.entries(I.LANGS).map(([c, n]) => h('option', { value: c, selected: c === I.lang }, n)));
    const prof = store.currentProfile(), many = store.profiles().length > 1;
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, MB.APP.name), h('span', { class: 'status', 'data-state': '' }, '')),
      h('div', { class: 'topbar-actions' },
        (many || prof.name) ? h('button', { class: 'btn ghost small profile-btn', onclick: profileSheet, html: ICONS.user + `<span>${prof.name || t('s.profile')}</span>` }) : null,
        h('button', { class: 'btn ghost icon theme-btn', 'aria-label': t('s.theme'), onclick: toggleTheme, html: effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon }),
        langSel));
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(r => h('a', { href: '#' + r, 'data-route': r, html: ICONS[r] + '<span>' + t('nav.' + r) + '</span>' })));
    return h('div', { class: 'app' }, top, nav, h('main', { id: 'main', class: 'main' }));
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
  function rerenderAll() { const app = $('.app'); if (app) app.remove(); document.body.append(shell()); setStatus(storageLabel(), ''); render(); }
  const routeFromHash = () => { let r = location.hash.replace('#', '').split('?')[0]; if (ALIAS[r]) { if (r === 'foods') S.libTab = 'foods'; r = ALIAS[r]; } return ROUTES.includes(r) ? r : 'today'; };
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
    let resizeTimer = null; window.addEventListener('resize', () => { if (S.route !== 'plan') return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const cal = $('.calwrap'); if (cal) drawCalendar(cal); }, 150); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.openedOn !== today()) { const stale = S.date === S.openedOn; S.openedOn = today(); if (stale) { S.date = today(); loadDay(S.date); if (S.route === 'today') render(); } } });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref()));
    document.addEventListener('dragover', e => { if (S.route !== 'start') e.preventDefault(); });
    document.addEventListener('drop', async e => { if (S.route === 'start') return; e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /json$/i.test(f.name)) receiveText(await f.text(), f.name); });
    registerSW(); checkInbox(); fileHandlers();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
