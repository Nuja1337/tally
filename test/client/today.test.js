// Edit in place (Today and Progress), a short Settings, and the five-step status colors: met, close, halfway, started, missed.
import { describe, it, expect, afterEach } from 'vitest';
import { openTab, waitFor, loadExample } from './harness.js';

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });
async function withExample(hash) {
  const tab = await openTab(); open.push(tab);
  await loadExample(tab);
  if (hash && hash !== '#today') await tab.go(hash);
  return tab;
}
const settings = tab => tab.MB.store.get('settings/main');
const headings = tab => tab.$$('#main .card-head h2').map(h => h.textContent);
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const pick = (tab, select, value) => { select.value = value; select.dispatchEvent(new tab.window.Event('change')); };
const cardOf = (tab, key) => tab.$('#c-' + key);
const editIn = (tab, key) => [...cardOf(tab, key).querySelectorAll('.card-head button')].find(b => b.textContent === tab.t('c.edit'));
const save = tab => tab.button(tab.t('c.save'), '.sheet').click();
/* write documents straight into the store, then open a fresh tab on the same device, which boots from them */
async function reseed(tab, docs, hash = '#today') {
  await Promise.all(Object.entries(docs).map(([p, d]) => tab.MB.store.setDoc(p, { ...d, updatedAt: new Date().toISOString() })));
  const next = await openTab({ device: tab.device, hash }); open.push(next);
  return next;
}
const day = (date, d) => ({ date, values: {}, checks: {}, meals: [], sessions: [], tags: [], note: '', ...d });
async function prevDay(tab) { tab.$('#main .dayhead button').click(); await waitFor(() => tab.text('#main .dayhead h1') !== tab.t('c.today'), { what: 'previous day' }); }

describe('Settings', () => {
  it('holds only profile, app, sync and data; nothing waits for a save button', async () => {
    const tab = await withExample('#settings');
    const t = tab.t;
    expect(headings(tab)).toEqual([t('s.profile'), t('s.app'), t('sy.title'), t('s.data')]);
    expect(tab.$('.savebar')).toBeNull();
    const name = tab.$$('#main .field').find(f => f.querySelector('span').textContent === t('s.profileName')).querySelector('input');
    name.value = 'Sam'; name.dispatchEvent(new tab.window.Event('change'));
    expect(tab.MB.store.currentProfile().name).toBe('Sam');
    expect(tab.text('.profile-btn')).toBe('Sam');
    expect(tab.errors).toEqual([]);
  });
});

describe('Today: setup edited where it shows', () => {
  it('daily targets and their aim, from the rings', async () => {
    const tab = await withExample();
    tab.$('#main .ringbox').click();
    expect(tab.text('.sheet-head h3')).toBe(tab.t('s.targets'));
    const [kcal] = tab.$$('.sheet input[type=number]'), [kcalAim] = tab.$$('.sheet select');
    typeIn(tab, kcal, '2800'); pick(tab, kcalAim, 'max');
    save(tab);
    expect(settings(tab).targets).toMatchObject({ kcal: 2800, aim: { kcal: 'max', protein: 'min' } });
    expect(tab.$('#main .ringbox .ring').getAttribute('aria-label')).toContain('2,800');
  });

  it('trackers and meal slots, from their cards', async () => {
    const tab = await withExample();
    editIn(tab, 'g_habits').click();
    tab.button(tab.t('tk.add'), '.sheet').click();
    typeIn(tab, tab.$('.sheet input[type=text]'), 'Floss');
    save(tab);
    expect(settings(tab).trackers.find(x => x.name === 'Floss')).toMatchObject({ id: 'floss', type: 'check', freq: 'daily', group: 'habits' });
    expect(tab.$$('#c-g_habits .habit-name').map(x => x.textContent)).toContain('Floss');

    editIn(tab, 'meals').click();
    typeIn(tab, tab.$$('.sheet .editor-row input')[0], 'First meal');
    save(tab);
    expect(settings(tab).mealSlots[0].name).toBe('First meal');
    expect(tab.$('#c-meals .slot-head h3').textContent).toContain('First meal');
    expect(tab.errors).toEqual([]);
  });

  it('a blank profile offers to add trackers and meal slots right on Today', async () => {
    const tab = await openTab({ hash: '#today' }); open.push(tab);
    expect(headings(tab)).toEqual(expect.arrayContaining([tab.t('t.habits'), tab.t('t.body')]));
    expect(tab.$$('#c-g_body .habit-name').map(x => x.textContent)).toEqual([tab.t('m.weight')]);
    tab.button(tab.t('tk.add'), '#c-g_habits').click();
    typeIn(tab, tab.$('.sheet input[type=text]'), 'Walk');
    save(tab);
    expect(tab.$$('#c-g_habits .habit-name').map(x => x.textContent)).toEqual(['Walk']);
    tab.button(tab.t('t.addSlots'), '#main').click();
    tab.button(tab.t('s.addSlot'), '.sheet').click();
    typeIn(tab, tab.$('.sheet .editor-row input'), 'Lunch');
    save(tab);
    expect(tab.$('#c-meals .slot-head h3').textContent).toContain('Lunch');
    expect(tab.errors).toEqual([]);
  });
});

