// 2.5 cleanup: a new profile starts clean, one clear action per card, deletes and how-tos where they belong, counts
// that read right at one, and totals only where they add up.
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
const pick = (tab, select, value) => { select.value = value; select.dispatchEvent(new tab.window.Event('change')); };
const day = (date, d) => ({ date, values: {}, checks: {}, meals: [], sessions: [], tags: [], note: '', weight: null, ...d });

describe('a new profile', () => {
  it('does not count the days before it started as missed', async () => {
    const tab = await withExample('#progress');
    const t = tab.t;
    tab.button('‹', '.pnav').click(); /* last week: all before the profile's first day */
    await waitFor(() => tab.text('.pnav-label b') !== t('w.thisWeek'), { what: 'last week' });
    expect(tab.$$('#main .wt-row:not(.wt-head)')).toHaveLength(7);
    expect(tab.text('#main')).not.toContain(t('t.missed'));
    expect(tab.$$('#c-consistency .mx.g-miss, #c-consistency .mx.g-low')).toHaveLength(0);
    expect(tab.errors).toEqual([]);
  });

  it('a day logged before the first day counts from then on', async () => {
    const first = await withExample();
    const { addDays, weekStart, today } = first.MB.ui, mon = addDays(weekStart(today()), -7);
    const tab = await reseed(first, { ['days/' + mon]: day(mon, { weight: 180 }) }, '#progress');
    tab.button('‹', '.pnav').click();
    await waitFor(() => tab.text('.pnav-label b') !== tab.t('w.thisWeek'), { what: 'last week' });
    expect(tab.text('#main .wt-row:not(.wt-head)')).not.toBeNull();
    expect(tab.$$('#c-consistency .mx.g-miss').length).toBeGreaterThan(0); /* from Monday on, habits were expected */
    expect(tab.errors).toEqual([]);
  });
});

describe('Today: one clear action per card', () => {
  it('only one meal has the orange Add (the one due now, or on another day the first empty one), and one workout its Log', async () => {
    const tab = await withExample();
    expect(tab.$$('#c-meals .slot-head .btn.primary')).toHaveLength(1);
    expect(tab.$$('#c-training .btn.primary').length).toBeLessThanOrEqual(1); /* workouts too: only the one due */
    tab.$('#main .dayhead button').click(); /* yesterday */
    await waitFor(() => tab.text('#main .dayhead h1') !== tab.t('c.today'), { what: 'yesterday' });
    const slots = tab.$$('#c-meals .slot');
    expect(slots[0].querySelector('.slot-head .btn.primary')).not.toBeNull();
    expect(slots.slice(1).some(s => s.querySelector('.slot-head .btn.primary'))).toBe(false);
    expect(tab.errors).toEqual([]);
  });

  it('a checklist row checks with a tap anywhere; its info button opens the exercise without checking it', async () => {
    const tab = await withExample();
    const r = settings(tab).routines[0], row = () => tab.$$('#c-checklists .cl-body .row')[0], checked = () => !!((tab.MB.store.get('days/' + tab.MB.ui.today()) || { checks: {} }).checks[r.id] || {})[r.items[0].id];
    if (tab.$('#c-checklists .cl-body.hidden')) tab.$('#c-checklists .cl-head').click();
    expect(row().querySelector('.linkish')).toBeNull();
    row().querySelector('.infobtn').click();
    expect(tab.text('.sheet-head h3')).toBe(r.items[0].name);
    expect(checked()).toBe(false);
    tab.MB.ui.closeSheet();
    row().querySelector('.row-name').click();
    expect(checked()).toBe(true);
    expect(tab.errors).toEqual([]);
  });

  it('a logged workout is removed from its sheet, with undo; the card has no delete cross', async () => {
    const tab = await withExample();
    const t = tab.t, sessions = () => (tab.MB.store.get('days/' + tab.MB.ui.today()) || { sessions: [] }).sessions;
    tab.button(t('t.addSession'), '#main').click();
    pick(tab, tab.$('.sheet select'), settings(tab).sessionTypes[0].id);
    tab.button(t('c.next'), '.sheet').click();
    tab.button(t('c.save'), '.sheet').click();
    expect(sessions()).toHaveLength(1);
    expect(tab.$$('#c-training .sess.done button').map(b => b.textContent)).toEqual([t('t.details')]);
    tab.button(t('t.details'), '#c-training').click();
    tab.button(t('c.remove'), '.sheet').click();
    expect(sessions()).toHaveLength(0);
    tab.$('.toast button').click(); /* undo */
    expect(sessions()).toHaveLength(1);
    expect(tab.errors).toEqual([]);
  });

  it('the backup reminder can wait two weeks, and is not shown while the profile syncs', async () => {
    const first = await withExample();
    const { addDays, today } = first.MB.ui;
    const tab = await reseed(first, Object.fromEntries([...Array(8)].map((_, i) => addDays(today(), -i - 1)).map(d => ['days/' + d, day(d, { weight: 180 })])));
    expect(tab.$('#main .nudge')).not.toBeNull();
    tab.button(tab.t('c.later'), '#main .nudge').click();
    expect(tab.$('#main .nudge')).toBeNull();
    await tab.go('#plan'); await tab.go('#today');
    expect(tab.$('#main .nudge')).toBeNull();
    expect(tab.window.localStorage.getItem('tally:backupLater')).toBe(addDays(today(), 14));
    expect(tab.errors).toEqual([]);
  });
});

