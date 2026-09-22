/* Tally API. Files in public/ are served as static assets and never reach this code; only /api/* and POST /share do.
   Auth: one random sync key per vault, sent as a bearer token; the server stores only its SHA-256. Creating a vault needs the
   INVITE_CODE secret. Sync: the client pushes changed documents, then pulls every row with seq > cursor. Per document, the
   newest updatedAt wins; deletes are tombstones. Free-plan budget: at most 42 D1 queries and one SHA-256 per request. */

const LIMITS = { body: 1024 * 1024, doc: 512 * 1024, changes: 40, page: 200, pageBytes: 2 * 1024 * 1024, path: 300, skewMs: 2 * 60 * 1000 };
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PATH_RE = /^[a-z][a-z0-9_-]*\/[^/\u0000-\u001f\u007f]+$/;

const UPSERT = `INSERT INTO docs (vault, path, body, updated_at, deleted, seq)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM docs WHERE vault = ?1))
  ON CONFLICT (vault, path) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
  WHERE excluded.updated_at > docs.updated_at`;
const PULL = 'SELECT path, body, updated_at, deleted, seq FROM docs WHERE vault = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status, text, extra) => new Response(text, { status, headers: { ...HEADERS, ...(extra || {}) } });
const fail = (status, message, extra) => json(status, JSON.stringify({ error: message }), extra);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > LIMITS.body) throw new HttpError(413, 'request too large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > LIMITS.body) throw new HttpError(413, 'request too large');
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new HttpError(400, 'invalid JSON'); }
}

/* sync keys: 16 random bytes as 26 base32 characters, shown as tly-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX.
   Normalizing ignores case, spaces, dashes and the optional tly prefix. */
function normalizeKey(raw) {
  let k = String(raw || '').toUpperCase().replace(/[\s-]+/g, '');
  if (k.length === 29 && k.startsWith('TLY')) k = k.slice(3);
  return /^[A-Z2-7]{26}$/.test(k) ? k : null;
}
function newKey() {
  let bits = 0, value = 0, out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(16))) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return 'tly-' + out.match(/.{1,4}/g).join('-');
}
async function hashKey(key) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
function sameSecret(given, expected) {
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) { crypto.subtle.timingSafeEqual(b, b); return false; }
  return crypto.subtle.timingSafeEqual(a, b);
}

const authed = handler => async (request, env) => {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  const key = m && normalizeKey(m[1]);
  const vault = key && await hashKey(key);
  if (!vault || !(await env.DB.prepare('SELECT 1 AS ok FROM vaults WHERE id = ?1').bind(vault).first())) throw new HttpError(401, 'unknown sync key');
  return handler(request, env, vault);
};

async function createVault(request, env) {
  const body = await readJson(request);
  const invite = String(env.INVITE_CODE || '').trim();
  if (!invite) throw new HttpError(503, 'vault creation is not set up on this server');
  if (!isObj(body) || typeof body.invite !== 'string' || !sameSecret(body.invite.trim(), invite)) throw new HttpError(403, 'wrong invite code');
  const key = newKey();
  await env.DB.prepare('INSERT INTO vaults (id, created_at) VALUES (?1, ?2)').bind(await hashKey(normalizeKey(key)), Date.now()).run();
  return json(201, JSON.stringify({ key }));
}

