// Two devices (separate jsdom windows and IndexedDBs) syncing through the real Worker served locally.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { openTab, newDevice, waitFor } from './harness.js';
import { startServer, INVITE } from './server.js';

let srv;
const open = [];
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { if (srv) await srv.close(); });
afterEach(() => { while (open.length) open.pop().close(); });

const KEY_RE = /^tly-(?:[A-Z2-7]{4}-){6}[A-Z2-7]{2}$/;
async function tabOn(device, hash) { const tab = await openTab({ device, origin: srv.base, hash }); open.push(tab); return tab; }
const newTab = hash => tabOn(newDevice(), hash);
async function loadExample(tab) {
  tab.$('.tiles .tile').click();
  await waitFor(() => tab.MB.store.list('foods').length > 50 && tab.window.location.hash === '#today', { what: 'example loaded' });
}
/* a full sync; a second call covers a run that was already going when the first was made */
const sync = async tab => { await tab.MB.sync.syncNow(); return tab.MB.sync.syncNow(); };
const synced = tab => waitFor(() => { const s = tab.MB.sync.status(); return s.linked && s.state === 'synced' && !s.pending; }, { what: 'synced', timeout: 15000 });
/* every document of the active profile */
function docs(tab) {
  const { store } = tab.MB, out = {};
  const s = store.get('settings/main'); if (s) out['settings/main'] = s;
  for (const coll of ['foods', 'templates', 'days']) for (const { id, ...d } of store.list(coll)) out[coll + '/' + id] = d;
  return out;
}
/* A with the example profile, linked to a fresh vault; B linked to the same vault */
async function linkedPair(hashB = '#today') {
  const A = await newTab(); await loadExample(A);
  const key = await A.MB.sync.createVault(INVITE); await synced(A);
  const B = await newTab(); await B.MB.sync.link(key); await synced(B);
  if (hashB) await B.go(hashB);
  return { A, B, key };
}
const today = tab => tab.MB.ui.today();
async function tapHabit(tab, i = 0) { if (tab.window.location.hash !== '#today') await tab.go('#today'); tab.$$('#main .habit')[i].click(); }
async function writeNote(tab, text) {
  if (tab.window.location.hash !== '#today') await tab.go('#today');
  const ta = tab.$('#main textarea'); ta.value = text; ta.dispatchEvent(new tab.window.Event('change'));
}

