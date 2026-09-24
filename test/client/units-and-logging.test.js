// 2.4: US or metric units, the day start, merging two edits of one document, logging a workout (last time, rest,
// blocks not logged), the plan card's now-and-next, quick add, small-chart tiles on Progress, meals that remember their food.
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
async function reseed(tab, docs, hash = '#today') {
  await Promise.all(Object.entries(docs).map(([p, d]) => tab.MB.store.setDoc(p, { ...d, updatedAt: new Date().toISOString() })));
  const next = await openTab({ device: tab.device, hash }); open.push(next);
  return next;
}
const settings = tab => tab.MB.store.get('settings/main');
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const pick = (tab, select, value) => { select.value = value; select.dispatchEvent(new tab.window.Event('change')); };
const selectWith = (tab, value) => tab.$$('#main select').find(s => [...s.options].some(o => o.value === value));
const day = (date, d) => ({ date, values: {}, checks: {}, meals: [], sessions: [], tags: [], note: '', weight: null, ...d });
async function openLog(tab, typeId) {
  if (tab.window.location.hash !== '#today') await tab.go('#today');
  tab.button(tab.t('t.addSession'), '#main').click();
  pick(tab, tab.$('.sheet select'), typeId);
  tab.button(tab.t('c.next'), '.sheet').click();
}

describe('units', () => {
  it('switching to metric and back converts weights, set loads, tape, distance, targets and past targets', async () => {
    const first = await withExample();
    const s = settings(first), { addDays, today } = first.MB.ui, y = addDays(today(), -1);
    const run = { id: 'run-dist', name: 'Run', type: 'number', unit: 'mi', target: 3, aim: 'min', freq: 'daily', group: 'habits' };
    const tab = await reseed(first, {
      'settings/main': { ...s, trackers: [...s.trackers, run] },
      ['history/' + y]: { date: y, ...first.MB.schema.snapshot(first.MB.schema.normalizeSettings({ ...s, trackers: [...s.trackers, { ...run, target: 2 }] })) },
      ['days/' + y]: day(y, { weight: 200, values: { m_waist: 34, 'run-dist': 3.1 }, sessions: [{ id: 's1', typeId: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, done: true, effort: 7, fields: {}, sets: [{ ex: 'DB press', exerciseId: 'db-press', wt: 45, reps: 10 }] }] })
    }, '#settings');
    const t = tab.t;
    expect([...selectWith(tab, 'metric').options].map(o => o.textContent)).toEqual([t('s.sys.us'), t('s.sys.metric')]);
    pick(tab, selectWith(tab, 'metric'), 'metric');
    let st = settings(tab), d = tab.MB.store.get('days/' + y);
    expect(st.units).toEqual({ system: 'metric', weight: 'kg' });
    expect(st.trackers.find(x => x.id === 'm_waist').unit).toBe('cm');
    expect(st.trackers.find(x => x.id === 'run-dist')).toMatchObject({ unit: 'km', target: 4.83 });
    expect(d).toMatchObject({ weight: 90.7, values: { m_waist: 86.4, 'run-dist': 4.99 } });
    expect(d.sessions[0].sets[0].wt).toBe(20.4);
    expect(tab.MB.store.get('history/' + y).trackers.find(x => x.id === 'run-dist').target).toBe(3.22);
    pick(tab, selectWith(tab, 'us'), 'us');
    st = settings(tab); d = tab.MB.store.get('days/' + y);
    expect(st.units).toEqual({ system: 'us', weight: 'lb' });
    expect(st.trackers.find(x => x.id === 'run-dist')).toMatchObject({ unit: 'mi', target: 3 });
    expect(d).toMatchObject({ weight: 200, values: { m_waist: 34, 'run-dist': 3.1 } });
    expect(tab.errors).toEqual([]);
  });

  it('starter packs follow the units; old files with only a weight unit read as a system', async () => {
    const tab = await openTab(); open.push(tab);
    const SC = tab.MB.schema;
    const metric = SC.normalizeSettings(SC.starterProfile('runner', 'metric').settings), us = SC.normalizeSettings(SC.starterProfile('runner', 'us').settings);
    expect(metric.units).toEqual({ system: 'metric', weight: 'kg' });
    expect(metric.sessionKinds.find(k => k.id === 'run').fields.find(f => f.id === 'distance').unit).toBe('km');
    expect(us.sessionKinds.find(k => k.id === 'run').fields.find(f => f.id === 'distance').unit).toBe('mi');
    expect(SC.normalizeSettings({ units: { weight: 'kg' } }).units).toEqual({ system: 'metric', weight: 'kg' });
    expect(SC.normalizeSettings({ units: { weight: 'lb' } }).units).toEqual({ system: 'us', weight: 'lb' });
    expect(SC.convertUnit(98.6, '°F', 'metric')).toEqual({ unit: '°C', v: 37 });
    expect(SC.convertUnit(5, 'glasses', 'metric')).toBeNull();
  });
});