async function sync(request, env, vault) {
  const body = await readJson(request);
  if (!isObj(body)) throw new HttpError(400, 'expected an object');
  const cursor = body.cursor == null ? 0 : body.cursor;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, 'invalid cursor');
  const changes = body.changes == null ? [] : body.changes;
  if (!Array.isArray(changes)) throw new HttpError(400, 'changes must be a list');
  if (changes.length > LIMITS.changes) throw new HttpError(413, `at most ${LIMITS.changes} changes per request`);
  const now = Date.now(), upsert = env.DB.prepare(UPSERT);
  const writes = changes.map((c, i) => {
    if (!isObj(c) || typeof c.path !== 'string' || c.path.length > LIMITS.path || !PATH_RE.test(c.path)) throw new HttpError(400, `change ${i}: invalid path`);
    if (typeof c.updatedAt !== 'number' || !Number.isFinite(c.updatedAt) || c.updatedAt < 0) throw new HttpError(400, `change ${i}: invalid updatedAt`);
    const at = c.updatedAt > now + LIMITS.skewMs ? now : Math.round(c.updatedAt);
    if (c.deleted === true) return upsert.bind(vault, c.path, null, at, 1);
    if (!isObj(c.doc)) throw new HttpError(400, `change ${i}: doc must be an object`);
    const text = JSON.stringify({ ...c.doc, updatedAt: new Date(at).toISOString() });
    if (text.length > LIMITS.doc || (text.length * 3 > LIMITS.doc && new TextEncoder().encode(text).byteLength > LIMITS.doc)) throw new HttpError(413, `${c.path} is larger than 512 KB`);
    return upsert.bind(vault, c.path, text, at, 0);
  });
  /* one transaction: every write, then the pull, so the page is a consistent snapshot */
  const results = await env.DB.batch([...writes, env.DB.prepare(PULL).bind(vault, cursor, LIMITS.page + 1)]);
  const rows = results[results.length - 1].results;
  let more = rows.length > LIMITS.page, bytes = 0;
  const page = [];
  for (const r of rows.slice(0, LIMITS.page)) {
    const size = r.body ? r.body.length : 0;
    if (page.length && bytes + size > LIMITS.pageBytes) { more = true; break; }
    bytes += size; page.push(r);
  }
  /* bodies are stored as JSON text; splice them in instead of parsing and re-serializing */
  const items = page.map(r => `{"path":${JSON.stringify(r.path)},"updatedAt":${r.updated_at},"deleted":${r.deleted ? 'true' : 'false'},"seq":${r.seq},"doc":${r.deleted ? 'null' : (r.body || 'null')}}`);
  const next = page.length ? page[page.length - 1].seq : cursor;
  return json(200, `{"cursor":${next},"more":${more},"serverTime":${now},"changes":[${items.join(',')}]}`);
}

/* a normal Tally export (format v4), importable as-is */
async function exportVault(request, env, vault) {
  const { results } = await env.DB.prepare('SELECT path, body FROM docs WHERE vault = ?1 AND deleted = 0 ORDER BY path').bind(vault).all();
  /* the app writes the date first in day docs, so a prefix check spots it without parsing */
  const withField = (k, v, body) => body.startsWith(`{"${k}":`) ? body : `{${JSON.stringify(k)}:${JSON.stringify(v)}` + (body === '{}' ? '}' : ',' + body.slice(1));
  let settings = null;
  const lists = { foods: [], templates: [], days: [] };
  for (const r of results) {
    const i = r.path.indexOf('/'), coll = r.path.slice(0, i), id = r.path.slice(i + 1);
    if (r.path === 'settings/main') settings = r.body;
    else if (coll === 'foods' || coll === 'templates') lists[coll].push(withField('id', id, r.body));
    else if (coll === 'days') lists.days.push(withField('date', id, r.body));
  }
  const exportedAt = new Date().toISOString();
  const text = `{"app":"tally","version":4,"exportedAt":"${exportedAt}"` + (settings ? `,"settings":${settings}` : '') +
    `,"foods":[${lists.foods.join(',')}],"templates":[${lists.templates.join(',')}],"days":[${lists.days.join(',')}]}`;
  return json(200, text, { 'content-disposition': `attachment; filename="tally-cloud-${exportedAt.slice(0, 10)}.json"` });
}

async function deleteVault(request, env, vault) {
  await env.DB.batch([env.DB.prepare('DELETE FROM docs WHERE vault = ?1').bind(vault), env.DB.prepare('DELETE FROM vaults WHERE id = ?1').bind(vault)]);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

const ROUTES = {
  '/api/vault': { POST: createVault, DELETE: authed(deleteVault) },
  '/api/sync': { POST: authed(sync) },
  '/api/export': { GET: authed(exportVault) }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    /* share target before the service worker is active: open Get started */
    if (url.pathname === '/share' && request.method === 'POST') return Response.redirect(new URL('/#start', url).href, 303);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    const route = ROUTES[url.pathname];
    if (!route) return fail(404, 'not found');
    const handler = route[request.method];
    if (!handler) return fail(405, 'method not allowed', { allow: Object.keys(route).join(', ') });
    try { return await handler(request, env); }
    catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message, e.status === 401 ? { 'www-authenticate': 'Bearer' } : null);
      console.error(e && e.stack ? e.stack : e);
      return fail(500, 'server error');
    }
  }
};
