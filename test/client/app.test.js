// Client smoke tests: the app boots as Tally, migrates data kept under earlier names, renders every page cleanly.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import { openTab, newDevice, seedDB, readDB, dbNames, waitFor, loadExample, PUBLIC, SCRIPTS } from './harness.js';

const ROUTES = ['today', 'plan', 'progress', 'workouts', 'routines', 'exercises', 'foods', 'settings', 'start'];
const LANGS = ['en', 'es', 'fr', 'pt', 'de', 'ja', 'ko', 'zh'];
const settings = (extra = {}) => ({ name: 'Sam', units: { weight: 'kg' }, targets: { kcal: 2500, protein: 160 }, habits: [{ id: 'water', name: 'Water', target: 8 }], mealSlots: [{ id: 'breakfast', name: 'Breakfast' }], updatedAt: '2026-09-01T08:00:00.000Z', ...extra });
const day = { date: '2026-09-01', habits: { water: 5 }, meals: [{ id: 'm1', slot: 'breakfast', name: 'Oats', kcal: 400, p: 30, c: 50, f: 8 }], weight: 80.2, updatedAt: '2026-09-01T09:00:00.000Z' };

describe('boot', () => {
  it('a fresh device opens Get started, branded Tally, with no console errors', async () => {
    const tab = await openTab();
    expect(tab.document.title).toBe('Tally');
    expect(tab.text('.brand-name')).toBe('Tally');
    expect(tab.MB.APP).toEqual({ id: 'tally', name: 'Tally', version: '2.3.0' });
    expect(tab.window.location.hash).toBe('#start');
    expect(await dbNames(tab.device.idb)).toEqual(['tally']);
    expect(tab.errors).toEqual([]);
    tab.close();
  });
});

describe('migration from earlier names', () => {
  it('copies a Mettle (2.x) IndexedDB, then removes it; theme and language come along', async () => {
    const device = newDevice();
    const rows = { 'm/profiles': { list: [{ id: 'default', name: 'Sam', createdAt: '2026-01-01T00:00:00.000Z' }] }, 'm/current': { id: 'default' }, 'p/default/settings/main': settings(), 'p/default/days/2026-09-01': day, 'p/default/foods/oats': { name: 'Oats', kcal: 150 } };
    await seedDB(device.idb, 'mettle', rows);
    const tab = await openTab({ device, hash: '#settings', localStorage: { 'mettle:theme': 'dark', 'mettle:lang': 'de' } });
    expect(await readDB(device.idb, 'tally')).toEqual(rows);
    await waitFor(async () => !(await dbNames(device.idb)).includes('mettle'), { what: 'mettle deleted' });
    expect(tab.window.localStorage.getItem('tally:theme')).toBe('dark');
    expect(tab.window.localStorage.getItem('tally:lang')).toBe('de');
    expect(tab.document.documentElement.lang).toBe('de');
    expect(tab.document.documentElement.dataset.theme).toBe('dark');
    expect(tab.MB.store.get('days/2026-09-01').weight).toBe(80.2);
    expect(tab.$('.profile-btn').textContent).toBe('Sam');
    expect(tab.errors).toEqual([]);
    tab.close();
  });

  it('copies Matbook (1.x) data with un-namespaced paths into the default profile', async () => {
    const device = newDevice();
    await seedDB(device.idb, 'matbook', { 'settings/main': settings(), 'days/2026-09-01': day });
    const tab = await openTab({ device, hash: '#today' });
    const db = await readDB(device.idb, 'tally');
    expect(db['p/default/settings/main'].name).toBe('Sam');
    expect(db['p/default/days/2026-09-01']).toEqual(day);
    expect(db['settings/main']).toBeUndefined();
    await waitFor(async () => !(await dbNames(device.idb)).includes('matbook'), { what: 'matbook deleted' });
    expect(tab.errors).toEqual([]);
    tab.close();
  });

  it('prefers Mettle over Matbook, and copies Mettle data kept in localStorage', async () => {
    const device = newDevice();
    await seedDB(device.idb, 'matbook', { 'settings/main': settings({ name: 'Old' }) });
    const tab = await openTab({ device, localStorage: { 'mettle:p/default/settings/main': JSON.stringify(settings({ name: 'New' })), 'mettle:m/profiles': JSON.stringify({ list: [{ id: 'default', name: '' }] }) } });
    expect((await readDB(device.idb, 'tally'))['p/default/settings/main'].name).toBe('New');
    expect(tab.window.localStorage.getItem('mettle:p/default/settings/main')).toBeNull();
    tab.close();
  });

  it('never migrates into a store that already has data', async () => {
    const device = newDevice();
    await seedDB(device.idb, 'tally', { 'm/profiles': { list: [{ id: 'default', name: 'Kept' }] }, 'p/default/settings/main': settings({ name: 'Kept' }) });
    await seedDB(device.idb, 'mettle', { 'p/default/settings/main': settings({ name: 'Stale' }) });
    const tab = await openTab({ device, localStorage: { 'tally:lang': 'fr', 'mettle:lang': 'de' } });
    expect(tab.MB.store.get('settings/main').name).toBe('Kept');
    expect(tab.document.documentElement.lang).toBe('fr');
    tab.close();
  });
});

