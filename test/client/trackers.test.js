// 2.3: trackers of any kind, v4 data upgraded, setup history, folding, reordering, undo, status colors, packs, tags, nutrients, the Data tab.
import { describe, it, expect, afterEach } from 'vitest';
import { openTab, newDevice, seedDB, waitFor, loadExample } from './harness.js';

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
const todayOf = tab => tab.MB.ui.today();
const dayDoc = tab => tab.MB.store.get('days/' + todayOf(tab));
const tile = (tab, name) => tab.$$('#main .tk').find(x => x.querySelector('.habit-name').textContent === name);
const change = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('change')); };
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const pick = (tab, select, value) => { select.value = value; select.dispatchEvent(new tab.window.Event('change')); };
const save = tab => tab.button(tab.t('c.save'), '.sheet').click();
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('v4 data', () => {
  it('habits and tape measurements become trackers in two sections; the first setup change writes v5 and its history', async () => {
    const device = newDevice(), T = new Date(), pad = n => String(n).padStart(2, '0'), d = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    const today = d(T), y = d(new Date(T.getFullYear(), T.getMonth(), T.getDate() - 1));
    const v4 = { name: 'Sam', units: { weight: 'kg' }, targets: { kcal: 2500, protein: 160 }, habits: [{ id: 'water', name: 'Water', target: 8, unit: 'glasses' }, { id: 'steps', name: 'Steps' }], mealSlots: [{ id: 'b', name: 'Breakfast' }], updatedAt: '2026-01-01T08:00:00.000Z' };
    await seedDB(device.idb, 'tally', { 'm/profiles': { list: [{ id: 'default', name: 'Sam', createdAt: '2026-01-01T00:00:00.000Z' }] }, 'm/current': { id: 'default' }, 'p/default/settings/main': v4,
      ['p/default/days/' + y]: { date: y, habits: { water: 8, steps: true }, measures: { waist: 84 }, meals: [{ id: 'm', slot: 'b', name: 'Oats', kcal: 2500, p: 160, c: 0, f: 0 }], updatedAt: '2026-01-01T09:00:00.000Z' },
      ['p/default/days/' + today]: { date: today, habits: { water: 5 }, weight: 80.2, updatedAt: '2026-01-01T09:00:00.000Z' } });
    const tab = await openTab({ device, hash: '#today' }); open.push(tab);
    const t = tab.t;
    expect(tab.$$('#main .card-head h2').map(h => h.textContent)).toEqual(expect.arrayContaining([t('t.habits'), t('t.body')]));
    expect(tile(tab, 'Water').querySelector('.habit-sub').textContent).toBe('5 / 8 glasses');
    expect(tile(tab, t('m.weight')).querySelector('input').value).toBe('80.2');
    expect(tile(tab, t('m.waist'))).toBeTruthy(); /* it has a value, so it came back from the archive */
    expect(tile(tab, t('m.chest'))).toBeUndefined();
    expect(settings(tab).habits).toHaveLength(2); /* nothing written yet */
    /* yesterday met its targets under the old setup; raising them today leaves yesterday green */
    tab.$('#main .ringbox').click();
    typeIn(tab, tab.$$('.sheet input[type=number]')[0], '3500');
    save(tab);
    const s = settings(tab);
    expect(s.trackers.map(x => x.id)).toEqual(expect.arrayContaining(['water', 'steps', 'weight', 'm_waist', 'bodyFat']));
    expect(s.habits).toBeUndefined();
    expect(tab.MB.store.get('history/' + y)).toMatchObject({ date: y, targets: { kcal: 2500 } });
    expect(tab.MB.store.get('history/' + today)).toMatchObject({ date: today, targets: { kcal: 3500 } });
    tab.$('#main .dayhead button').click();
    await waitFor(() => tab.text('#main .dayhead h1') !== t('c.today'), { what: 'yesterday' });
    expect(tab.$('#main .ringnote').className).toBe('ringnote st-met');
    expect(tab.MB.store.get('days/' + y).habits).toEqual({ water: 8, steps: true }); /* stored days are untouched until edited */
    expect(tab.errors).toEqual([]);
  });
});