describe('linking', () => {
  it('create a vault on A, link B with the key in any format: B receives everything', async () => {
    const A = await newTab(); await loadExample(A); await tapHabit(A);
    await A.go('#settings');
    A.button(A.t('sy.create'), '.synccard').click();
    A.$('.sheet input').value = INVITE; A.$('.sheet input').dispatchEvent(new A.window.Event('input'));
    A.button(A.t('sy.createBtn'), '.sheet').click();
    await waitFor(() => A.$('.synckey'), { what: 'key shown' });
    const key = A.text('.synckey');
    expect(key).toMatch(KEY_RE);
    expect(A.text('.sheet')).toContain(A.t('sy.keyWarn'));
    await synced(A);
    expect(A.$('.syncdot').classList.contains('hidden')).toBe(false);
    expect(A.$('.syncdot').dataset.state).toBe('synced');

    const B = await newTab('#settings');
    expect(B.$('.syncdot').classList.contains('hidden')).toBe(true);
    B.button(B.t('sy.link'), '.synccard').click();
    expect(B.text('.sheet')).toContain(B.t('sy.iphone'));
    const input = B.$('.sheet input');
    input.value = '  ' + key.toLowerCase().replace(/-/g, ' ') + ' '; input.dispatchEvent(new B.window.Event('input'));
    B.button(B.t('sy.linkBtn'), '.sheet').click();
    await waitFor(() => !B.$('.sheet'), { what: 'link sheet closed', timeout: 15000 });
    await synced(B);
    expect(docs(B)).toEqual(docs(A));
    expect(Object.keys(docs(B)).length).toBeGreaterThan(70); /* settings, 72 foods, 2 templates, today */
    expect(B.$('.syncdot').dataset.state).toBe('synced');
    expect(B.$('.synccard').dataset.linked).toBe('true');
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
  });

  it('a wrong invite code or an unknown key is refused and leaves the device unlinked', async () => {
    const A = await newTab('#settings');
    await expect(A.MB.sync.createVault('wrong')).rejects.toMatchObject({ code: 'invite' });
    await expect(A.MB.sync.link('not a key')).rejects.toMatchObject({ code: 'badKey' });
    await expect(A.MB.sync.link('tly-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA')).rejects.toMatchObject({ code: 'key' });
    expect(A.MB.sync.status().linked).toBe(false);
    expect(A.$('.synccard').dataset.linked).toBe('false');
    expect(A.errors).toEqual([]);
  });

  it('first link of B with its own older and newer documents: the newer copy of each survives on both', async () => {
    const T = Date.now() - 60000, iso = n => new Date(T + n).toISOString();
    const A = await newTab(); await loadExample(A);
    A.MB.store.setDoc('foods/x1', { name: 'A newer', kcal: 1, updatedAt: iso(2000) });
    A.MB.store.setDoc('foods/x2', { name: 'A older', kcal: 2, updatedAt: iso(1000) });
    const key = await A.MB.sync.createVault(INVITE); await synced(A);
    const B = await newTab();
    B.MB.store.setDoc('foods/x1', { name: 'B older', kcal: 1, updatedAt: iso(1000) });
    B.MB.store.setDoc('foods/x2', { name: 'B newer', kcal: 2, updatedAt: iso(2000) });
    B.MB.store.setDoc('foods/x3', { name: 'B only', kcal: 3, updatedAt: iso(0) });
    await B.MB.sync.link(key); await synced(B);
    await sync(A);
    for (const tab of [A, B]) {
      expect(tab.MB.store.get('foods/x1').name).toBe('A newer');
      expect(tab.MB.store.get('foods/x2').name).toBe('B newer');
      expect(tab.MB.store.get('foods/x3').name).toBe('B only');
    }
    expect(docs(A)).toEqual(docs(B));
  });
});

describe('changes', () => {
  it('an edit on A appears on B, whose open page re-renders in place', async () => {
    const { A, B } = await linkedPair('#today');
    const page = B.$('#main .page');
    expect(B.$$('#main .habit')[0].classList.contains('on')).toBe(false);
    await tapHabit(A);
    expect(A.MB.sync.status()).toMatchObject({ state: 'pending', pending: 1 });
    expect(A.$('.syncdot').dataset.state).toBe('pending');
    expect(A.text('.syncdot-n')).toBe('1');
    await sync(A); await sync(B);
    expect(B.MB.store.get('days/' + today(B))).toEqual(A.MB.store.get('days/' + today(A)));
    expect(B.$('#main .page')).not.toBe(page);
    expect(B.$$('#main .habit')[0].classList.contains('on') || B.$$('#main .habit')[0].classList.contains('part')).toBe(true);
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
  });

  it('both offline, the same day edited on both: the newer edit wins everywhere', async () => {
    const { A, B } = await linkedPair('#today');
    A.device.setOnline(false); B.device.setOnline(false);
    await writeNote(A, 'from A');
    await new Promise(r => setTimeout(r, 5));
    await writeNote(B, 'from B');
    expect(A.MB.sync.status().state).toBe('offline');
    expect(A.$('.syncdot').dataset.state).toBe('offline');
    /* the newer device syncs first, then the older one: its push is ignored and the pull brings the newer copy */
    B.device.setOnline(true); await sync(B);
    A.device.setOnline(true); await sync(A); await sync(B);
    for (const tab of [A, B]) expect(tab.MB.store.get('days/' + today(tab)).note).toBe('from B');
    expect(A.$('#main textarea').value).toBe('from B'); /* A's page re-rendered */
    expect(A.MB.sync.status().pending).toBe(0);
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
  });

  it('a delete on A removes it on B, and an older edit from B does not bring it back', async () => {
    const { A, B } = await linkedPair('#library');
    B.device.setOnline(false);
    B.MB.store.setDoc('foods/banana', { ...B.MB.store.get('foods/banana'), note: 'edited on B first', updatedAt: undefined });
    await new Promise(r => setTimeout(r, 5));
    A.MB.store.deleteDoc('foods/banana');
    await sync(A);
    B.device.setOnline(true); await sync(B); await sync(A);
    expect(A.MB.store.get('foods/banana')).toBeNull();
    expect(B.MB.store.get('foods/banana')).toBeNull();
    const cloud = (await srv.api('GET', '/api/export', { key: A.MB.sync.status().key })).json;
    expect(cloud.foods.some(f => f.id === 'banana')).toBe(false);
    expect(B.MB.sync.status().pending).toBe(0);
  });

  it('changing the weight unit converts logged weights on every device', async () => {
    const { A, B } = await linkedPair(null);
    A.MB.store.setDoc('days/2026-09-01', { ...A.MB.schema.emptyDay('2026-09-01'), weight: 200, updatedAt: '2026-09-01T08:00:00.000Z' });
    await sync(A); await sync(B);
    await A.go('#settings');
    const unitSel = [...A.$$('#main select')].find(s => [...s.options].some(o => o.value === 'kg'));
    unitSel.value = 'kg'; unitSel.dispatchEvent(new A.window.Event('change'));
    A.$('.savebar .btn.primary').click();
    await sync(A); await sync(B);
    expect(B.MB.store.get('settings/main').units.weight).toBe('kg');
    expect(B.MB.store.get('days/2026-09-01').weight).toBe(90.7);
  });
});