describe('Progress: the goal and its checkpoints, edited on the page', () => {
  it('goal and milestones in one sheet; lean and fat mass are worked out', async () => {
    const tab = await withExample('#progress');
    const t = tab.t;
    tab.button(t('p.setGoalBtn'), '#main').click();
    const [w, bf, lo, hi] = tab.$$('.sheet input[type=number]');
    typeIn(tab, w, '180'); typeIn(tab, bf, '12'); typeIn(tab, lo, '179'); typeIn(tab, hi, '182');
    save(tab);
    expect(settings(tab).goal).toMatchObject({ weight: 180, bodyFat: 12, band: [179, 182] });
    expect(tab.text('#main')).toContain(t('p.toward', { w: 180, u: 'lb' }));

    tab.button(t('p.editGoal'), '#main').click();
    tab.button(t('s.addMilestone'), '.sheet').click(); /* checkpoints live in the goal sheet */
    const [label, date, mbf, mw] = tab.$$('.sheet .editor-row input');
    typeIn(tab, label, 'Summer'); typeIn(tab, date, '2027-06-01'); typeIn(tab, mbf, '14'); typeIn(tab, mw, '185');
    save(tab);
    expect(settings(tab).goal.milestones).toEqual([{ label: 'Summer', date: '2027-06-01', weight: 185, bodyFat: 14 }]);
    tab.button(t('p.tab.month'), '#main').click();
    expect(tab.text('#c-body')).toContain('Summer');
    expect(tab.text('#c-body')).toContain('159.1 / 25.9'); /* 185 lb at 14% */
    expect(tab.text('#c-body')).toContain('158.4 / 21.6'); /* the goal: 180 lb at 12% */

    /* clearing the goal clears its checkpoints too */
    tab.button(t('c.edit'), '#c-body').click();
    tab.button(t('p.clearGoal'), '.sheet').click();
    expect(settings(tab).goal).toMatchObject({ weight: null, bodyFat: null, band: null, note: '', milestones: [] });
    expect(tab.$('#c-body')).toBeNull();
    expect(tab.errors).toEqual([]);
  });
});

describe('Today: status colors', () => {
  it('a finished day short of its targets shows red; one that met them shows green', async () => {
    const first = await withExample();
    const { addDays, today } = first.MB.ui, y = addDays(today(), -1), s = settings(first);
    let tab = await reseed(first, { ['days/' + y]: day(y, { meals: [{ id: 'a', slot: 'breakfast', name: 'Toast', kcal: 300, p: 10, c: 40, f: 5 }] }) });
    await prevDay(tab);
    const notes = () => tab.$$('#main .ringnote').map(n => n.className);
    expect(notes()).toEqual(['ringnote st-low', 'ringnote st-low']); /* something, but under half */
    expect(tab.$('#main .ringnote').textContent).toBe(tab.t('t.short', { n: (s.targets.kcal - 300).toLocaleString() }));

    tab = await reseed(tab, { ['days/' + y]: day(y, { meals: [{ id: 'a', slot: 'breakfast', name: 'Feast', kcal: s.targets.kcal, p: s.targets.protein + 5, c: 0, f: 0 }] }) });
    await prevDay(tab);
    expect(notes()).toEqual(['ringnote st-met', 'ringnote st-met']);
    expect(tab.$('#main .ringnote').textContent).toBe('✓ ' + tab.t('t.onTarget'));
  });

  it('today counts down without red; a finished checklist and all habits turn their counts green', async () => {
    const tab = await withExample();
    expect(tab.$('#main .ringnote').className).toBe('ringnote st-progress');
    for (const tile of tab.$$('#c-g_habits .habit')) {
      if (tile.getAttribute('role') === 'button') { for (let i = 0; i < 10 && !tile.classList.contains('on'); i++) tile.click(); continue; }
      const [hh] = tile.querySelectorAll('input'); hh.value = '8'; hh.dispatchEvent(new tab.window.Event('change')); /* sleep: 8 h */
    }
    expect(tab.$$('#c-g_habits .habit').every(x => x.dataset.grade === 'met')).toBe(true);
    expect(tab.$('#c-g_habits .count').className).toBe('count st-met');
    const tally = tab.$$('#main .tally').find(x => x.textContent.endsWith(tab.t('t.habits')));
    expect(tally.classList.contains('st-met')).toBe(true);
    const row = tab.$('#main .cl');
    row.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new tab.window.Event('change')); });
    expect(row.dataset.status).toBe('met');
    expect(tab.$$('#main .tally').find(x => x.textContent.endsWith(tab.t('t.routines'))).classList.contains('st-met')).toBe(true);
    expect(tab.errors).toEqual([]);
  });

  it('a check-in list with a warning count turns red at the count instead of green', async () => {
    const first = await withExample(), s = settings(first);
    const tab = await reseed(first, { 'settings/main': { ...s, routines: [...s.routines, { id: 'flags', name: 'Red flags', days: [], alertAt: 2, alertText: '', items: [{ id: 'hr', name: 'High HR', target: '' }, { id: 'sleep', name: 'Poor sleep', target: '' }] }] } });
    const row = tab.$('#cl-flags');
    row.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new tab.window.Event('change')); });
    expect(row.dataset.status).toBe('alert');
    expect(tab.$('#main .notice.bad').textContent).toContain('Red flags');
  });
});