describe('the day start', () => {
  it('a later day start keeps the night on the day before', async () => {
    const tab = await withExample('#settings');
    const pad = n => String(n).padStart(2, '0'), local = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    pick(tab, selectWith(tab, '04:00'), '04:00');
    expect(settings(tab).dayStart).toBe('04:00');
    expect(tab.MB.ui.dayStartMin()).toBe(240);
    expect(tab.MB.ui.today()).toBe(local(new Date(Date.now() - 4 * 3600e3)));
    pick(tab, selectWith(tab, '04:00'), '00:00');
    expect(tab.MB.ui.today()).toBe(local(new Date()));
    expect(tab.errors).toEqual([]);
  });
});

describe('merging two edits of one document', () => {
  it('keeps what each side changed, drops what one side removed, and lets the newer copy win a value both changed', async () => {
    const tab = await openTab(); open.push(tab);
    const { merge3, mergeDoc } = tab.MB.schema;
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 });
    expect(merge3([{ id: 1, n: 'x' }, { id: 2 }], [{ id: 1, n: 'x' }], [{ id: 1, n: 'y' }, { id: 2 }, { id: 3 }])).toEqual([{ id: 1, n: 'y' }, { id: 3 }]);
    expect(merge3(null, { values: { water: 1 } }, { values: { steps: true } }, true)).toEqual({ values: { water: 1, steps: true } });
    expect(merge3({ note: 'a' }, { note: 'b' }, { note: 'c' }, true).note).toBe('c');
    expect(merge3({ note: 'a' }, { note: 'b' }, { note: 'c' }, false).note).toBe('b');
    expect(merge3(['a'], ['a', 'b'], [])).toEqual(['b']);
    const d = '2026-09-01', base = day(d, { values: { water: 2 } });
    const merged = mergeDoc('days/' + d, base, { ...day(d, { values: { water: 3 } }), updatedAt: '2026-09-01T10:00:00.000Z' }, { ...day(d, { values: { water: 2, sleep: 480 }, checks: { morning: { a: true } } }), updatedAt: '2026-09-01T09:00:00.000Z' });
    expect(merged).toMatchObject({ values: { water: 3, sleep: 480 }, checks: { morning: { a: true } } });
  });
});

describe('logging a workout', () => {
  it('blocks marked not logged stay out; last time can be repeated per exercise or for all; rest starts a timer', async () => {
    const first = await withExample();
    const s = settings(first), { addDays, today } = first.MB.ui, y = addDays(today(), -2);
    const types = s.sessionTypes.map(x => x.id === 'upper' ? { ...x, plan: x.plan.map((b, i) => i === 0 ? { ...b, log: false } : b) } : x);
    const tab = await reseed(first, {
      'settings/main': { ...s, sessionTypes: types },
      ['days/' + y]: day(y, { sessions: [{ id: 'old', typeId: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, done: true, effort: 7, fields: {}, sets: [{ ex: 'DB press', exerciseId: 'db-press', wt: 40, reps: 10 }, { ex: 'DB press', exerciseId: 'db-press', wt: 40, reps: 9 }] }] })
    });
    const t = tab.t;
    await openLog(tab, 'upper');
    const groups = tab.$$('.sheet .exgroup');
    expect(groups.map(g => g.querySelector('.exhead').textContent)).toEqual(expect.not.arrayContaining([expect.stringContaining(t('ex.pushups'))]));
    expect(groups).toHaveLength(2); /* block A (push-ups, rows) is not logged */
    const press = groups[0];
    expect(press.querySelector('.lastline').textContent).toContain('40');
    press.querySelector('.lastline .linkbtn').click();
    const again = tab.$$('.sheet .exgroup')[0].querySelectorAll('.setrow');
    expect(again).toHaveLength(2);
    expect(again[0].querySelectorAll('input')[0].value).toBe('40');
    expect(again[1].querySelectorAll('input')[1].value).toBe('9');
    tab.$('.sheet .fillall').click(); /* the other exercise had nothing last time; nothing breaks */
    tab.button(t('c.save'), '.sheet').click();
    expect(tab.MB.store.get('days/' + today()).sessions[0].sets.filter(r => r.exerciseId === 'db-press').map(r => r.reps)).toEqual([10, 9]);

    await openLog(tab, 'lower'); /* goblet squats rest 90 s */
    const rest = tab.$('.sheet .restbtn');
    expect(rest.textContent).toContain('1:30');
    rest.click();
    const pill = tab.$('.restpill');
    expect(pill.textContent).toContain('1:30');
    pill.click();
    expect(tab.$('.restpill')).toBeNull();
    expect(tab.errors).toEqual([]);
  });
});

