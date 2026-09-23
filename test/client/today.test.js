// Edit in place (Today and Progress), a short Settings, and status colors: green met, amber close or not logged yet, red missed or over.
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
const day = (date, d) => ({ date, habits: {}, checks: {}, meals: [], sessions: [], measures: {}, note: '', ...d });
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

  it('habits and meal slots, from their cards', async () => {
    const tab = await withExample();
    editIn(tab, 'habits').click();
    tab.button(tab.t('s.addHabit'), '.sheet').click();
    typeIn(tab, tab.$$('.sheet .editor-row').at(-1).querySelector('input'), 'Floss');
    save(tab);
    expect(settings(tab).habits.map(x => x.name)).toContain('Floss');
    expect(tab.$$('#main .habit-name').map(x => x.textContent)).toContain('Floss');

    editIn(tab, 'meals').click();
    typeIn(tab, tab.$$('.sheet .editor-row input')[0], 'First meal');
    save(tab);
    expect(settings(tab).mealSlots[0].name).toBe('First meal');
    expect(tab.$('#c-meals .slot-head h3').textContent).toContain('First meal');
    expect(tab.errors).toEqual([]);
  });

  it('a blank profile offers to add habits and meal slots right on Today', async () => {
    const tab = await openTab({ hash: '#today' }); open.push(tab);
    tab.button(tab.t('t.addHabits'), '#main').click();
    tab.button(tab.t('s.addHabit'), '.sheet').click();
    typeIn(tab, tab.$('.sheet .editor-row input'), 'Walk');
    save(tab);
    expect(tab.$$('#main .habit-name').map(x => x.textContent)).toEqual(['Walk']);
    tab.button(tab.t('t.addSlots'), '#main').click();
    tab.button(tab.t('s.addSlot'), '.sheet').click();
    typeIn(tab, tab.$('.sheet .editor-row input'), 'Lunch');
    save(tab);
    expect(tab.$('#c-meals .slot-head h3').textContent).toContain('Lunch');
    expect(tab.errors).toEqual([]);
  });
});

describe('Progress: goal, milestones and rank edited on the page', () => {
  it('goal and milestones', async () => {
    const tab = await withExample('#progress');
    const t = tab.t;
    tab.button(t('p.setGoalBtn'), '#main').click();
    const [w, bf, lo, hi] = tab.$$('.sheet input[type=number]');
    typeIn(tab, w, '180'); typeIn(tab, bf, '12'); typeIn(tab, lo, '179'); typeIn(tab, hi, '182');
    save(tab);
    expect(settings(tab).goal).toMatchObject({ weight: 180, bodyFat: 12, band: [179, 182] });
    expect(tab.text('#main')).toContain(t('p.toward', { w: 180, u: 'lb' }));

    tab.button(t('p.editGoal'), '#main').click();
    tab.button(t('p.editMilestones'), '.sheet').click(); /* milestones belong to the goal */
    tab.button(t('s.addMilestone'), '.sheet').click();
    typeIn(tab, tab.$('.sheet .editor-row input'), 'Summer');
    save(tab);
    expect(settings(tab).goal.milestones.map(m => m.label)).toEqual(['Summer']);
    tab.button(t('p.tab.month'), '#main').click();
    expect(tab.text('#c-body')).toContain('Summer');

    /* everything here can be cleared again */
    tab.button(t('p.editMilestones'), '#c-body').click();
    tab.button(t('p.removeAll'), '.sheet').click();
    expect(settings(tab).goal.milestones).toEqual([]);
    expect(tab.$('#c-body')).toBeNull();
    tab.button(t('p.editGoal'), '#main').click();
    tab.button(t('p.clearGoal'), '.sheet').click();
    expect(settings(tab).goal).toMatchObject({ weight: null, bodyFat: null, band: null, note: '' });
    expect(tab.errors).toEqual([]);
  });

  it('rank: start tracking one, record a promotion, undo it', async () => {
    const tab = await withExample('#progress');
    const t = tab.t;
    tab.button(t('p.customize'), '#main').click();
    const rankBox = tab.$$('.sheet label.row').find(l => l.textContent === t('p.card.rank')).querySelector('input');
    rankBox.checked = true; rankBox.dispatchEvent(new tab.window.Event('change'));
    save(tab); /* no rank set up yet, so its sheet opens */
    const levels = tab.$$('.sheet .field').find(f => f.querySelector('span') && f.querySelector('span').textContent === t('s.levels')).querySelector('input');
    typeIn(tab, levels, 'White, Blue');
    save(tab);
    expect(settings(tab).rank).toMatchObject({ enabled: true, level: 'White', sublevel: 0 });
    tab.button(t('p.tab.year'), '#main').click();
    tab.button(t('s.promoted'), '#main').click();
    expect(settings(tab).rank.sublevel).toBe(1);
    expect(settings(tab).rank.history).toHaveLength(1);
    tab.$('.toast button').click();
    expect(settings(tab).rank.sublevel).toBe(0);
    expect(settings(tab).rank.history).toHaveLength(0);
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
    expect(notes()).toEqual(['ringnote st-miss', 'ringnote st-miss']);
    expect(tab.$('#main .ringnote').textContent).toBe(tab.t('t.short', { n: (s.targets.kcal - 300).toLocaleString() }));

    tab = await reseed(tab, { ['days/' + y]: day(y, { meals: [{ id: 'a', slot: 'breakfast', name: 'Feast', kcal: s.targets.kcal, p: s.targets.protein + 5, c: 0, f: 0 }] }) });
    await prevDay(tab);
    expect(notes()).toEqual(['ringnote st-met', 'ringnote st-met']);
    expect(tab.$('#main .ringnote').textContent).toBe('✓ ' + tab.t('t.onTarget'));
  });

  it('today counts down without red; a finished checklist and all habits turn their counts green', async () => {
    const tab = await withExample();
    expect(tab.$('#main .ringnote').className).toBe('ringnote st-progress');
    for (const tile of tab.$$('#main .habit')) { tile.click(); for (let i = 0; i < 10 && !tile.classList.contains('on'); i++) tile.click(); }
    expect(tab.$('#c-habits .count').className).toBe('count st-met');
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
    expect(row.dataset.status).toBe('over');
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
    expect([st(50, 100, 'min', false), st(100, 100, 'min', false), st(95, 100, 'min', true), st(50, 100, 'min', true)]).toEqual(['progress', 'met', 'close', 'miss']);
    expect([st(50, 100, 'near', false), st(92, 100, 'near', false), st(108, 100, 'near', true), st(115, 100, 'near', false), st(130, 100, 'near', false), st(85, 100, 'near', true), st(70, 100, 'near', true)])
      .toEqual(['progress', 'met', 'met', 'close', 'over', 'close', 'miss']);
    expect([st(50, 100, 'max', false), st(50, 100, 'max', true), st(105, 100, 'max', false), st(120, 100, 'max', true)]).toEqual(['progress', 'met', 'close', 'over']);
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
