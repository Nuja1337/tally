// The real Worker served locally: static app, and a cloud export that the app imports as-is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openTab, waitFor, PUBLIC, loadExample } from './harness.js';
import { startServer, INVITE } from './server.js';

let srv;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { if (srv) await srv.close(); });

/* every document of the active profile, as the store holds it */
function profileDocs(MB) {
  const out = [];
  const s = MB.store.get('settings/main'); if (s) out.push(['settings/main', s]);
  for (const coll of ['foods', 'templates', 'days']) for (const { id, ...doc } of MB.store.list(coll)) out.push([coll + '/' + id, doc]);
  return out;
}
async function pushAll(key, docs) {
  for (let i = 0; i < docs.length; i += 40) {
    const changes = docs.slice(i, i + 40).map(([path, doc]) => ({ path, doc, updatedAt: Date.parse(doc.updatedAt) || 0, deleted: false }));
    const r = await srv.api('POST', '/api/sync', { key, body: { cursor: 0, changes } });
    expect(r.status, r.text).toBe(200);
  }
}
async function roundTrip(tab) {
  const docs = profileDocs(tab.MB);
  const key = (await srv.api('POST', '/api/vault', { body: { invite: INVITE } })).json.key;
  await pushAll(key, docs);
  const exp = await srv.api('GET', '/api/export', { key });
  expect(exp.status).toBe(200);
  const fresh = await openTab({ origin: srv.base });
  const { schema } = fresh.MB;
  const current = { settings: schema.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [] };
  const plan = schema.planImport(exp.json, { mode: 'replace', current });
  expect(plan.errors).toEqual([]);
  expect(plan.warnings).toEqual([]);
  expect(plan.ok).toBe(true);
  /* apply it through the import panel, exactly as a person would */
  await fresh.go('#start');
  const panel = fresh.$('#importpanel');
  panel.setText(exp.text);
  [...panel.querySelectorAll('.seg-btn')].find(b => b.textContent === fresh.MB.i18n.t('i.replace')).click();
  [...panel.querySelectorAll('button')].find(b => b.textContent === fresh.MB.i18n.t('c.apply')).click();
  await waitFor(() => fresh.MB.store.list('foods').length === tab.MB.store.list('foods').length, { what: 'import applied' });
  const norm = MB => ({ settings: MB.schema.normalizeSettings(MB.store.get('settings/main')), foods: MB.store.list('foods').map(({ updatedAt, ...f }) => f).sort((a, b) => a.id < b.id ? -1 : 1),
    templates: MB.store.list('templates').map(({ updatedAt, ...t }) => t).sort((a, b) => a.id < b.id ? -1 : 1), days: MB.store.list('days').map(({ updatedAt, id, ...d }) => d) });
  const a = norm(tab.MB), b = norm(fresh.MB);
  delete a.settings.updatedAt; delete b.settings.updatedAt;
  expect(b).toEqual(a);
  expect(fresh.errors).toEqual([]);
  fresh.close();
  return docs.length;
}

describe('served locally by the Worker', () => {
  it('serves the app shell and assets', async () => {
    const r = await fetch(srv.base + '/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>Tally</title>');
    expect((await fetch(srv.base + '/js/store.js')).status).toBe(200);
    expect((await srv.api('POST', '/api/sync', { body: {} })).status).toBe(401);
    expect((await srv.api('POST', '/api/vault', { body: { invite: 'wrong' } })).status).toBe(403);
  });

  it('a cloud export of the example profile imports back unchanged', async () => {
    const tab = await openTab({ origin: srv.base });
    await loadExample(tab);
    /* add a logged day so days are covered too */
    tab.MB.store.setDoc('days/2026-09-01', { ...tab.MB.schema.emptyDay('2026-09-01'), meals: [{ id: 'm1', slot: 'breakfast', name: 'Oats', kcal: 400, p: 30, c: 50, f: 8 }], weight: 80.1, updatedAt: '2026-09-01T09:00:00.000Z' });
    expect(await roundTrip(tab)).toBeGreaterThan(70);
    tab.close();
  });

  const alex = join(PUBLIC, '..', 'private', 'tally-alex.json');
  it.skipIf(!existsSync(alex))('a cloud export of the private profile imports back unchanged', async () => {
    const tab = await openTab({ origin: srv.base });
    const { schema } = tab.MB;
    const r = schema.planImport(JSON.parse(readFileSync(alex, 'utf8')), { mode: 'replace', current: { settings: schema.normalizeSettings(null), hasSettings: false, foods: [], templates: [], days: [] } });
    const upserts = [['settings/main', { ...r.plan.settings, updatedAt: '2026-09-22T00:00:00.000Z' }], ...r.plan.foods.upsert.map(({ id, ...f }) => ['foods/' + id, { ...f, updatedAt: f.updatedAt || '2026-09-22T00:00:00.000Z' }]),
      ...r.plan.templates.upsert.map(({ id, ...t }) => ['templates/' + id, { ...t, updatedAt: t.updatedAt || '2026-09-22T00:00:00.000Z' }])];
    await tab.MB.store.bulk({ upserts });
    expect(await roundTrip(tab)).toBeGreaterThan(100);
    tab.close();
  });
});