describe('applying pulled changes', () => {
  const at = n => Date.parse('2026-09-01T10:00:00.000Z') + n;
  const iso = n => new Date(at(n)).toISOString();
  const put = (path, n, doc = {}) => ({ path, updatedAt: at(n), deleted: false, doc: { name: path, ...doc, updatedAt: iso(n) } });
  const del = (path, n) => ({ path, updatedAt: at(n), deleted: true, doc: null });

  it('only newer changes apply; tombstones delete; nothing touches the outbox', async () => {
    const tab = await newTab();
    const { store } = tab.MB;
    await store.bulk({ upserts: [['foods/a', { name: 'local a', updatedAt: iso(100) }], ['foods/b', { name: 'local b', updatedAt: iso(100) }], ['foods/c', { name: 'local c', updatedAt: iso(100) }], ['foods/d', { name: 'local d', updatedAt: iso(100) }]] });
    const changed = await store.applyRemote([put('foods/a', 50), put('foods/b', 100), put('foods/c', 150), del('foods/d', 150), del('foods/gone', 150), put('foods/new', 10), del('foods/a', 99)]);
    expect(changed.sort()).toEqual(['foods/c', 'foods/d', 'foods/new']);
    expect(store.get('foods/a').name).toBe('local a'); /* older: ignored */
    expect(store.get('foods/b').name).toBe('local b'); /* same time: ignored */
    expect(store.get('foods/c')).toEqual({ name: 'foods/c', updatedAt: iso(150) });
    expect(store.get('foods/d')).toBeNull();
    expect(store.get('foods/new').name).toBe('foods/new');
    expect(store.syncMeta()).toBeNull();
  });

  it('a local change waiting to upload is never overwritten by an older pulled copy, not even a deletion waiting to upload', async () => {
    const tab = await newTab();
    const { store } = tab.MB;
    await store.syncLink('default', 'tly-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA');
    await store.setDoc('foods/kept', { name: 'kept', updatedAt: iso(100) });
    await store.setDoc('foods/removed', { name: 'removed', updatedAt: iso(50) });
    await store.deleteDoc('foods/removed'); /* tombstone stamped now, newer than anything below */
    const changed = await store.applyRemote([put('foods/removed', 200), put('foods/kept', 80)]);
    expect(changed).toEqual([]);
    expect(store.get('foods/removed')).toBeNull();
    expect(store.get('foods/kept').name).toBe('kept');
    expect(Object.keys(store.syncMeta().outbox).sort()).toEqual(['foods/kept', 'foods/removed']);
  });

  it('an edit made while a sync request is out is kept and uploaded next', async () => {
    const { A, B } = await linkedPair(null);
    await writeNote(B, 'B first'); await sync(B);
    let release; const gate = new Promise(r => { release = r; });
    A.device.intercept = async url => { if (url.endsWith('/api/sync')) await gate; };
    const running = A.MB.sync.syncNow();
    await new Promise(r => setTimeout(r, 20));
    await writeNote(A, 'A later'); /* while the request that will bring 'B first' is out */
    A.device.intercept = null; release();
    await running; await sync(A); await sync(B);
    for (const tab of [A, B]) expect(tab.MB.store.get('days/' + today(tab)).note).toBe('A later');
  });
});