describe('words and numbers', () => {
  it('counts read right at one', async () => {
    const tab = await openTab(); open.push(tab);
    for (const lang of ['en', 'es', 'de']) {
      tab.MB.i18n.set(lang, false);
      expect(tab.t('p.nDays', { n: 1 })).not.toBe(tab.t('p.nDays', { n: 2 }).replace('2', '1'));
    }
    tab.MB.i18n.set('en', false);
    expect([tab.t('p.nDays', { n: 1 }), tab.t('p.nDays', { n: 3 }), tab.t('pl.blocksN', { n: 1 }), tab.t('p.sessionsN', { n: 0 })]).toEqual(['1 day', '3 days', '1 block', '0 sessions']);
    expect(tab.MB.i18n.unit('pl.workoutsN', 1)).toBe('workout');
    expect(Array.isArray(tab.t('pl.workoutsN'))).toBe(true);
  });

  it('workout fields: distance shows its total, heart rate its average', async () => {
    const tab = await openTab(); open.push(tab);
    const t = tab.t;
    tab.$$('.tiles .tile.pack')[2].click(); /* Runner: runs log distance */
    await waitFor(() => tab.$('#main .page.today'), { what: 'pack loaded' });
    const { today } = tab.MB.ui, s = settings(tab);
    s.sessionKinds.find(k => k.id === 'run').fields.push({ id: 'hr', name: 'Avg HR', type: 'number', unit: 'bpm' });
    const run = { id: 'r1', typeId: 'easy-run', name: 'Easy run', kind: 'run', minutes: 40, kcal: 420, done: true, effort: 5, fields: { distance: 4, hr: 150 }, sets: [] };
    const run2 = { ...run, id: 'r2', fields: { distance: 3, hr: 140 } };
    const next = await reseed(tab, { 'settings/main': s, ['days/' + today()]: day(today(), { sessions: [run, run2] }) }, '#progress');
    next.button(t('p.tab.month'), '#main').click();
    const tile = name => next.$$('#c-fields .spk').find(x => x.querySelector('.spk-name').textContent.includes(name));
    expect(tile(t('pk.distance')).textContent).toContain(t('p.totalV', { v: '7 mi' }));
    expect(tile('Avg HR').textContent).toContain(t('p.avgV', { v: '145 bpm' }));
    expect(tile('Avg HR').textContent).not.toContain(t('p.totalV', { v: '' }).trim());
    expect(next.errors).toEqual([]);
  });
});

describe('Plan and Library', () => {
  it('the week card carries the training total and categories; no separate chart', async () => {
    const tab = await withExample('#plan');
    expect(tab.$('#c-glance')).toBeNull();
    const planned = tab.MB.ui.DAYS.flatMap(d => tab.MB.schema.plannedFor(tab.MB.schema.normalizeSettings(settings(tab)), d));
    expect(tab.text('#c-plan .card-head .count')).toBe(`${planned.length} ${tab.MB.i18n.unit('pl.workoutsN', planned.length)} · ${tab.MB.ui.fmt1(planned.reduce((a, p) => a + p.minutes, 0) / 60)} h`);
    expect(tab.$('.topbar select')).toBeNull(); /* the language is in Settings */
    expect(tab.errors).toEqual([]);
  });
});