describe('trackers on Today', () => {
  it('each type has its own input; values land in the day', async () => {
    const first = await withExample(), s = settings(first);
    const tab = await reseed(first, { 'settings/main': { ...s, groups: [...s.groups, { id: 'rec', name: 'Recovery' }], trackers: [...s.trackers,
      { id: 'hrv', name: 'HRV', type: 'number', unit: 'ms', group: 'rec', freq: 'daily', target: 60 }, { id: 'mood', name: 'Mood', type: 'rating', target: 4, group: 'rec' },
      { id: 'bed', name: 'Bedtime', type: 'time', target: '23:00', aim: 'max', group: 'rec' }, { id: 'drill', name: 'Drilled', type: 'text', group: 'rec' }, { id: 'coffee', name: 'Coffee', type: 'count', target: 2, aim: 'max', group: 'rec' }] } });
    expect(tab.$$('#c-g_rec .habit-name').map(x => x.textContent)).toEqual(['HRV', 'Mood', 'Bedtime', 'Drilled', 'Coffee']);
    change(tab, tile(tab, 'HRV').querySelector('input'), '72');
    tile(tab, 'Mood').querySelectorAll('.rate-btn')[3].click();
    change(tab, tile(tab, 'Bedtime').querySelector('input'), '23:20');
    change(tab, tile(tab, 'Drilled').querySelector('input'), 'Knee cut');
    tile(tab, 'Coffee').click(); tile(tab, 'Coffee').click(); tile(tab, 'Coffee').click();
    const [hh, mm] = tile(tab, tab.t('pk.sleep')).querySelectorAll('input'); change(tab, hh, '7'); change(tab, mm, '45');
    expect(dayDoc(tab).values).toMatchObject({ hrv: 72, mood: 4, bed: '23:20', drill: 'Knee cut', coffee: 3, sleep: 465 });
    expect(tile(tab, 'HRV').dataset.grade).toBe('met');
    expect(tile(tab, 'Mood').dataset.grade).toBe('met');
    expect(tile(tab, 'Bedtime').dataset.grade).toBe('half'); /* 20 minutes late */
    expect(tile(tab, 'Coffee').dataset.grade).toBe('half'); /* over the limit counts at once */
    tile(tab, 'Coffee').querySelector('.habit-minus').click();
    expect(dayDoc(tab).values.coffee).toBe(2);
    tile(tab, 'Mood').querySelectorAll('.rate-btn')[3].click(); /* tapping the chosen rating clears it */
    expect(dayDoc(tab).values.mood).toBeUndefined();
    expect(tab.errors).toEqual([]);
  });

  it('a section sheet adds, archives, restores and deletes trackers; delete has Undo', async () => {
    const tab = await withExample();
    const t = tab.t, edit = () => [...tab.$$('#c-g_habits .card-head button')].find(b => b.textContent === t('c.edit')).click();
    edit();
    tab.button(t('tk.add'), '.sheet').click();
    typeIn(tab, tab.$('.sheet input[type=text]'), 'Push-ups');
    pick(tab, tab.$('.sheet select'), 'count');
    const f = tab.$$('.sheet .field').find(x => x.querySelector('span').textContent === t('tk.freq')).querySelector('select');
    pick(tab, f, 'weekly');
    save(tab);
    expect(settings(tab).trackers.find(x => x.id === 'push-ups')).toMatchObject({ type: 'count', freq: 'weekly', perWeek: 3 });
    expect(tile(tab, 'Push-ups').textContent).toContain(t('tk.thisWeek', { n: 0, of: 3 }));
    edit();
    [...tab.$$('.sheet .sortrow button.row-name')].find(b => b.textContent.startsWith('Push-ups')).click();
    tab.button(t('tk.archive'), '.sheet').click();
    expect(tile(tab, 'Push-ups')).toBeUndefined();
    edit();
    tab.button(t('tk.restore'), '.sheet').click();
    expect(tile(tab, 'Push-ups')).toBeTruthy();
    edit();
    [...tab.$$('.sheet .sortrow button.row-name')].find(b => b.textContent.startsWith('Push-ups')).click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(settings(tab).trackers.some(x => x.id === 'push-ups')).toBe(false);
    tab.$('.toast button').click();
    expect(settings(tab).trackers.some(x => x.id === 'push-ups')).toBe(true);
    expect(tab.errors).toEqual([]);
  });
});