describe('pages', () => {
  it('every page renders in every language without console errors', async () => {
    const tab = await openTab();
    await loadExample(tab);
    for (const lang of LANGS) {
      const sel = tab.$('select.lang'); sel.value = lang; sel.dispatchEvent(new tab.window.Event('change'));
      for (const r of ROUTES) {
        await tab.go('#' + r);
        expect(tab.$('#main .page'), `${lang} #${r}`).not.toBeNull();
        expect(tab.text('#main')).not.toContain('Something went wrong');
      }
    }
    expect(tab.errors).toEqual([]);
    tab.close();
  }, 30000); /* 8 languages x 9 pages */

  it('imports files written by earlier names and exports as tally', async () => {
    const tab = await openTab();
    const { schema } = tab.MB;
    const cur = { settings: schema.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [] };
    for (const app of ['mettle', 'matbook', 'tally']) expect(schema.planImport({ app, version: 4, foods: [{ name: 'Rice', kcal: 200 }] }, { mode: 'merge', current: cur }).ok, app).toBe(true);
    expect(schema.exportProfile({ ...cur, profileName: '' }).app).toBe('tally');
    tab.close();
  });

  const alex = join(PUBLIC, '..', 'private', 'tally-alex.json');
  it.skipIf(!existsSync(alex))('the private profile imports cleanly with Replace', async () => {
    const tab = await openTab();
    const { schema } = tab.MB;
    const data = JSON.parse(readFileSync(alex, 'utf8'));
    expect(data.app).toBe('tally');
    const r = schema.planImport(data, { mode: 'replace', current: { settings: schema.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [] } });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    tab.close();
  });
});

describe('service worker', () => {
  const src = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
  const load = () => {
    const handlers = {};
    const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => {}, clients: { claim: () => {} } };
    const ctx = { self, location: new URL('http://localhost:8787/sw.js'), caches: { match: async () => undefined, open: async () => ({ put: async () => {} }) }, fetch: async () => new Response('x'), Response, URL };
    vm.runInNewContext(src, ctx);
    return { handlers, ctx };
  };
  const event = (path, method = 'GET') => { const e = { request: { url: 'http://localhost:8787' + path, method, mode: 'cors' }, handled: false }; e.respondWith = () => { e.handled = true; }; return e; };

  it('never handles /api/ requests', () => {
    const { handlers } = load();
    for (const [path, method] of [['/api/export', 'GET'], ['/api/sync', 'POST'], ['/api/vault', 'DELETE']]) { const e = event(path, method); handlers.fetch(e); expect(e.handled, path).toBe(false); }
    const page = event('/index.html'); handlers.fetch(page); expect(page.handled).toBe(true);
  });

  it('precaches exactly the files in public/', () => {
    const { ctx } = load();
    const assets = vm.runInNewContext('ASSETS', ctx).filter(a => a !== './').map(a => a.slice(2)).sort();
    const walk = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(PUBLIC, join(d, f)).replace(/\\/g, '/')]);
    expect(assets).toEqual(walk(PUBLIC).filter(f => f !== 'sw.js').sort());
    for (const s of SCRIPTS) expect(assets).toContain(s);
    expect(vm.runInNewContext('VERSION', ctx)).toMatch(/^tally-/);
  });
});