describe('the open page', () => {
  it('waits while a sheet is open or an input has focus, then updates', async () => {
    const { A, B } = await linkedPair('#today');
    B.button(B.t('t.addSession')).click();
    expect(B.$('.sheet')).not.toBeNull();
    const page = B.$('#main .page');
    await tapHabit(A); await sync(A); await sync(B);
    expect(B.MB.store.get('days/' + today(B)).habits).toEqual(A.MB.store.get('days/' + today(A)).habits);
    expect(B.$('#main .page')).toBe(page); /* untouched while the sheet is open */
    B.$('.sheet-head button').click();
    await waitFor(() => B.$('#main .page') !== page, { what: 're-render after the sheet closed' });

    const ta = B.$('#main textarea'); ta.focus();
    expect(B.document.activeElement).toBe(ta);
    const page2 = B.$('#main .page');
    await tapHabit(A, 1); await sync(A); await sync(B);
    expect(B.$('#main .page')).toBe(page2); /* untouched while typing */
    ta.blur();
    await waitFor(() => B.$('#main .page') !== page2, { what: 're-render after blur' });
    expect(B.errors).toEqual([]);
  });

  it('keeps unsaved Settings edits when settings change elsewhere', async () => {
    const { A, B } = await linkedPair('#settings');
    const name = B.$('#main .card input[type=text]');
    name.value = 'Typed on B'; name.dispatchEvent(new B.window.Event('input')); name.blur();
    A.MB.store.setDoc('settings/main', { ...A.MB.store.get('settings/main'), targets: { kcal: 3100, protein: 190, carbs: 0, fat: 0 }, updatedAt: undefined });
    await sync(A); await sync(B);
    await waitFor(() => B.MB.store.get('settings/main').targets.kcal === 3100, { what: 'settings pulled' });
    expect(B.$('.savebar').classList.contains('show')).toBe(true);
    expect(B.$('#main .card input[type=text]').value).toBe('Typed on B');
  });
});

describe('robustness', () => {
  it('a failed request loses nothing; the outbox survives a reload', async () => {
    const { A, B, key } = await linkedPair('#today');
    A.device.intercept = url => url.includes('/api/sync') ? new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } }) : null;
    await tapHabit(A); await sync(A);
    expect(A.MB.sync.status()).toMatchObject({ state: 'error', pending: 1 });
    expect(A.$('.syncdot').dataset.state).toBe('error');
    A.$('.syncdot').click();
    expect(A.text('.toast')).toContain(A.t('sy.err.server', { status: 500 }));
    A.close(); open.splice(open.indexOf(A), 1);
    A.device.intercept = null;
    const A2 = await tabOn(A.device, '#today');
    expect(A2.MB.sync.status().key).toBe(key);
    await synced(A2);
    await sync(B);
    expect(B.MB.store.get('days/' + today(B))).toEqual(A2.MB.store.get('days/' + today(A2)));
  });

  it('a request that times out or a dropped connection counts as offline and retries later', async () => {
    const { A } = await linkedPair(null);
    A.device.intercept = () => { throw new TypeError('network down'); };
    await tapHabit(A); await sync(A);
    expect(A.MB.sync.status()).toMatchObject({ state: 'offline', pending: 1 });
    A.device.intercept = null;
    A.device.setOnline(true); /* the online event syncs */
    await synced(A);
  });

  it('pushes are split to at most 40 changes per request', async () => {
    const { A } = await linkedPair(null);
    const before = A.device.requests.length;
    await A.MB.store.bulk({ upserts: Array.from({ length: 95 }, (_, i) => ['foods/bulk' + i, { name: 'Bulk ' + i, kcal: i }]) });
    await sync(A);
    const posts = A.device.requests.slice(before).filter(r => r.url.endsWith('/api/sync'));
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(A.MB.sync.status().pending).toBe(0);
    const cloud = (await srv.api('GET', '/api/export', { key: A.MB.sync.status().key })).json;
    expect(cloud.foods.filter(f => f.id.startsWith('bulk')).length).toBe(95);
  });
});

