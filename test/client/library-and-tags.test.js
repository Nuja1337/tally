// 2.6: the built-in exercise library (pages, your own versions, adding to a plan, looking one up mid-workout) and day tags
// (a new tag from Today, what differs on tagged days and the day after, the Data filter).
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
const day = (date, d) => ({ date, values: {}, checks: {}, meals: [], sessions: [], tags: [], note: '', weight: null, ...d });
/* exercise pages have their own route (#exercise/<id>), under Library */
async function page(tab, id) {
  tab.window.location.hash = '#exercise/' + id;
  await waitFor(() => tab.$('#main .page.expage') && tab.$('.nav a.active[data-route="library"]') && tab.MB.exercises && tab.text('#main .expage h1'), { what: 'exercise page ' + id });
}
const top = tab => tab.$$('.overlay:not(.hidden)').at(-1);

describe('the exercise library', () => {
  it('has about 400 exercises, each a page with its muscles, steps, cues, mistakes and variations', async () => {
    const tab = await withExample();
    const t = tab.t, lib = tab.MB.exlib;
    expect(lib.length).toBeGreaterThanOrEqual(390);
    await page(tab, 'goblet-squat');
    const e = tab.MB.exercises.get('goblet-squat');
    expect(tab.text('#main h1')).toBe('Goblet squat');
    expect(tab.$$('#main .mm .m.p').length).toBeGreaterThan(0); /* the map marks the quads and glutes */
    expect(tab.$$('#main .mm .m.p').map(x => x.dataset.m)).toEqual(expect.arrayContaining(e.pm));
    expect(tab.$$('#main ol.xlist li')).toHaveLength(e.steps.length);
    expect(tab.$$('#main .xsec h3').map(x => x.textContent)).toEqual(expect.arrayContaining([t('x.howTo'), t('x.cues'), t('x.mistakes')]));
    expect(tab.text('#main .xdose')).toContain(e.dose.reps);
    tab.$$('#main .xvars .row').find(r => r.textContent.includes('Bodyweight squat')).click();
    await waitFor(() => tab.text('#main .expage h1') === 'Bodyweight squat', { what: 'the easier one' });
    expect(tab.window.location.hash.startsWith('#exercise/')).toBe(true); /* the profile's own squat when it stands on this entry */
    expect(tab.$('#main .backlink').getAttribute('href')).toBe('#today');
    expect(tab.errors).toEqual([]);
  });

  it('a profile exercise stands on its library entry (by id or name) and is listed once, under Yours', async () => {
    const tab = await withExample('#exercises');
    const own = settings(tab).exercises.find(e => e.id === 'push-up');
    expect(tab.MB.exercises.libFor(own).id).toBe('push-up');
    expect(tab.MB.exercises.libFor({ id: 'x1', name: 'goblet cossack squat' }).id).toBe('cossack-squat'); /* an alias */
    const names = sel => tab.$$(sel).map(r => r.querySelector('b').textContent);
    const [yours, library] = tab.$$('#main .excat');
    expect(names('#main .excat:first-child .exrow')).toContain(own.name);
    expect(library.querySelectorAll('.exrow').length).toBeGreaterThan(300);
    expect([...library.querySelectorAll('.exrow')].some(r => r.getAttribute('href') === '#exercise/push-up')).toBe(false);
    expect(yours).toBeTruthy();
    /* narrowing: a category, then a muscle */
    tab.$$('#main .xcats .chip').find(c => c.textContent === tab.t('x.cat.prehab')).click();
    const cats = tab.$$('#main .exrow').map(r => r.getAttribute('href').slice(10)).map(id => (tab.MB.exercises.get(id) || {}).cat).filter(Boolean);
    expect(new Set(cats)).toEqual(new Set(['prehab']));
    const mu = tab.$('#main .xfilters select'); mu.value = 'neck'; mu.dispatchEvent(new tab.window.Event('change'));
    expect(tab.$$('#main .exrow').length).toBeGreaterThan(0);
    for (const r of tab.$$('#main .exrow')) { const e = tab.MB.exercises.get(r.getAttribute('href').slice(10)); expect([...e.pm, ...e.sm]).toContain('neck'); }
    expect(tab.errors).toEqual([]);
  });

  it('Edit on a library exercise makes your version on top of it; removing it brings the library back', async () => {
    const tab = await withExample();
    await page(tab, 'kb-swing');
    tab.button(tab.t('c.edit'), '#main').click();
    typeIn(tab, top(tab).querySelector('textarea'), 'Heavy bell on Fridays');
    tab.button(tab.t('c.save'), '.sheet').click();
    expect(settings(tab).exercises.find(e => e.id === 'kb-swing')).toMatchObject({ name: 'Kettlebell swing', cues: 'Heavy bell on Fridays', base: '' });
    await waitFor(() => tab.text('#main .xnotes') === 'Heavy bell on Fridays', { what: 'notes on the page' });
    expect(tab.$$('#main ol.xlist li').length).toBe(tab.MB.exercises.get('kb-swing').steps.length); /* the how-to stays */
    tab.button(tab.t('c.edit'), '#main').click();
    tab.button(tab.t('x.removeYours'), '.sheet').click();
    expect(settings(tab).exercises.some(e => e.id === 'kb-swing')).toBe(false);
    expect(tab.errors).toEqual([]);
  });

  it('your own exercise: muscles and steps of its own, or based on a library entry', async () => {
    const tab = await withExample('#exercises');
    const t = tab.t;
    tab.button(t('l.addExercise'), '#main').click();
    typeIn(tab, top(tab).querySelector('input[type=text]'), 'Wall neck bridge');
    const chip = name => [...top(tab).querySelectorAll('.mpick .chip')].find(c => c.textContent === name);
    chip(t('mu.neck')).click(); /* primary */
    chip(t('mu.traps')).click(); chip(t('mu.traps')).click(); /* secondary */
    typeIn(tab, top(tab).querySelector('.mpick').closest('.field').parentNode.querySelector('textarea'), 'Face the wall\nLean in and hold');
    tab.button(t('c.save'), '.sheet').click();
    const mine = settings(tab).exercises.find(e => e.name === 'Wall neck bridge');
    expect(mine).toMatchObject({ pm: ['neck'], sm: ['traps'], steps: ['Face the wall', 'Lean in and hold'], base: '' });
    await page(tab, mine.id);
    expect([...new Set(tab.$$('#main .mm .m.p').map(x => x.dataset.m))]).toEqual(['neck']); /* on the front and the back */
    expect(tab.$$('#main ol.xlist li').map(li => li.textContent)).toEqual(['Face the wall', 'Lean in and hold']);

    await tab.go('#exercises');
    tab.button(t('l.addExercise'), '#main').click();
    const [name, based] = top(tab).querySelectorAll('input[type=text]');
    typeIn(tab, name, 'Banded ER, slow'); typeIn(tab, based, 'Band external rotation');
    expect(top(tab).querySelector('.mpick')).toBeNull(); /* the library fills in the muscles */
    tab.button(t('c.save'), '.sheet').click();
    const er = settings(tab).exercises.find(e => e.name === 'Banded ER, slow');
    expect(er.base).toBe('band-external-rotation');
    await page(tab, er.id);
    expect(tab.$$('#main ol.xlist li').length).toBe(tab.MB.exercises.get('band-external-rotation').steps.length);
    expect(tab.errors).toEqual([]);
  });

  it('Add to… puts an exercise in a workout with its starting dose', async () => {
    const tab = await withExample();
    await page(tab, 'kb-swing');
    const w = settings(tab).sessionTypes[0];
    tab.button(tab.t('x.addTo'), '#main').click();
    [...top(tab).querySelectorAll('.row')].find(r => r.textContent.includes(w.name)).click();
    const items = settings(tab).sessionTypes[0].plan.at(-1).items, dose = tab.MB.exercises.get('kb-swing').dose;
    expect(items.at(-1)).toMatchObject({ exerciseId: 'kb-swing', name: 'Kettlebell swing', sets: dose.sets, reps: dose.reps });
    expect(tab.text('#main .xbody')).toContain(tab.t('x.usedIn', { list: w.name }));
    expect(tab.errors).toEqual([]);
  });

  it('looking an exercise up in the middle of logging keeps the workout and what was typed', async () => {
    const tab = await withExample();
    const t = tab.t, type = settings(tab).sessionTypes.find(x => x.plan.length);
    tab.button(t('t.addSession'), '#main').click();
    const sel = tab.$('.sheet select'); sel.value = type.id; sel.dispatchEvent(new tab.window.Event('change'));
    tab.button(t('c.next'), '.sheet').click();
    const wt = tab.$('.sheet .setrow input'); typeIn(tab, wt, '40');
    tab.$('.sheet .exhead .linkish').click();
    expect(tab.$$('.overlay')).toHaveLength(2);
    expect(top(tab).querySelector('.xbody')).not.toBeNull();
    top(tab).querySelector('.sheet-head button').click();
    expect(tab.$$('.overlay')).toHaveLength(1);
    expect(tab.$('.sheet .setrow input').value).toBe('40');
    /* adding an exercise goes through the picker, then back to the log */
    tab.button(t('t.addExercise'), '.sheet').click();
    typeIn(tab, top(tab).querySelector('input[type=search]'), 'dead bug');
    top(tab).querySelector('.xpick .row').click();
    expect(tab.$$('.overlay')).toHaveLength(1);
    expect(tab.$$('.sheet .exhead').map(x => x.textContent).join(' ')).toContain('Dead bug');
    expect(tab.errors).toEqual([]);
  });
});