describe('folding and order', () => {
  it('a card folds with a tap, shows a summary, and stays folded on this device', async () => {
    const tab = await withExample();
    tab.$('#c-meals .fold-btn').click();
    expect(tab.$('#c-meals').classList.contains('folded')).toBe(true);
    expect(tab.text('#c-meals .fold-sum')).toContain('kcal');
    expect(JSON.parse(tab.window.localStorage.getItem('tally:fold'))).toEqual({ 'today:meals': true });
    await tab.go('#plan'); await tab.go('#today');
    expect(tab.$('#c-meals').classList.contains('folded')).toBe(true);
    tab.$('#c-meals .fold-btn').click();
    expect(tab.$('#c-meals').classList.contains('folded')).toBe(false);
    expect(JSON.parse(tab.window.localStorage.getItem('tally:fold'))).toEqual({});
  });

  it('a finished section folds by itself; opening it keeps it open that day; the setting turns it off', async () => {
    const tab = await withExample();
    for (const el of tab.$$('#c-g_habits .tk')) {
      if (el.getAttribute('role') === 'button') { for (let i = 0; i < 10 && el.dataset.grade !== 'met'; i++) el.click(); }
      else change(tab, el.querySelector('input'), '8');
    }
    await waitFor(() => tab.$('#c-g_habits').classList.contains('folded'), { what: 'auto fold' });
    expect(tab.text('#c-g_habits .fold-sum')).toBe(tab.t('t.doneOf', { n: 4, of: 4 }));
    tab.$('#c-g_habits .fold-btn').click();
    await sleep(1100);
    expect(tab.$('#c-g_habits').classList.contains('folded')).toBe(false);
    await tab.go('#settings');
    const box = tab.$$('#main label.row').find(l => l.textContent.startsWith(tab.t('s.autoFold'))).querySelector('input');
    box.checked = false; box.dispatchEvent(new tab.window.Event('change'));
    expect(tab.window.localStorage.getItem('tally:autofold')).toBe('0');
  });

  it('meal slots drag into order in their sheet (arrow keys on the handle)', async () => {
    const tab = await withExample();
    const before = settings(tab).mealSlots.map(x => x.name);
    [...tab.$$('#c-meals .card-head button')].find(b => b.textContent === tab.t('c.edit')).click();
    tab.$$('.sheet .drag')[0].dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    save(tab);
    expect(settings(tab).mealSlots.map(x => x.name)).toEqual([before[1], before[0], ...before.slice(2)]);
    expect(tab.$$('#c-meals .slot-head h3').map(h => h.firstChild.textContent)).toEqual([before[1], before[0], ...before.slice(2)]);
    tab.$('.toast button').click(); /* Undo puts them back */
    expect(settings(tab).mealSlots.map(x => x.name)).toEqual(before);
  });
});

