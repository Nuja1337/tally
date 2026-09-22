// Library holds workouts, routines, exercises and foods; Settings keeps only profile-level setup.
import { describe, it, expect, afterEach } from 'vitest';
import { openTab, waitFor } from './harness.js';

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });
async function withExample(hash) {
  const tab = await openTab(); open.push(tab);
  tab.$('.tiles .tile').click();
  await waitFor(() => tab.MB.store.list('foods').length > 50 && tab.window.location.hash === '#today', { what: 'example loaded' });
  if (hash) await tab.go(hash);
  return tab;
}
const settings = tab => tab.MB.store.get('settings/main');
const headings = tab => tab.$$('#main .card-head h2').map(h => h.textContent);
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const field = (tab, label, root = '.sheet') => { const f = tab.$$(`${root} .field`).find(x => x.querySelector('span') && x.querySelector('span').textContent === label); return f && f.querySelector('input, select'); };
const rowNamed = (tab, name) => tab.$$('#main button.row.pick').find(b => b.querySelector('.row-name div').textContent === name);

describe('Settings', () => {
  it('keeps profile-level setup only; workouts and routines moved to Library', async () => {
    const tab = await withExample('#settings');
    const t = tab.t, h = headings(tab);
    for (const k of ['s.profile', 's.targets', 's.goal', 's.slots', 's.habits', 's.rank', 's.app', 'sy.title', 's.data']) expect(h, k).toContain(t(k));
    for (const k of ['s.routines', 's.kinds', 's.types', 's.gates', 's.wave']) expect(h, k).not.toContain(t(k));
    expect(tab.text('#main .dayhead .sub')).toBe(t('s.inLibrary'));
    expect(tab.errors).toEqual([]);
  });

  it('saving Settings never overwrites a workout edited in Library meanwhile', async () => {
    const tab = await withExample('#settings');
    typeIn(tab, tab.$('#main .card input[type=text]'), 'Sam'); /* unsaved draft */
    expect(tab.$('.savebar').classList.contains('show')).toBe(true);
    await tab.go('#workouts');
    rowNamed(tab, 'Upper body').click();
    typeIn(tab, field(tab, tab.t('t.minutes')), '50');
    tab.button(tab.t('c.save'), '.sheet').click();
    expect(settings(tab).sessionTypes.find(x => x.id === 'upper').minutes).toBe(50);
    await tab.go('#settings');
    tab.$('.savebar .btn.primary').click();
    expect(settings(tab).name).toBe('Sam');
    expect(settings(tab).sessionTypes.find(x => x.id === 'upper').minutes).toBe(50);
  });
});

