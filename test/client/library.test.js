// Library holds workouts, routines, exercises and foods.
import { describe, it, expect, afterEach } from 'vitest';
import { openTab, waitFor, loadExample } from './harness.js';

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });
async function withExample(hash) {
  const tab = await openTab(); open.push(tab);
  await loadExample(tab);
  if (hash) await tab.go(hash);
  return tab;
}
const settings = tab => tab.MB.store.get('settings/main');
const headings = tab => tab.$$('#main .card-head h2').map(h => h.textContent);
const typeIn = (tab, input, value) => { input.value = value; input.dispatchEvent(new tab.window.Event('input')); };
const field = (tab, label, root = '.sheet') => { const f = tab.$$(`${root} .field`).find(x => x.querySelector('span') && x.querySelector('span').textContent === label); return f && f.querySelector('input, select'); };
/* a list row by its name: plain rows, or rows you can drag (their name is a button next to the handle) */
const rowNamed = (tab, name) => [...tab.$$('#main button.row.pick'), ...tab.$$('#main .sortrow button.row-name')].find(b => { const d = b.querySelector('div'); return d && d.textContent === name; });
const undo = tab => tab.$('.toast button').click();

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
    expect(tab.$$('#main .card:first-of-type .sortrow').length).toBe(settings(tab).sessionTypes.length);
    rowNamed(tab, 'Upper body').click();
    typeIn(tab, field(tab, t('c.name')), 'Upper A');
    tab.button(t('pl.addGroup'), '.sheet').click();
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

    /* deleting happens at once; Undo brings it back */
    rowNamed(tab, 'Swim').click();
    tab.button(t('c.delete'), '.sheet').click();
    expect(tab.$('.sheet')).toBeNull();
    expect(settings(tab).sessionTypes.some(x => x.name === 'Swim')).toBe(false);
    expect(tab.text('.toast')).toContain(t('t.removed', { name: 'Swim' }));
    undo(tab);
    expect(settings(tab).sessionTypes.map(x => x.name)).toContain('Swim');
    expect(rowNamed(tab, 'Swim')).toBeTruthy();
    expect(tab.errors).toEqual([]);
  });

  it('workouts and routines drag into order; the order is saved', async () => {
    const tab = await withExample('#workouts');
    const names = () => settings(tab).sessionTypes.map(x => x.name), before = names();
    const handle = tab.$$('#main .sortrow .drag')[0];
    handle.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(names()).toEqual([before[1], before[0], ...before.slice(2)]);
    expect(tab.$$('#main .sortrow .row-name div:first-child').map(d => d.textContent).slice(0, 2)).toEqual([before[1], before[0]]);
    expect(tab.errors).toEqual([]);
  });

  it('workouts: categories with colors, the training cycle and progressions edit in their own sheets', async () => {
    const tab = await withExample('#workouts');
    const t = tab.t;
    const editIn = title => tab.$$('#main .card').find(c => c.querySelector('h2') && c.querySelector('h2').textContent === title).querySelector('.card-head button');
    editIn(t('s.kinds')).click();
    tab.button(t('s.addKind'), '.sheet').click();
    typeIn(tab, tab.$$('.sheet .kind-row input').at(-1), 'Climbing');
    tab.$$('.sheet .kind-row').at(-1).querySelector('.sw[aria-label="' + t('col.pink') + '"]').click();
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).sessionKinds.find(k => k.name === 'Climbing')).toMatchObject({ color: 'pink' });

    editIn(t('pl.wave')).click();
    const start = tab.$('.sheet input[type=date]');
    start.value = '2026-09-21'; start.dispatchEvent(new tab.window.Event('change'));
    const add = () => tab.button('+ ' + t('pl.addWeek'), '.sheet').click();
    add(); add(); add();
    tab.$$('.sheet .chip.wk')[1].click(); /* build -> peak */
    tab.$$('.sheet .chip.wk')[2].click(); tab.$$('.sheet .chip.wk')[2].click(); /* build -> peak -> deload */
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).wave).toEqual({ start: '2026-09-21', pattern: ['ramp', 'full', 'deload'] });

    editIn(t('s.gates')).click();
    tab.button(t('s.addGate'), '.sheet').click();
    const [name, stages] = tab.$$('.sheet .editor-row input');
    typeIn(tab, name, 'Wrist'); typeIn(tab, stages, 'Phase 1, Phase 2');
    tab.button(t('c.save'), '.sheet').click();
    expect(settings(tab).gates).toMatchObject([{ name: 'Wrist', stages: ['Phase 1', 'Phase 2'], current: 1 }]);
    expect(tab.text('#main')).toContain('Wrist · Phase 1');
    await tab.go('#plan');
    tab.$$('#main .prog').find(b => b.textContent.includes('Wrist')).click();
    tab.$$('.sheet button.row.pick')[1].click(); /* on to phase 2 */
    expect(settings(tab).gates[0].current).toBe(2);
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
    undo(tab);
    expect(tab.MB.store.get('templates/' + first.id)).toMatchObject({ name: first.name, kcal: 999 });
    expect(tab.errors).toEqual([]);
  });
});