describe('Today: the day in time order', () => {
  it('shows what is on now, marks done blocks, and on a past day marks the rest missed', async () => {
    const first = await withExample(), { DAYS } = first.MB.ui, s = settings(first), d = new Date(), mins = d.getHours() * 60 + d.getMinutes();
    /* one block that spans the whole day, one that ended right after midnight */
    const tab = await reseed(first, { 'settings/main': { ...s, calendar: [{ id: 'all', days: DAYS, start: '00:00', end: '23:59', kind: 'other', title: 'All day' }, { id: 'early', days: DAYS, start: '00:00', end: '00:01', kind: 'meal', slotId: 'breakfast' }] } });
    const rows = () => tab.$$('#c-plan .tl-row');
    if (mins > 2 && mins < 1437) {
      expect(rows().find(r => r.textContent.includes('All day')).classList.contains('now')).toBe(true);
      expect(tab.$('#c-plan .tl-tag.now').textContent).toBe(tab.t('t.now'));
      expect(rows().find(r => r.textContent.includes(s.mealSlots[0].name)).classList.contains('late')).toBe(true); /* ended today, not logged yet: amber */
    }
    /* logging the meal marks it done */
    rows().find(r => r.textContent.includes(s.mealSlots[0].name)).click();
    expect(tab.text('.sheet-head h3')).toBe(tab.t('t.addTo', { slot: s.mealSlots[0].name }));
    tab.button(tab.t('t.custom'), '.sheet').click();
    typeIn(tab, tab.$('.sheet input[type=text]'), 'Eggs');
    tab.button(tab.t('t.log'), '.sheet').click();
    expect(rows().find(r => r.textContent.includes(s.mealSlots[0].name)).classList.contains('done')).toBe(true);
    /* yesterday, nothing logged: missed in red */
    await prevDay(tab);
    expect(rows().find(r => r.textContent.includes(s.mealSlots[0].name)).classList.contains('miss')).toBe(true);
    expect(tab.errors).toEqual([]);
  });

  it('checklists open with a tap, remember that on this device, and open from the timeline', async () => {
    const first = await withExample();
    const s = settings(first), long = { id: 'long', name: 'Long list', days: [], alertAt: null, alertText: '', items: [...Array(9)].map((_, i) => ({ id: 'i' + i, name: 'Item ' + i, target: '' })) };
    const tab = await reseed(first, { 'settings/main': { ...s, routines: [...s.routines, long], calendar: [...s.calendar, { id: 'lb', days: first.MB.ui.DAYS, start: '05:00', end: '05:10', kind: 'routine', routineId: 'long' }] } });
    const body = () => tab.$('#cl-long .cl-body');
    expect(body().classList.contains('hidden')).toBe(true); /* long lists start closed */
    expect(tab.$('#cl-morning .cl-body').classList.contains('hidden')).toBe(false); /* short ones open */
    tab.$('#cl-long .cl-head').click();
    expect(body().classList.contains('hidden')).toBe(false);
    expect(JSON.parse(tab.window.localStorage.getItem('tally:open'))).toMatchObject({ long: true });
    tab.$('#cl-long .cl-head').click();
    expect(body().classList.contains('hidden')).toBe(true);
    tab.$$('#c-plan .tl-row').find(r => r.textContent.includes('Long list')).click();
    expect(body().classList.contains('hidden')).toBe(false);
    expect(tab.$('.sheet')).toBeNull();
  });
});

