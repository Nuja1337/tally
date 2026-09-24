// API tests, run inside the Workers runtime against a local D1 with migrations applied.
import { env, exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

const INVITE = 'test-invite';
const KEY_RE = /^tly-(?:[A-Z2-7]{4}-){6}[A-Z2-7]{2}$/;

function call(method, path, { key, body, raw, format = '5', protocol = '2' } = {}) {
  const headers = { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(format ? { 'x-tally-format': format } : {}), ...(protocol ? { 'x-tally-sync': protocol } : {}) };
  return exports.default.fetch(new Request('https://tally.test' + path, { method, headers, body: raw != null ? raw : body != null ? JSON.stringify(body) : undefined, redirect: 'manual' }));
}
async function newVault() {
  const r = await call('POST', '/api/vault', { body: { invite: INVITE } });
  expect(r.status).toBe(201);
  return (await r.json()).key;
}
async function sync(key, cursor, changes) {
  const r = await call('POST', '/api/sync', { key, body: { cursor, changes } });
  return { status: r.status, ...(await r.json()) };
}
async function pullAll(key, cursor = 0) {
  const out = []; let more = true, pages = 0;
  while (more) { const r = await sync(key, cursor, []); expect(r.status).toBe(200); out.push(...r.changes); cursor = r.cursor; more = r.more; pages++; }
  return { changes: out, cursor, pages };
}
const put = (path, doc, updatedAt) => ({ path, doc, updatedAt, deleted: false });
const del = (path, updatedAt) => ({ path, updatedAt, deleted: true });
const T = Date.parse('2026-09-01T10:00:00.000Z');
const sha256 = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
const normalized = key => key.toUpperCase().replace(/-/g, '').slice(3);

describe('vaults', () => {
  it('needs the right invite code', async () => {
    for (const body of [{ invite: 'wrong' }, { invite: INVITE + 'x' }, { invite: '' }, {}]) expect((await call('POST', '/api/vault', { body })).status).toBe(403);
    expect((await call('POST', '/api/vault', { raw: 'not json' })).status).toBe(400);
    const r = await call('POST', '/api/vault', { body: { invite: ` ${INVITE} ` } });
    expect(r.status).toBe(201);
    expect((await r.json()).key).toMatch(KEY_RE);
  });

  it('issues distinct keys and stores only their hash', async () => {
    const a = await newVault(), b = await newVault();
    expect(a).not.toBe(b);
    const row = await env.DB.prepare('SELECT id FROM vaults WHERE id = ?').bind(await sha256(normalized(a))).first();
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM vaults WHERE id LIKE ?').bind('%' + normalized(a) + '%').first('n')).toBe(0);
  });

  it('rejects missing, malformed and unknown keys with 401', async () => {
    const unknown = 'tly-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA';
    for (const key of [undefined, 'nonsense', 'tly-1111', unknown]) {
      for (const [m, p] of [['POST', '/api/sync'], ['GET', '/api/export'], ['DELETE', '/api/vault']]) {
        const r = await call(m, p, { key, body: m === 'POST' ? {} : undefined });
        expect(r.status, `${m} ${p} ${key}`).toBe(401);
        expect((await r.json()).error).toBeTruthy();
      }
    }
  });

  it('accepts the key in any case, with spaces, without dashes or prefix', async () => {
    const key = await newVault(), bare = normalized(key);
    for (const k of [key, key.toLowerCase(), key.replace(/-/g, ' '), bare, bare.toLowerCase(), 'TLY' + bare]) expect((await sync(k, 0, [])).status, k).toBe(200);
  });

  it('deleting a vault removes it and all its documents', async () => {
    const key = await newVault(), id = await sha256(normalized(key));
    await sync(key, 0, [put('days/2026-09-01', { note: 'a' }, T), put('foods/x', { name: 'X' }, T)]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE vault = ?').bind(id).first('n')).toBe(2);
    expect((await call('DELETE', '/api/vault', { key })).status).toBe(204);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE vault = ?').bind(id).first('n')).toBe(0);
    expect((await sync(key, 0, [])).status).toBe(401);
  });
});

describe('sync', () => {
  it('refuses apps older than data format 5, so they cannot overwrite newer documents', async () => {
    const key = await newVault();
    for (const format of [null, '4', 'x']) {
      const r = await call('POST', '/api/sync', { key, format, body: { cursor: 0, changes: [put('days/2026-09-01', { date: '2026-09-01', habits: { water: 3 } }, T)] } });
      expect(r.status, String(format)).toBe(426);
      expect((await r.json()).error).toMatch(/update/);
    }
    /* 2.3.0 spoke format 5 but not sync protocol 2: it could not merge, so it must reload first */
    for (const protocol of [null, '1']) expect((await call('POST', '/api/sync', { key, protocol, body: { cursor: 0, changes: [] } })).status, String(protocol)).toBe(426);
    expect((await pullAll(key)).changes).toEqual([]);
  });

  it('refuses a copy from a device that has not seen the latest version, and lists it in rejected', async () => {
    const key = await newVault(), p = 'days/2026-09-05';
    const a = await sync(key, 0, [put(p, { meals: ['a'] }, T)]); /* device A */
    expect(a.rejected).toEqual([]);
    /* device B never pulled A's copy (cursor 0): its newer copy is refused and A's comes back to merge */
    const b = await sync(key, 0, [put(p, { meals: ['b'] }, T + 1000)]);
    expect(b.rejected).toEqual([p]);
    expect(b.changes).toMatchObject([{ path: p, doc: { meals: ['a'] }, seq: 1 }]);
    /* with that version seen, the merged copy goes in */
    const merged = await sync(key, b.cursor, [put(p, { meals: ['a', 'b'] }, T + 2000)]);
    expect(merged.rejected).toEqual([]);
    expect((await pullAll(key)).changes).toMatchObject([{ path: p, doc: { meals: ['a', 'b'] } }]);
    /* deletes are never refused */
    const gone = await sync(key, 0, [del(p, T + 3000)]);
    expect(gone.rejected).toEqual([]);
    expect((await pullAll(key)).changes).toMatchObject([{ path: p, deleted: true }]);
  });

  it('push then pull, from the same and another device', async () => {
    const key = await newVault();
    const pushed = await sync(key, 0, [put('settings/main', { name: 'Sam' }, T), put('days/2026-09-01', { date: '2026-09-01', note: 'hi' }, T + 1)]);
    expect(pushed.status).toBe(200);
    expect(pushed.changes.map(c => c.path)).toEqual(['settings/main', 'days/2026-09-01']);
    expect(pushed.cursor).toBe(2);
    expect(pushed.more).toBe(false);
    expect(Math.abs(pushed.serverTime - Date.now())).toBeLessThan(5000);
    const other = await sync(key, 0, []);
    expect(other.changes).toEqual([
      { path: 'settings/main', updatedAt: T, deleted: false, seq: 1, doc: { name: 'Sam', updatedAt: new Date(T).toISOString() } },
      { path: 'days/2026-09-01', updatedAt: T + 1, deleted: false, seq: 2, doc: { date: '2026-09-01', note: 'hi', updatedAt: new Date(T + 1).toISOString() } }
    ]);
    expect((await sync(key, 2, [])).changes).toEqual([]);
    expect((await sync(key, 1, [])).changes.map(c => c.path)).toEqual(['days/2026-09-01']);
  });

  it('keeps vaults apart', async () => {
    const a = await newVault(), b = await newVault();
    await sync(a, 0, [put('foods/a', { name: 'A' }, T)]);
    await sync(b, 0, [put('foods/b', { name: 'B' }, T)]);
    expect((await pullAll(a)).changes.map(c => c.path)).toEqual(['foods/a']);
    expect((await pullAll(b)).changes.map(c => c.path)).toEqual(['foods/b']);
  });

  it('newer write wins; older and equal timestamps are ignored', async () => {
    const key = await newVault(), p = 'days/2026-09-02';
    await sync(key, 0, [put(p, { v: 'first' }, T)]);
    const older = await sync(key, 1, [put(p, { v: 'older' }, T - 1000)]);
    expect(older.changes).toEqual([]); /* not applied, so nothing new to pull */
    await sync(key, 1, [put(p, { v: 'tie' }, T)]);
    expect((await pullAll(key)).changes).toMatchObject([{ path: p, doc: { v: 'first' }, updatedAt: T, seq: 1 }]);
    const newer = await sync(key, 1, [put(p, { v: 'newer' }, T + 1000)]);
    expect(newer.changes).toMatchObject([{ path: p, doc: { v: 'newer' }, updatedAt: T + 1000 }]);
    expect(newer.changes[0].seq).toBeGreaterThan(1);
  });

  it('clamps timestamps more than 2 minutes ahead to server time', async () => {
    const key = await newVault(), now = Date.now();
    const r = await sync(key, 0, [put('days/2026-09-03', { v: 1 }, now + 3600e3), put('days/2026-09-04', { v: 2 }, now + 60e3)]);
    const [far, near] = r.changes;
    expect(far.updatedAt).toBeLessThanOrEqual(r.serverTime);
    expect(far.updatedAt).toBeGreaterThanOrEqual(now - 1000);
    expect(far.doc.updatedAt).toBe(new Date(far.updatedAt).toISOString());
    expect(near.updatedAt).toBe(now + 60e3);
  });

  it('tombstones propagate and older copies do not bring a document back', async () => {
    const key = await newVault(), p = 'foods/gone';
    await sync(key, 0, [put(p, { name: 'Gone' }, T)]);
    await sync(key, 0, [del(p, T + 1000)]);
    expect((await pullAll(key)).changes).toEqual([{ path: p, updatedAt: T + 1000, deleted: true, seq: 2, doc: null }]);
    await sync(key, 2, [put(p, { name: 'Stale copy' }, T + 500)]);
    expect((await pullAll(key)).changes).toMatchObject([{ path: p, deleted: true, doc: null }]);
    await sync(key, 2, [put(p, { name: 'Recreated' }, T + 2000)]);
    expect((await pullAll(key)).changes).toMatchObject([{ path: p, deleted: false, doc: { name: 'Recreated' } }]);
  });

  it('pulls 250 documents across pages', async () => {
    const key = await newVault();
    const paths = Array.from({ length: 250 }, (_, i) => `days/d${String(i).padStart(3, '0')}`);
    for (let i = 0; i < paths.length; i += 40) expect((await sync(key, 0, paths.slice(i, i + 40).map(p => put(p, { p }, T)))).status).toBe(200);
    const first = await sync(key, 0, []);
    expect(first.changes.length).toBe(200);
    expect(first.more).toBe(true);
    const second = await sync(key, first.cursor, []);
    expect(second.changes.length).toBe(50);
    expect(second.more).toBe(false);
    expect([...first.changes, ...second.changes].map(c => c.path)).toEqual(paths);
  });

  it('caps a page at about 2 MB', async () => {
    const key = await newVault(), big = 'x'.repeat(480 * 1024);
    for (let i = 0; i < 5; i++) expect((await sync(key, 0, [put('templates/t' + i, { big }, T)])).status).toBe(200);
    const first = await sync(key, 0, []);
    expect(first.changes.length).toBe(4);
    expect(first.more).toBe(true);
    const second = await sync(key, first.cursor, []);
    expect(second.changes.map(c => c.path)).toEqual(['templates/t4']);
    expect(second.more).toBe(false);
  });
});

describe('limits and validation', () => {
  it('rejects more than 40 changes with 413 and writes nothing', async () => {
    const key = await newVault();
    const changes = Array.from({ length: 41 }, (_, i) => put('foods/f' + i, { name: 'F' }, T));
    expect((await sync(key, 0, changes)).status).toBe(413);
    expect((await sync(key, 0, changes.slice(0, 40))).status).toBe(200);
    expect((await pullAll(key)).changes.length).toBe(40);
  });

  it('rejects a body over 1 MB and a document over 512 KB', async () => {
    const key = await newVault();
    expect((await call('POST', '/api/sync', { key, raw: JSON.stringify({ cursor: 0, changes: [put('foods/a', { s: 'x'.repeat(1024 * 1024) }, T)] }) })).status).toBe(413);
    const r = await sync(key, 0, [put('foods/ok', { name: 'OK' }, T), put('foods/big', { s: 'x'.repeat(520 * 1024) }, T)]);
    expect(r.status).toBe(413);
    expect(r.error).toContain('foods/big');
    expect((await pullAll(key)).changes).toEqual([]); /* a rejected request writes nothing */
  });

  it('validates cursor, paths, timestamps and docs', async () => {
    const key = await newVault();
    const bad = [
      { cursor: -1, changes: [] }, { cursor: 1.5, changes: [] }, { cursor: 'x', changes: [] }, { cursor: 0, changes: {} },
      { cursor: 0, changes: [put('nope', {}, T)] }, { cursor: 0, changes: [put('days/a/b', {}, T)] }, { cursor: 0, changes: [put('Days/x', {}, T)] },
      { cursor: 0, changes: [put('days/x', {}, 'yesterday')] }, { cursor: 0, changes: [put('days/x', {}, -5)] },
      { cursor: 0, changes: [put('days/x', null, T)] }, { cursor: 0, changes: [put('days/x', [1], T)] }, { cursor: 0, changes: ['days/x'] }
    ];
    for (const body of bad) expect((await call('POST', '/api/sync', { key, body })).status, JSON.stringify(body)).toBe(400);
    expect((await call('POST', '/api/sync', { key, raw: '{' })).status).toBe(400);
    expect((await sync(key, 0, [put('foods/鶏むね肉-2', { name: '鶏むね肉' }, T)])).status).toBe(200);
  });
});

describe('export', () => {
  it('returns a normal Tally export without deleted documents', async () => {
    const key = await newVault();
    await sync(key, 0, [
      put('settings/main', { name: 'Sam', units: { weight: 'kg' } }, T),
      put('foods/oats', { name: 'Oats', kcal: 150 }, T), put('foods/gone', { name: 'Gone' }, T), put('foods/empty', {}, T),
      put('templates/bowl', { name: 'Bowl', slot: 'lunch', kcal: 600 }, T),
      put('days/2026-09-02', { date: '2026-09-02', note: 'b' }, T), put('days/2026-09-01', { note: 'no date field' }, T),
      put('history/2026-09-01', { targets: { kcal: 2000 } }, T), put('events/fall-open', { date: '2026-10-18', title: 'Fall Open', big: true }, T)
    ]);
    await sync(key, 0, [del('foods/gone', T + 1)]);
    const r = await call('GET', '/api/export', { key });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="tally-cloud-\d{4}-\d{2}-\d{2}\.json"/);
    const text = await r.text(), data = JSON.parse(text);
    expect(text).not.toMatch(/"date":"[^"]*","date"/);
    expect(Object.keys(data)).toEqual(['app', 'version', 'exportedAt', 'settings', 'foods', 'templates', 'days', 'events', 'history']);
    expect(data.events).toEqual([{ id: 'fall-open', date: '2026-10-18', title: 'Fall Open', big: true, updatedAt: new Date(T).toISOString() }]);
    expect(data).toMatchObject({ app: 'tally', version: 5, settings: { name: 'Sam', units: { weight: 'kg' } } });
    expect(data.history).toEqual([{ date: '2026-09-01', targets: { kcal: 2000 }, updatedAt: new Date(T).toISOString() }]);
    expect(Date.parse(data.exportedAt)).toBeGreaterThan(Date.now() - 10000);
    expect(data.foods.map(f => f.id)).toEqual(['empty', 'oats']);
    expect(data.foods[1]).toMatchObject({ id: 'oats', name: 'Oats', kcal: 150 });
    expect(data.templates).toMatchObject([{ id: 'bowl', name: 'Bowl', slot: 'lunch' }]);
    expect(data.days.map(d => d.date)).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('exports an empty vault as empty lists', async () => {
    const data = await (await call('GET', '/api/export', { key: await newVault() })).json();
    expect(data).toMatchObject({ app: 'tally', version: 5, history: [], foods: [], templates: [], days: [], events: [] });
    expect(data.settings).toBeUndefined();
  });
});

describe('routing', () => {
  it('POST /share redirects to Get started', async () => {
    const r = await call('POST', '/share', { raw: 'x' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('https://tally.test/#start');
  });

  it('unknown API paths are 404 and wrong methods 405', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404);
    const r = await call('GET', '/api/sync');
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('POST');
    expect((await call('PUT', '/api/vault')).headers.get('allow')).toBe('POST, DELETE');
  });
});
