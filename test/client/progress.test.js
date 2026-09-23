// Progress as a week, a month or a year; cards can be hidden; the Plan calendar with overnight and overlapping blocks.
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
async function reseed(tab, docs, hash) {
  await Promise.all(Object.entries(docs).map(([p, d]) => tab.MB.store.setDoc(p, { ...d, updatedAt: new Date().toISOString() })));
  const next = await openTab({ device: tab.device, hash }); open.push(next);
  return next;
}
const settings = tab => tab.MB.store.get('settings/main');
const day = (date, d) => ({ date, values: {}, checks: {}, meals: [], sessions: [], tags: [], note: '', weight: null, ...d });
/* a value that meets each daily tracker: checks, counts and durations */
const allMet = s => Object.fromEntries(s.trackers.filter(x => x.freq === 'daily').map(x => [x.id, x.type === 'check' ? true : x.target]));
const rowNames = s => [...s.trackers.filter(x => x.freq !== 'any' && !x.archived).map(x => x.name), ...s.routines.map(x => x.name)];
const headings = tab => tab.$$('#main .card-head h2').map(h => h.textContent);
const tabTo = (tab, key) => tab.button(tab.t('p.tab.' + key), '#main').click();

/* last week, fully in the past: Monday on target with a workout and everything done, Tuesday well short, Wednesday nothing logged */
async function lastWeek() {
  const first = await withExample();
  const { addDays, weekStart, today } = first.MB.ui, s = settings(first), mon = addDays(weekStart(today()), -7);
  const morning = Object.fromEntries(s.routines[0].items.map(i => [i.id, true]));
  const tab = await reseed(first, {
    ['days/' + mon]: day(mon, { meals: [{ id: 'a', slot: 'breakfast', name: 'Big', kcal: s.targets.kcal, p: s.targets.protein, c: 0, f: 0 }], values: allMet(s), checks: { [s.routines[0].id]: morning }, sessions: [{ id: 's', typeId: 'upper', name: 'Upper body', kind: 'strength', minutes: 45, kcal: 300, done: true, effort: 7, notes: '', sets: [] }], weight: 180 }),
    ['days/' + addDays(mon, 1)]: day(addDays(mon, 1), { meals: [{ id: 'b', slot: 'breakfast', name: 'Small', kcal: 500, p: 20, c: 0, f: 0 }], values: { water: 2 }, weight: 181 })
  }, '#progress');
  return { tab, mon, s };
}

describe('Progress: week', () => {
  it('a row per day colored by status, planned sessions done, habits day by day, and back to that day on Today', async () => {
    const { tab, mon } = await lastWeek();
    const t = tab.t;
    expect(tab.$('#main .seg-btn.on').textContent).toBe(t('p.tab.week'));
    expect(tab.$('.pnav button:last-child').disabled).toBe(true); /* nothing after this week */
    tab.button('‹', '.pnav').click();
    await waitFor(() => tab.text('.pnav-label b') === t('w.weekOf', { d: tab.MB.ui.fmtShort(mon) }), { what: 'last week' });
    const rows = tab.$$('#main .wt-row:not(.wt-head)');
    expect(rows).toHaveLength(7);
    expect(rows[0].querySelectorAll('.st-met')).toHaveLength(3); /* calories, protein, everything done */
    expect([rows[1].children[1].className, rows[1].children[2].className]).toEqual(['st-low', 'st-low']); /* calories and protein: something, under half */
    expect(rows[0].querySelector('.wt-train i')).not.toBeNull();
    expect(rows[1].textContent).toContain(t('t.missed')); /* a planned run, not done */
    const sessions = tab.$$('#main .stat').find(x => x.textContent.includes(t('p.plannedDone')));
    expect(sessions.querySelector('.big').textContent).toMatch(/^1\/\d+$/);
    /* training: plan against what happened, with effort */
    expect(tab.$('#c-training .tw-done').textContent).toContain(t('t.effortN', { n: 7 }));
    expect(tab.$$('#c-training .tw-missed').length).toBeGreaterThan(0);
    expect(tab.text('#c-training')).toContain(t('p.load', { n: 315 }));
    const matrix = tab.$$('#c-consistency .mx-row:not(.mx-head)');
    expect(matrix.map(r => r.querySelector('.mx-name').textContent)).toEqual(rowNames(settings(tab)));
    expect(matrix[0].querySelectorAll('.mx.g-met')).toHaveLength(1);
    expect(matrix[0].querySelectorAll('.mx.g-low')).toHaveLength(1); /* Tuesday: 2 of 8 glasses */
    /* a row opens its year: calendar and streaks */
    matrix[0].click();
    expect(tab.text('.sheet-head h3')).toBe(settings(tab).trackers[0].name);
    expect(tab.$('.sheet svg.heat')).not.toBeNull();
    tab.MB.ui.closeSheet();
    rows[1].click();
    await waitFor(() => tab.window.location.hash === '#today' && tab.text('#main .dayhead h1') !== t('c.today'), { what: 'that day' });
    expect(tab.MB.store.get('days/' + tab.MB.ui.addDays(mon, 1)).meals[0].name).toBe('Small');
    expect(tab.errors).toEqual([]);
  });
});

