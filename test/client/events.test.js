// Events: one-off things on a date. Big ones stand out and count down; an event can tag its days and take them off the
// plan. Progressions date their steps up as events, and an old rank becomes a progression with its promotions as events.
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
const settings = tab => tab.MB.store.get('settings/main');
const events = tab => tab.MB.store.list('events');
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const change = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('change')); };
const pick = (tab, select, value) => { select.value = value; select.dispatchEvent(new tab.window.Event('change')); };
const save = tab => tab.button(tab.t('c.save'), '.sheet').click();
const tick = (tab, label) => { const row = tab.$$('.sheet label.row').find(l => l.querySelector('.row-name').firstChild.textContent === label); row.querySelector('input').checked = true; row.querySelector('input').dispatchEvent(new tab.window.Event('change')); };
function fillEvent(tab, { title, date, end, big, offPlan, tag }) {
  typeIn(tab, tab.$$('.sheet .field').find(f => f.querySelector('span').textContent === tab.t('ev.what')).querySelector('input'), title);
  if (date) change(tab, tab.$$('.sheet input[type=date]')[0], date);
  if (end) { tick(tab, tab.t('ev.multi')); change(tab, tab.$$('.sheet input[type=date]')[1], end); }
  if (tag) pick(tab, tab.$('.sheet select'), tag);
  if (big) tick(tab, tab.t('ev.big'));
  if (offPlan) tick(tab, tab.t('ev.offPlan'));
  save(tab);
}