describe('Library', () => {
  it('has Workouts, Routines, Exercises and Foods tabs, reachable by link', async () => {
    const tab = await withExample('#library');
    const t = tab.t;
    expect(tab.$$('#main .seg-btn').map(b => b.textContent)).toEqual([t('pl.workouts'), t('s.routines'), t('l.exercises'), t('nav.foods')]);
    expect(tab.$('#main .seg-btn.on').textContent).toBe(t('pl.workouts'));
    for (const [hash, label] of [['#routines', 's.routines'], ['#exercises', 'l.exercises'], ['#foods', 'nav.foods'], ['#workouts', 'pl.workouts']]) {
      await tab.go(hash);
      expect(tab.$('#main .seg-btn.on').textContent, hash).toBe(t(label));
    }
    expect(tab.errors).toEqual([]);
  });

  it('workouts: list, edit details and plan in one sheet, add, delete', async () => {
    const tab = await withExample('#workouts');
    const t = tab.t;
    expect(tab.$$('#main .card:first-of-type button.row.pick').length).toBe(settings(tab).sessionTypes.length);
    rowNamed(tab, 'Upper body').click();
    typeIn(tab, field(tab, t('c.name')), 'Upper A');
    tab.button(t('pl.addBlock'), '.sheet').click();
    tab.$$('.sheet .routine').at(-1).querySelector('button.btn.ghost.small').click(); /* add an exercise to the new block */
    const sel = tab.$$('.sheet .routine').at(-1).querySelector('.editor-row.wrap select');
    sel.value = 'plank'; sel.dispatchEvent(new tab.window.Event('change'));
    tab.button(t('c.save'), '.sheet').click();
    await waitFor(() => !tab.$('.sheet'), { what: 'sheet closed' });
    const upper = settings(tab).sessionTypes.find(x => x.id === 'upper');
    expect(upper.name).toBe('Upper A');
    expect(upper.plan.length).toBe(3);
    expect(upper.plan[2].items[0]).toMatchObject({ exerciseId: 'plank', name: 'Plank' });
    expect(rowNamed(tab, 'Upper A')).toBeTruthy();

    tab.button(t('l.addWorkout'), '#main').click();
    typeIn(tab, field(tab, t('c.name')), 'Swim');
    typeIn(tab, field(tab, t('t.minutes')), '40');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).sessionTypes.find(x => x.name === 'Swim')).toMatchObject({ id: 'swim', minutes: 40 });

    rowNamed(tab, 'Swim').click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(tab.text('.sheet')).toContain(t('l.deleteWorkout', { name: 'Swim' }));
    tab.button(t('c.delete'), '.sheet').click();
    expect(settings(tab).sessionTypes.some(x => x.name === 'Swim')).toBe(false);
    expect(tab.errors).toEqual([]);
  });

  it('workouts: kinds, training wave and gates edit in their own sheets', async () => {
    const tab = await withExample('#workouts');
    const t = tab.t;
    const editIn = title => tab.$$('#main .card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === title).querySelector('.card-head button');
    editIn(t('s.kinds')).click();
    tab.button(t('s.addKind'), '.sheet').click();
    typeIn(tab, tab.$$('.sheet .editor-row input').at(-1), 'Climbing');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).sessionKinds.map(k => k.name)).toContain('Climbing');

    editIn(t('pl.wave')).click();
    const [start, pattern] = tab.$$('.sheet input');
    start.value = '2026-09-21'; start.dispatchEvent(new tab.window.Event('change'));
    typeIn(tab, pattern, 'ramp, full, nonsense, deload');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).wave).toEqual({ start: '2026-09-21', pattern: ['ramp', 'full', 'deload'] });

    editIn(t('s.gates')).click();
    tab.button(t('s.addGate'), '.sheet').click();
    const [name, stages] = tab.$$('.sheet .editor-row input');
    typeIn(tab, name, 'Wrist'); typeIn(tab, stages, 'Phase 1, Phase 2');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).gates).toMatchObject([{ name: 'Wrist', stages: ['Phase 1', 'Phase 2'], current: 1 }]);
    expect(tab.text('#main')).toContain('Wrist · Phase 1');
    expect(tab.errors).toEqual([]);
  });

  it('routines: edit days and checklist, add, delete', async () => {
    const tab = await withExample('#routines');
    const t = tab.t, before = settings(tab).routines[0];
    rowNamed(tab, before.name).click();
    tab.$$('.sheet .chip')[0].click(); /* Monday on */
    tab.button(t('s.addExercise'), '.sheet').click();
    const rows = tab.$$('.sheet .editor-row');
    typeIn(tab, rows.at(-1).querySelectorAll('input')[0], 'Neck rolls');
    typeIn(tab, rows.at(-1).querySelectorAll('input')[1], '5');
    tab.button(t('c.save'), '.sheet').click();
    const after = settings(tab).routines.find(r => r.id === before.id);
    expect(after.days).toEqual(['mon']);
    expect(after.items.at(-1)).toMatchObject({ name: 'Neck rolls', target: '5' });
    expect(after.items.length).toBe(before.items.length + 1);

    tab.button(t('s.addRoutine'), '#main').click();
    typeIn(tab, field(tab, t('s.routineName')), 'Evening');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).routines.map(r => r.name)).toContain('Evening');
    expect(rowNamed(tab, 'Evening').textContent).toContain(t('l.everyDay'));

    rowNamed(tab, 'Evening').click();
    tab.button(t('c.delete'), '.sheet').click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(settings(tab).routines.map(r => r.name)).not.toContain('Evening');
    expect(tab.errors).toEqual([]);
  });

  it('foods: meal templates are listed and editable', async () => {
    const tab = await withExample('#foods');
    const t = tab.t;
    expect(headings(tab)).toContain(t('t.templates'));
    const first = tab.MB.store.list('templates').sort((a, b) => a.name.localeCompare(b.name))[0];
    rowNamed(tab, first.name).click();
    typeIn(tab, field(tab, t('c.kcal')), '999');
    tab.button(t('c.save'), '.sheet').click();
    expect(tab.MB.store.get('templates/' + first.id).kcal).toBe(999);
    rowNamed(tab, first.name).click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(tab.MB.store.get('templates/' + first.id)).toBeNull();
    expect(tab.errors).toEqual([]);
  });
});