describe('day tags', () => {
  it('a new tag from Today goes on the day, and an existing name is reused', async () => {
    const tab = await withExample();
    const d = () => tab.MB.store.get('days/' + tab.MB.ui.today());
    tab.$('#c-day .ghostchip').click();
    const inp = tab.$('#c-day input.tagnew'); inp.value = 'Sparring';
    inp.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const tag = settings(tab).tags.find(x => x.name === 'Sparring');
    expect(tag).toBeTruthy();
    expect(d().tags).toEqual([tag.id]);
    expect(tab.$$('#c-day .tagchip.on').map(c => c.textContent)).toEqual(['Sparring']);
    tab.$('#c-day .ghostchip').click();
    const again = tab.$('#c-day input.tagnew'); again.value = 'sparring';
    again.dispatchEvent(new tab.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(settings(tab).tags.filter(x => x.name.toLowerCase() === 'sparring')).toHaveLength(1);
    expect(tab.errors).toEqual([]);
  });

  it('a tag shows what differs on its days and the day after, against the other days', async () => {
    const first = await withExample();
    const { addDays, today } = first.MB.ui, t = first.t, check = settings(first).trackers.find(x => x.type === 'check');
    const docs = {};
    for (let i = 1; i <= 16; i++) {
      const date = addDays(today(), -i), sick = i % 4 === 0; /* 4 sick days, sleeping 2 h less; the day after, a lot more */
      docs['days/' + date] = day(date, { tags: sick ? ['sick'] : [], values: { sleep: sick ? 360 : (i % 4 === 3 ? 600 : 480), ...(sick || i % 3 === 0 ? {} : { [check.id]: true }) } });
    }
    const tab = await reseed(first, docs);
    [...tab.$$('#c-day button')].find(b => b.textContent.includes(t('tg.details'))).click();
    const row = [...top(tab).querySelectorAll('.tagrow')].find(r => r.textContent.includes(settings(tab).tags.find(x => x.id === 'sick').name));
    expect(row.textContent).toContain(t('tg.onDayShort'));
    row.click();
    const sleepName = settings(tab).trackers.find(x => x.id === 'sleep').name;
    const blocks = [...top(tab).querySelectorAll('.fx')];
    const same = [...blocks[0].querySelectorAll('.fx-row')].find(r => r.textContent.includes(sleepName));
    /* every row: what it was on those days, "usually" (the other days) under it, and an arrow */
    expect(same.querySelector('.fx-v b').textContent).toBe('6 h');
    expect(same.querySelector('small').textContent).toBe(t('tg.usually', { v: '8 h 40 min' })); /* 520 min on the other days */
    expect(same.querySelector('.fx-arrow').textContent).toBe('▼');
    expect(same.querySelector('.fx-arrow').classList.contains('st-low')).toBe(true); /* less sleep is worse when the aim is at least */
    expect(top(tab).querySelector('.fx-head').textContent).toContain(t('p.nDays', { n: 4 }));
    const next = [...blocks[1].querySelectorAll('.fx-row')].find(r => r.textContent.includes(sleepName));
    expect(next.querySelector('.fx-arrow').classList.contains('st-good')).toBe(true);
    /* a yes-or-no tracker: how many of those days it got done, and how often on the others */
    const ck = [...blocks[0].querySelectorAll('.fx-row')].find(r => r.textContent.includes(check.name));
    expect(ck.querySelector('.fx-v b').textContent).toBe(t('tg.ofDays', { x: 0, n: 4 }));
    expect(ck.querySelector('small').textContent).toBe(t('tg.usuallyDays', { v: '67%' })); /* 8 of the 12 other days */
    expect(tab.errors).toEqual([]);
  });

  it('Data shows only the days with a tag when one is picked', async () => {
    const first = await withExample();
    const { addDays, today } = first.MB.ui, t = first.t, a = addDays(today(), -1), b = addDays(today(), -2);
    if (a.slice(0, 7) !== today().slice(0, 7) || b.slice(0, 7) !== today().slice(0, 7)) return; /* both must be in this month */
    const tab = await reseed(first, { ['days/' + a]: day(a, { tags: ['travel'], weight: 180 }), ['days/' + b]: day(b, { weight: 181 }) }, '#progress');
    tab.button(t('p.tab.data'), '#main').click();
    const sel = tab.$('#main select.tagfilter'); sel.value = 'travel'; sel.dispatchEvent(new tab.window.Event('change'));
    await waitFor(() => tab.$$('#main .datatable tbody tr').length === 1, { what: 'one travel day' });
    expect(tab.text('#main .datatable tbody tr td')).toContain(String(+a.slice(8)));
    expect(tab.errors).toEqual([]);
  });
});