describe('Progress: month and year', () => {
  it('month: a calendar tinted by each day, daily nutrition, habit and routine rates', async () => {
    const { tab, mon } = await lastWeek();
    const t = tab.t;
    tabTo(tab, 'month');
    if (mon.slice(0, 7) !== tab.MB.ui.today().slice(0, 7)) tab.button('‹', '.pnav').click();
    expect(headings(tab)).toEqual(expect.arrayContaining([t('p.glance'), t('p.nutrition'), t('p.bodyweight'), t('p.trainingTitle'), t('p.consistency')]));
    const cell = n => tab.$$('#main .mg').find(c => c.firstChild.textContent === String(+n.slice(8)));
    expect(cell(mon).className).toContain('st-met');
    expect(cell(mon).querySelector('i')).not.toBeNull(); /* trained */
    expect(cell(tab.MB.ui.addDays(mon, 1)).className).toContain('st-low');
    const rates = tab.$$('#c-consistency .rate');
    expect(rates.length).toBe(rowNames(settings(tab)).length);
    expect(rates[0].querySelector('b').textContent).toBe('50%'); /* water on 1 of 2 logged days */
    expect(tab.errors).toEqual([]);
  });

  it('year: highlights, monthly nutrition and training, a grid of trackers by month', async () => {
    const { tab, mon } = await lastWeek();
    const t = tab.t;
    tabTo(tab, 'year');
    expect(tab.text('.pnav-label b')).toBe(t('p.thisYear'));
    if (mon.slice(0, 4) !== tab.MB.ui.today().slice(0, 4)) tab.button('‹', '.pnav').click(); /* first days of January */
    expect(headings(tab)).toEqual(expect.arrayContaining([t('p.highlights'), t('p.bodyweight'), t('p.nutritionMonthly'), t('p.trainingTitle'), t('p.consistency')]));
    const days = tab.$$('#c-highlights .stat').find(x => x.textContent.includes(t('p.daysLogged')));
    expect(days.querySelector('.big').textContent).toBe('2');
    const grid = tab.$('#c-consistency .ygrid');
    expect(grid.querySelector('.yg-name').nextElementSibling).not.toBeNull();
    expect(tab.$$('#c-consistency button.yg-name').map(b => b.textContent)).toEqual(rowNames(settings(tab)));
    expect(tab.$$('#c-consistency .yg.g-half').map(c => c.textContent)).toContain('50'); /* water on 1 of 2 logged days */
    expect(tab.errors).toEqual([]);
  });

  it('Customize hides cards everywhere and brings them back; nothing is deleted', async () => {
    const { tab } = await lastWeek();
    const t = tab.t;
    tabTo(tab, 'month');
    const toggle = (label, on) => { tab.button(t('p.customize'), '#main').click(); const box = tab.$$('.sheet label.row').find(l => l.textContent === label).querySelector('input'); box.checked = on; box.dispatchEvent(new tab.window.Event('change')); tab.button(t('c.save'), '.sheet').click(); };
    toggle(t('p.card.weight'), false);
    expect(settings(tab).progress.hide).toEqual(['weight']);
    expect(headings(tab)).not.toContain(t('p.bodyweight'));
    tabTo(tab, 'week');
    expect(headings(tab)).not.toContain(t('p.bodyweight'));
    toggle(t('p.card.weight'), true);
    expect(headings(tab)).toContain(t('p.bodyweight'));
    expect(tab.MB.store.list('days').filter(d => d.weight != null)).toHaveLength(2);
    expect(tab.errors).toEqual([]);
  });
});

describe('Plan', () => {
  it('an overnight block continues at the top of the next day; overlapping blocks share the width', async () => {
    const first = await withExample('#plan'), s = settings(first);
    const cal = [{ id: 'sleep', days: ['mon'], start: '22:45', end: '07:00', kind: 'sleep', title: 'Sleep' },
      { id: 'a', days: ['wed'], start: '12:00', end: '13:00', kind: 'session', typeId: 'upper' }, { id: 'b', days: ['wed'], start: '12:30', end: '13:30', kind: 'meal', slotId: 'lunch' }, { id: 'r', days: ['sun'], kind: 'rest', title: 'Rest day' }];
    const tab = await reseed(first, { 'settings/main': { ...s, calendar: cal } }, '#plan');
    const col = d => tab.$$('#main .cal-day')[d].querySelector('.cal-col');
    const mon = col(0).querySelector('.cblock'), tue = col(1).querySelector('.cblock');
    expect(mon.textContent).toContain('Sleep');
    expect(parseFloat(mon.style.top) + parseFloat(mon.style.height)).toBeCloseTo(parseFloat(col(0).style.height) - 1, 0); /* runs to the bottom */
    expect(tue.classList.contains('cont')).toBe(true);
    expect(tue.textContent).toContain(tab.t('pl.until', { t: tab.MB.ui.fmtTime('07:00') }));
    /* an untimed item on one day gives every day (and the hour axis) the same row, so the hours line up */
    const rows = tab.$$('#main .cal-untimed');
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map(r => r.style.height)).size).toBe(1);
    expect(tab.$('#main .cal-axis').children[1].style.height).toBe(rows[0].style.height);
    expect(rows[6].textContent).toBe('Rest day');
    const wed = [...col(2).querySelectorAll('.cblock')];
    expect(wed.map(b => b.style.width)).toEqual(['calc(50% - 4px)', 'calc(50% - 4px)']);
    wed[0].click();
    expect(tab.button(tab.t('c.edit'), '.sheet')).not.toBeNull();
    tab.button(tab.t('c.delete'), '.sheet').click();
    expect(settings(tab).calendar.map(b => b.id)).toEqual(['sleep', 'b', 'r']);
    tab.$('.toast button').click(); /* undo */
    expect(settings(tab).calendar.map(b => b.id)).toEqual(['sleep', 'a', 'b', 'r']);
    expect(tab.errors).toEqual([]);
  });

  it('shows planned training per weekday with the weekly total', async () => {
    const tab = await withExample('#plan');
    const planned = tab.MB.ui.DAYS.flatMap(d => tab.MB.schema.plannedFor(settings(tab), d));
    expect(tab.text('#c-glance .count')).toContain(String(planned.length));
    expect(tab.$$('#c-glance .kchip').length).toBeGreaterThan(0);
    expect(tab.errors).toEqual([]);
  });
});