describe('target status', () => {
  it('min, about and max targets, during the day and once it is over', async () => {
    const tab = await openTab(); open.push(tab);
    const st = tab.MB.schema.targetStatus;
    expect(st(100, 0, 'min', true)).toBeNull();
    expect([st(50, 100, 'min', false), st(100, 100, 'min', false), st(95, 100, 'min', true), st(50, 100, 'min', true), st(20, 100, 'min', true), st(0, 100, 'min', true)]).toEqual(['progress', 'met', 'good', 'half', 'low', 'miss']);
    expect([st(50, 100, 'near', false), st(92, 100, 'near', false), st(108, 100, 'near', true), st(115, 100, 'near', false), st(130, 100, 'near', false), st(85, 100, 'near', true), st(70, 100, 'near', true), st(170, 100, 'near', false), st(250, 100, 'near', true)])
      .toEqual(['progress', 'met', 'met', 'good', 'half', 'good', 'half', 'low', 'miss']);
    expect([st(50, 100, 'max', false), st(50, 100, 'max', true), st(105, 100, 'max', false), st(120, 100, 'max', true), st(180, 100, 'max', true), st(200, 100, 'max', true)]).toEqual(['progress', 'met', 'good', 'half', 'low', 'miss']);
  });

  it('trackers: counts start at zero, ratings go by steps, times by minutes off; rates over weeks use their own steps', async () => {
    const tab = await openTab(); open.push(tab);
    const { normalizeTracker, trackerGrade, rateGrade, gradeOf } = tab.MB.schema, tk = x => normalizeTracker({ id: 'x', name: 'x', ...x });
    expect([trackerGrade(tk({ type: 'count', target: 3, aim: 'max' }), undefined, true), trackerGrade(tk({ type: 'count', target: 8 }), 6, true), trackerGrade(tk({ type: 'count', target: 8 }), 6, false)]).toEqual(['met', 'half', 'progress']);
    expect([1, 2, 3, 4, 5].map(v => trackerGrade(tk({ type: 'rating', target: 2, aim: 'max' }), v, true))).toEqual(['met', 'met', 'good', 'half', 'low']);
    expect(['22:50', '23:10', '23:25', '23:50', '00:30'].map(v => trackerGrade(tk({ type: 'time', target: '23:00', aim: 'max' }), v, true))).toEqual(['met', 'good', 'half', 'low', 'miss']);
    expect([trackerGrade(tk({ type: 'check' }), true, true), trackerGrade(tk({ type: 'check' }), undefined, true), trackerGrade(tk({ type: 'check' }), undefined, false)]).toEqual(['met', 'miss', 'progress']);
    expect([0.8, 0.95, 0.6, 0.3, 0.1].map(rateGrade)).toEqual(['good', 'met', 'half', 'low', 'miss']);
    expect([0.8, 1, 0.6, 0.3, 0].map(gradeOf)).toEqual(['half', 'met', 'half', 'low', 'miss']);
  });

  it('old files without aims or kind colors import unchanged; the new fields round-trip', async () => {
    const tab = await openTab(); open.push(tab);
    const { normalizeSettings, kindColors } = tab.MB.schema;
    const old = normalizeSettings({ targets: { kcal: 2500, protein: 160 }, sessionKinds: ['BJJ', 'Strength'] });
    expect(old.targets.aim).toEqual({ kcal: 'near', protein: 'min', carbs: 'near', fat: 'near' });
    expect(old.sessionKinds.map(k => k.color)).toEqual(['', '']);
    expect(kindColors(old.sessionKinds)).toEqual({ bjj: 'blue', strength: 'violet' });
    const next = normalizeSettings({ targets: { kcal: 2500, aim: { kcal: 'max', protein: 'bogus' } }, sessionKinds: [{ name: 'BJJ', color: 'violet' }, { name: 'Run' }] });
    expect(next.targets.aim).toMatchObject({ kcal: 'max', protein: 'min' });
    expect(kindColors(next.sessionKinds)).toEqual({ bjj: 'violet', run: 'blue' });
    expect(normalizeSettings(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});