describe('tabs', () => {
  it('tabs on one profile share data live; a tab on another profile keeps its own', async () => {
    const device = newDevice();
    const t1 = await tabOn(device); await loadExample(t1);
    const t2 = await tabOn(device, '#today');
    const t3 = await tabOn(device, '#settings');
    t3.button(t3.t('s.addProfile')).click();
    t3.$('.sheet input').value = 'Other'; t3.$('.sheet input').dispatchEvent(new t3.window.Event('input'));
    t3.button(t3.t('c.add'), '.sheet').click();
    await waitFor(() => t3.MB.store.currentProfile().name === 'Other' && t3.$('#main .page.start'), { what: 'profile switched, empty profile on Get started' });
    const t3page = t3.$('#main .page');
    await waitFor(() => t1.$('.profile-btn'), { what: 'profile button in tab 1' });

    const page = t2.$('#main .page');
    await tapHabit(t1);
    await waitFor(() => t2.MB.store.get('days/' + today(t2)), { what: 'tab 2 sees the write' });
    expect(t2.MB.store.get('days/' + today(t2))).toEqual(t1.MB.store.get('days/' + today(t1)));
    await waitFor(() => t2.$('#main .page') !== page, { what: 'tab 2 re-rendered' });
    expect(t2.$$('#main .habit')[0].classList.contains('on') || t2.$$('#main .habit')[0].classList.contains('part')).toBe(true);
    expect(t3.MB.store.currentProfile().name).toBe('Other');
    expect(t3.MB.store.get('days/' + today(t3))).toBeNull();
    expect(t3.$('#main .page')).toBe(t3page);
    for (const t of [t1, t2, t3]) expect(t.errors).toEqual([]);
  });

  it('two tabs never sync the same profile at the same time', async () => {
    const device = newDevice();
    const t1 = await tabOn(device); await loadExample(t1);
    await t1.MB.sync.createVault(INVITE); await synced(t1);
    const t2 = await tabOn(device, '#today');
    await waitFor(() => t2.MB.sync.status().linked, { what: 'tab 2 linked' });
    device.maxActive = 0;
    await t1.MB.store.bulk({ upserts: Array.from({ length: 60 }, (_, i) => ['foods/t' + i, { name: 'T' + i }]) });
    await Promise.all([t1.MB.sync.syncNow(), t2.MB.sync.syncNow(), t1.MB.sync.syncNow(), t2.MB.sync.syncNow()]);
    expect(device.maxActive).toBe(1);
    await waitFor(() => t1.MB.sync.status().pending === 0 && t2.MB.sync.status().pending === 0, { what: 'both tabs see an empty outbox', timeout: 10000 });
  });
});