describe('colors, packs, tags, nutrients', () => {
  it('the color-blind palette is a setting on this device', async () => {
    const tab = await withExample('#settings');
    tab.button(tab.t('s.palCb'), '#main').click();
    expect(tab.document.documentElement.dataset.palette).toBe('cb');
    expect(tab.window.localStorage.getItem('tally:palette')).toBe('cb');
    const next = await openTab({ hash: '#today', localStorage: { 'tally:palette': 'cb' } }); open.push(next);
    expect(next.document.documentElement.dataset.palette).toBe('cb');
  });

  it('the BJJ pack brings recovery ratings, a category with fields, a belt; a session logs effort and fields', async () => {
    const tab = await openTab(); open.push(tab);
    const t = tab.t;
    expect(tab.$$('.tiles .tile.pack b').map(b => b.textContent)).toEqual(['general', 'bjj', 'runner', 'fatloss'].map(p => t('pk.' + p)));
    tab.$$('.tiles .tile.pack')[1].click();
    await waitFor(() => tab.$('#main .page.today'), { what: 'pack loaded' });
    const s = settings(tab);
    expect(s.groups.map(g => g.id)).toEqual(['habits', 'recovery', 'body']);
    expect(s.sessionKinds.find(k => k.id === 'bjj').fields.map(f => f.id)).toEqual(['rounds', 'focus']);
    expect(s.gates).toEqual([expect.objectContaining({ id: 'belt', name: t('pk.belt'), current: 1 })]); /* the belt is a progression */
    expect(s.rank).toBeUndefined();
    tab.button(t('t.addSession'), '#main').click();
    pick(tab, tab.$('.sheet select'), 'bjj-class');
    tab.button(t('c.next'), '.sheet').click();
    tab.$$('.sheet .effort .rate-btn')[7].click();
    typeIn(tab, tab.$$('.sheet .field').find(f => f.querySelector('span').textContent === t('pk.rounds')).querySelector('input'), '6');
    typeIn(tab, tab.$$('.sheet .field').find(f => f.querySelector('span').textContent === t('pk.focus')).querySelector('input'), 'Guard');
    save(tab);
    expect(dayDoc(tab).sessions[0]).toMatchObject({ typeId: 'bjj-class', effort: 8, fields: { rounds: 6, focus: 'Guard' } });
    expect(tab.text('#c-training')).toContain(t('t.effortN', { n: 8 }));
    expect(tab.errors).toEqual([]);
  });

  it('a skip tag keeps a day out of averages; tags compare on Progress', async () => {
    const first = await withExample(), { addDays, weekStart, today } = first.MB.ui, mon = addDays(weekStart(today()), -7), s = settings(first);
    const meal = kcal => [{ id: 'm' + kcal, slot: 'breakfast', name: 'Food', kcal, p: 100, c: 0, f: 0 }];
    const tab = await reseed(first, { ['days/' + mon]: { date: mon, meals: meal(2000), tags: [] }, ['days/' + addDays(mon, 1)]: { date: addDays(mon, 1), meals: meal(500), tags: ['sick'] } }, '#progress');
    tab.$('.pnav button').click();
    await waitFor(() => tab.$$('#main .wt-row.skipped').length === 1, { what: 'last week' });
    const avg = tab.$$('#main .stat').find(x => x.textContent.includes(tab.t('w.avgKcal')));
    expect(avg.querySelector('.big').textContent).toBe('2,000');
    tab.button(tab.t('p.tab.month'), '#main').click();
    if (mon.slice(0, 7) !== today().slice(0, 7)) tab.$('.pnav button').click();
    expect(tab.text('#c-tags')).toContain(s.tags.find(x => x.id === 'sick').name);
    expect(tab.errors).toEqual([]);
  });

  it('extra nutrients: targets, meals and the summary', async () => {
    const tab = await withExample();
    const t = tab.t;
    tab.$('#main .ringbox').click();
    tab.button(t('nu.add'), '.sheet').click();
    const row = tab.$$('.sheet .editor-row').at(-1), [name, unitIn, target] = row.querySelectorAll('input');
    typeIn(tab, name, 'Fiber'); typeIn(tab, unitIn, 'g'); typeIn(tab, target, '30');
    save(tab);
    expect(settings(tab).nutrients).toMatchObject([{ name: 'Fiber', unit: 'g', target: 30, aim: 'min' }]);
    tab.$$('#c-meals .slot-head button')[0].click();
    tab.button(t('t.custom'), '.sheet').click();
    typeIn(tab, tab.$('.sheet input[type=text]'), 'Beans');
    const fiber = tab.$$('.sheet .field').find(f => f.querySelector('span').textContent === 'Fiber (g)').querySelector('input');
    typeIn(tab, fiber, '12');
    tab.button(t('t.log'), '.sheet').click();
    expect(dayDoc(tab).meals.at(-1).n).toEqual({ fiber: 12 });
    expect(tab.$$('#main .macro').find(m => m.textContent.startsWith('Fiber')).textContent).toContain('12 / 30 g');
    expect(tab.errors).toEqual([]);
  });
});

describe('Progress: Data', () => {
  it('a month as a table, sortable, with columns to choose and CSV export', async () => {
    const first = await withExample(), { addDays, today } = first.MB.ui, y = addDays(today(), -1);
    const tab = await reseed(first, { ['days/' + y]: { date: y, values: { water: 6 }, meals: [{ id: 'a', slot: 'breakfast', name: 'Oats', kcal: 700, p: 40, c: 90, f: 12 }], weight: 180.5, note: 'ok' } }, '#progress');
    tab.button(tab.t('p.tab.data'), '#main').click();
    const heads = tab.$$('#main table.datatable th').map(th => th.textContent);
    expect(heads[0]).toContain(tab.t('p.dateCol'));
    expect(heads).toEqual(expect.arrayContaining([tab.t('c.kcal'), 'Water', tab.t('t.notes')]));
    if (y.slice(0, 7) === today().slice(0, 7)) {
      const row = tab.$$('#main table.datatable tbody tr').find(r => r.textContent.includes('Oats') || r.textContent.includes('700'));
      expect(row.textContent).toContain('6 glasses');
    }
    tab.button(tab.t('p.columns'), '#main').click();
    const box = tab.$$('.sheet label.row').find(l => l.textContent === 'Water').querySelector('input');
    box.checked = false; box.dispatchEvent(new tab.window.Event('change'));
    save(tab);
    expect(tab.$$('#main table.datatable th').map(th => th.textContent)).not.toContain('Water');
    tab.button(tab.t('p.csvAll'), '#main').click();
    await waitFor(() => tab.device.downloads.length, { what: 'csv' });
    const csv = await tab.device.downloads[0].blob.text();
    expect(csv.split('\n')[0]).toContain(tab.t('c.kcal'));
    expect(csv).toContain(y + ',700');
    expect(tab.errors).toEqual([]);
  });
});