describe('Today', () => {
  it('a long day shows the plan around now; the whole day is a tap away and remembered', async () => {
    const first = await withExample();
    const s = settings(first), DAYS = first.MB.ui.DAYS, extra = ['01:00', '02:00', '03:00', '04:00'].map((start, i) => ({ id: 'x' + i, days: DAYS, start, end: start.replace(':00', ':20'), kind: 'other', title: 'Extra ' + i }));
    const tab = await reseed(first, { 'settings/main': { ...s, calendar: [...s.calendar, ...extra] } });
    const total = tab.MB.schema.blocksFor(tab.MB.schema.normalizeSettings(settings(tab)), tab.MB.ui.dow(tab.MB.ui.today())).length;
    const rows = () => tab.$$('#c-plan .tl-row').length;
    expect(total).toBeGreaterThan(7);
    expect(rows()).toBeLessThan(total);
    tab.$('#c-plan .tl-more').click();
    expect(rows()).toBe(total);
    expect(tab.window.localStorage.getItem('tally:planAll')).toBe('1');
    tab.$('#c-plan .tl-more').click();
    expect(rows()).toBeLessThan(total);
    expect(tab.errors).toEqual([]);
  });

  it('quick add logs the weight, and a meal from a food remembers the food', async () => {
    const tab = await withExample();
    const t = tab.t, { today } = tab.MB.ui;
    tab.$('#main .fab').click();
    expect(tab.text('.sheet-head h3')).toBe(t('q.title'));
    typeIn(tab, tab.$('.sheet .quickw input'), '181.5');
    tab.button(t('c.save'), '.sheet .quickw').click();
    expect(tab.MB.store.get('days/' + today()).weight).toBe(181.5);
    tab.$('#main .fab').click();
    tab.$$('.sheet .chips .chip')[0].click(); /* the first meal of the day */
    const add = tab.$$('.sheet .row.pick').find(r => r.textContent.includes(t('food.banana'))).querySelector('button.primary');
    add.click();
    expect(tab.MB.store.get('days/' + today()).meals).toEqual([expect.objectContaining({ foodId: 'banana', qty: 1 })]);
    expect(tab.errors).toEqual([]);
  });
});

describe('Progress', () => {
  it('trackers and workout fields show as small-chart tiles; a tap opens the whole line; Data has the fields', async () => {
    const tab = await openTab(); open.push(tab);
    const t = tab.t;
    tab.$$('.tiles .tile.pack')[1].click(); /* BJJ athlete: sleep, ratings; BJJ logs rounds */
    await waitFor(() => tab.$('#main .page.today'), { what: 'pack loaded' });
    const { addDays, today } = tab.MB.ui, s = settings(tab);
    const bjj = (date, rounds) => ({ id: 's' + date, typeId: 'bjj-class', name: 'Class', kind: 'bjj', minutes: 90, kcal: 750, done: true, effort: 8, fields: { rounds }, sets: [] });
    const days = [0, 1, 2].map(i => addDays(today(), -i)).filter(d => d.slice(0, 7) === today().slice(0, 7));
    const next = await reseed(tab, Object.fromEntries(days.map((d, i) => ['days/' + d, day(d, { values: { sleep: 420 + i * 20, soreness: 2 + (i % 2) }, sessions: [bjj(d, 4 + i)] })])), '#progress');
    next.button(t('p.tab.month'), '#main').click();
    const tiles = next.$$('#c-trackers .spk');
    expect(tiles.map(x => x.querySelector('.spk-name').textContent)).toEqual(expect.arrayContaining([t('pk.sleep'), t('pk.soreness')]));
    const rounds = next.$$('#c-fields .spk').find(x => x.textContent.includes(t('pk.rounds')));
    expect(rounds).toBeTruthy();
    if (days.length > 1) expect(rounds.querySelector('svg.spark')).not.toBeNull();
    tiles.find(x => x.textContent.includes(t('pk.sleep'))).click();
    expect(next.text('.sheet-head h3')).toBe(t('pk.sleep'));
    next.MB.ui.closeSheet();
    rounds.click();
    expect(next.$('.sheet')).not.toBeNull();
    next.MB.ui.closeSheet();
    next.button(t('p.tab.data'), '#main').click();
    expect(next.$$('#main thead th').map(th => th.textContent)).toEqual(expect.arrayContaining([`${s.sessionKinds.find(k => k.id === 'bjj').name} · ${t('pk.rounds')}`]));
    expect(next.errors).toEqual([]);
  });
});