describe('events', () => {
  it('a big event ahead counts down on Today and shows on Plan; deleting it has undo', async () => {
    const tab = await withExample();
    const t = tab.t, { addDays, today } = tab.MB.ui, when = addDays(today(), 10);
    tab.button(t('ev.add'), '#c-day').click();
    fillEvent(tab, { title: 'Fall Open', date: when, big: true });
    expect(events(tab)).toEqual([expect.objectContaining({ id: 'fall-open-' + when, date: when, title: 'Fall Open', big: true, offPlan: false })]);
    const cd = tab.$('#main .evstrip .evchip.countdown');
    expect(cd.textContent).toContain('Fall Open');
    expect(cd.textContent).toContain(t('ev.inDays', { n: 10 }));
    await tab.go('#plan');
    expect(tab.text('#c-events')).toContain('Fall Open');
    tab.$('#c-events .evrow').click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(events(tab)).toEqual([]);
    tab.$('.toast button').click();
    expect(events(tab).map(e => e.title)).toEqual(['Fall Open']);
    expect(tab.errors).toEqual([]);
  });

  it('an event tags its days and can take them off the plan', async () => {
    const tab = await withExample();
    const t = tab.t, { addDays, dow, today } = tab.MB.ui, SC = tab.MB.schema, st = SC.normalizeSettings(settings(tab));
    let n = 0; while (!SC.plannedFor(st, dow(addDays(today(), n))).length) n++;
    for (let i = 0; i < n; i++) { const was = tab.text('#main .dayhead h1'); tab.$$('#main .dayhead > button')[1].click(); await waitFor(() => tab.text('#main .dayhead h1') !== was, { what: 'next day' }); }
    const date = addDays(today(), n);
    expect(tab.$$('#c-training .sess:not(.done)').length).toBeGreaterThan(0);
    tab.button(t('ev.add'), '#c-day').click();
    fillEvent(tab, { title: 'Flu', end: addDays(date, 2), tag: 'sick', offPlan: true });
    expect(events(tab)).toEqual([expect.objectContaining({ date, end: addDays(date, 2), tag: 'sick', offPlan: true })]);
    expect(tab.$$('#c-training .sess:not(.done)')).toHaveLength(0);
    expect(tab.text('#c-training')).toContain(t('ev.offPlanLine', { name: 'Flu' }));
    expect(tab.text('#main .evstrip')).toContain(t('ev.dayOf', { n: 1, of: 3 }));
    const sick = tab.$$('#c-day .tagchip').find(c => c.textContent === t('pk.sick'));
    expect(sick.className).toContain('on');
    expect(sick.disabled).toBe(true);
    expect(tab.MB.store.get('days/' + date)).toBeNull(); /* the tag comes from the event, not the day */
    expect(tab.errors).toEqual([]);
  });

  it('Progress rings big events on the month calendar and lists them; the Data tab has a column', async () => {
    const tab = await withExample();
    const t = tab.t, { today } = tab.MB.ui;
    tab.button(t('ev.add'), '#c-day').click();
    fillEvent(tab, { title: 'Stripe', big: true });
    await tab.go('#progress');
    tab.button(t('p.tab.month'), '#main').click();
    const cell = tab.$$('#main .mg').find(c => c.firstChild.textContent === String(+today().slice(8)));
    expect(cell.className).toContain('evbig');
    expect(cell.querySelector('.evm.big')).not.toBeNull();
    expect(tab.text('#c-events')).toContain('Stripe');
    tab.button(t('p.tab.data'), '#main').click();
    expect(tab.text('#main table')).toContain('Stripe');
    expect(tab.errors).toEqual([]);
  });

  it('moving a progression up dates it as an event; undo takes both back', async () => {
    const tab = await openTab(); open.push(tab);
    const t = tab.t, blue = t('pk.belts').split(',')[1].trim();
    tab.$$('.tiles .tile.pack')[1].click(); /* BJJ athlete */
    await waitFor(() => tab.$('#main .page.today'), { what: 'pack loaded' });
    await tab.go('#plan');
    tab.$('#main .prog').click();
    tab.$$('.sheet .list .row.pick')[1].click();
    expect(settings(tab).gates.find(g => g.id === 'belt').current).toBe(2);
    expect(events(tab)).toEqual([expect.objectContaining({ title: `${t('pk.belt')}: ${blue}`, big: true, date: tab.MB.ui.today() })]);
    tab.$('.toast button').click();
    expect(settings(tab).gates.find(g => g.id === 'belt').current).toBe(1);
    expect(events(tab)).toEqual([]);
    expect(tab.errors).toEqual([]);
  });

  it('an old rank becomes a progression and its promotions become events, from a file or from stored data', async () => {
    const rank = { enabled: true, system: 'BJJ belt', levels: ['White', 'Blue', 'Purple', 'Brown', 'Black'], level: 'White', sublevelName: 'stripe', sublevel: 2, maxSublevel: 4,
      history: [{ date: '2025-12-13', level: 'White', sublevel: 1 }, { date: '2026-05-16', level: 'White', sublevel: 2 }], phases: [{ name: 'Phase I', minSublevel: 0 }] };
    const probe = await openTab(); open.push(probe);
    const SC = probe.MB.schema;
    const r = SC.planImport({ app: 'mettle', version: 4, settings: { name: 'Alex', rank } }, { mode: 'merge', current: { settings: SC.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [], events: [] } });
    expect(r.ok).toBe(true);
    expect(r.plan.settings.rank).toBeUndefined();
    expect(r.plan.settings.gates).toEqual([expect.objectContaining({ id: 'bjj-belt', name: 'BJJ belt', current: 3 })]);
    expect(r.plan.settings.gates[0].stages.slice(0, 3)).toEqual(['White', 'White · stripe 1', 'White · stripe 2']);
    expect(r.plan.events.upsert.map(e => [e.id, e.title, e.big])).toEqual([['rank-2025-12-13', 'BJJ belt: White · stripe 1', true], ['rank-2026-05-16', 'BJJ belt: White · stripe 2', true]]);
    expect(r.summary.map(m => m.code)).toContain('rankMoved');

    const device = newDevice();
    await seedDB(device.idb, 'tally', { 'm/profiles': { list: [{ id: 'default', name: 'Alex', createdAt: '2026-01-01T00:00:00.000Z' }] }, 'm/current': { id: 'default' },
      'p/default/settings/main': { name: 'Alex', mealSlots: [{ id: 'b', name: 'Breakfast' }], rank, updatedAt: '2026-01-01T08:00:00.000Z' } });
    const tab = await openTab({ device, hash: '#plan' }); open.push(tab);
    expect(settings(tab).rank).toBeUndefined();
    expect(settings(tab).gates.map(g => g.id)).toEqual(['bjj-belt']);
    expect(events(tab).map(e => e.id).sort()).toEqual(['rank-2025-12-13', 'rank-2026-05-16']);
    expect(tab.text('#c-cycle')).toContain('White · stripe 2');
    expect(tab.errors).toEqual([]);
  });

  it('events export with the days and import back', async () => {
    const tab = await withExample();
    const t = tab.t, SC = tab.MB.schema;
    tab.button(t('ev.add'), '#c-day').click();
    fillEvent(tab, { title: 'Physio' });
    const cur = { settings: settings(tab), foods: [], templates: [], days: [], events: tab.MB.store.list('events').map(SC.normalizeEvent), history: [] };
    const out = SC.exportProfile(cur, {});
    expect(out.events.map(e => e.title)).toEqual(['Physio']);
    expect(SC.exportProfile(cur, { kind: 'setup' }).events).toBeUndefined();
    const back = SC.planImport(JSON.parse(JSON.stringify(out)), { mode: 'merge', current: { ...cur, hasSettings: true, events: [] } });
    expect(back.plan.events.upsert.map(e => e.title)).toEqual(['Physio']);
    const rm = SC.planImport({ events: [out.events[0].id] }, { mode: 'remove', current: cur });
    expect(rm.plan.events.remove).toEqual([out.events[0].id]);
    expect(tab.errors).toEqual([]);
  });
});