describe('Settings card', () => {
  it('shows the key, downloads a cloud backup, unlinks, and deletes the cloud copy', async () => {
    const { A, B, key } = await linkedPair('#settings');
    await A.go('#settings');
    expect(A.text('.synccard .syncline')).toBe(A.t('sy.st.synced'));
    expect(A.text('.storedin')).toBe(A.t('sy.storedIn', { kind: 'IndexedDB' }));
    A.button(A.t('sy.showKey'), '.synccard').click();
    expect(A.text('.synckey')).toBe(key);
    A.button(A.t('c.copy'), '.sheet').click();
    await waitFor(() => A.device.clipboard === key, { what: 'copied' });
    A.$('.sheet-head button').click();

    A.button(A.t('sy.download'), '.synccard').click();
    await waitFor(() => A.device.downloads.length, { what: 'download' });
    const file = A.device.downloads[0];
    expect(file.name).toMatch(/^tally-.*-cloud\.json$/);
    const backup = JSON.parse(await file.blob.text());
    expect(backup).toMatchObject({ app: 'tally', version: 4 });
    expect(backup.foods.length).toBe(A.MB.store.list('foods').length);

    const foods = B.MB.store.list('foods').length;
    B.button(B.t('sy.unlink'), '.synccard').click();
    B.button(B.t('sy.unlinkBtn'), '.sheet').click();
    await waitFor(() => B.$('.synccard').dataset.linked === 'false', { what: 'B unlinked' });
    expect(B.MB.store.list('foods').length).toBe(foods);
    expect(B.$('.syncdot').classList.contains('hidden')).toBe(true);
    expect(B.text('.storedin')).toBe(B.t('s.storedIn', { kind: 'IndexedDB' }));

    A.button(A.t('sy.deleteCloud'), '.synccard').click();
    expect(A.text('.sheet')).toContain(A.t('sy.deleteConfirm'));
    A.button(A.t('sy.deleteBtn'), '.sheet').click();
    await waitFor(() => A.$('.synccard').dataset.linked === 'false', { what: 'A unlinked' });
    expect((await srv.api('POST', '/api/sync', { key, body: {} })).status).toBe(401);
    await expect(B.MB.sync.link(key)).rejects.toMatchObject({ code: 'key' });
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
  });

  it('a device whose vault was deleted elsewhere shows an error and keeps its data', async () => {
    const { A, B } = await linkedPair('#today');
    await A.MB.sync.deleteCloud();
    await tapHabit(B); await sync(B);
    expect(B.MB.sync.status()).toMatchObject({ state: 'error', error: { code: 'key' } });
    B.$('.syncdot').click();
    expect(B.text('.toast')).toContain(B.t('sy.err.key'));
    expect(B.MB.store.list('foods').length).toBeGreaterThan(50);
  });

  it('erasing a linked profile unlinks it and never deletes the cloud copy', async () => {
    const { A, B, key } = await linkedPair(null);
    await A.go('#settings');
    A.button(A.t('s.erase'), '#main').click();
    expect(A.text('.sheet')).toContain(A.t('sy.cloudKept'));
    A.button(A.t('s.eraseBtn'), '.sheet').click();
    await waitFor(() => !A.MB.store.list('foods').length, { what: 'erased' });
    expect(A.MB.sync.status().linked).toBe(false);
    await new Promise(r => setTimeout(r, 50));
    await sync(B);
    expect(B.MB.store.list('foods').length).toBeGreaterThan(50);
    const cloud = (await srv.api('GET', '/api/export', { key })).json;
    expect(cloud.foods.length).toBeGreaterThan(50);
  });
});

describe('unlinked', () => {
  it('works exactly as before, offline or online, without a single request or console error', async () => {
    for (const online of [false, true]) {
      const device = newDevice(); device.online = online;
      const tab = await tabOn(device);
      await loadExample(tab);
      await tapHabit(tab); await writeNote(tab, 'note');
      for (const r of ['#plan', '#progress', '#library', '#settings', '#start', '#today']) await tab.go(r);
      expect(tab.MB.store.get('days/' + today(tab)).note).toBe('note');
      expect(tab.$('.syncdot').classList.contains('hidden')).toBe(true);
      expect(tab.MB.sync.status()).toMatchObject({ linked: false });
      await new Promise(r => setTimeout(r, 50));
      expect(device.requests).toEqual([]);
      expect(tab.errors).toEqual([]);
    }
  });
});
