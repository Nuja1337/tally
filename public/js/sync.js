/* Tally — optional cloud sync for the active profile. IndexedDB stays the source of truth: store.js records an outbox of
   local changes, this module uploads it to the Worker API and applies what comes back. Per document the newest updatedAt
   wins (the same rule as import); deletes travel as tombstones. The server refuses a copy from a device that has not seen
   that document's latest version (it lists it in rejected, and the pull brings the newer one), and store.applyRemote
   merges a day or the setup edited on both sides, so no device's entries get lost. Offline or unlinked, nothing here runs.
   One loop round: send up to 40 outbox entries with the cursor, apply the returned changes, clear the entries that were
   sent unless they changed again meanwhile, save the cursor; repeat while entries remain or the server has more. */
window.MB = window.MB || {};
(() => {
  'use strict';
  const store = MB.store;
  /* the sync protocol: 2 = the server may reject stale copies, and this app merges */
  const PROTOCOL = 2;
  const BATCH = 40, BATCH_BYTES = 900 * 1024, DOC_MAX = 512 * 1024, TIMEOUT = 15000, DEBOUNCE = 3000, STALE = 30000, BACKOFF_MIN = 5000, BACKOFF_MAX = 300000;
  const ms = iso => Date.parse(iso) || 0;
  const bytes = s => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length * 3);
  let running = null, again = false, timer = null, backoff = 0, busy = false, failure = null;

  class SyncError extends Error { constructor(code, info) { super(code); this.code = code; Object.assign(this, info || {}); } }

  /* keys: 26 base32 characters, shown as tly-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX; case, spaces, dashes and the prefix are optional */
  function normalizeKey(raw) {
    let k = String(raw || '').toUpperCase().replace(/[\s-]+/g, '');
    if (k.length === 29 && k.startsWith('TLY')) k = k.slice(3);
    return /^[A-Z2-7]{26}$/.test(k) ? k : null;
  }
  const formatKey = k => 'tly-' + k.match(/.{1,4}/g).join('-');

  async function request(method, path, key, body) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => { if (ctl) ctl.abort(); }, TIMEOUT);
    try {
      let res;
      try {
        res = await fetch(path, { method, headers: { 'x-tally-format': String(MB.schema.VERSION), 'x-tally-sync': String(PROTOCOL), ...(key ? { authorization: 'Bearer ' + key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined });
      } catch (e) { throw new SyncError(ctl && ctl.signal.aborted ? 'timeout' : 'offline'); }
      if (res.status === 401) throw new SyncError('key', { status: 401 });
      if (res.status === 403) throw new SyncError('invite', { status: 403 });
      if (res.status === 426) throw new SyncError('upgrade', { status: 426 });
      if (!res.ok) { let msg = ''; try { msg = (await res.json()).error || ''; } catch (e) {} throw new SyncError('server', { status: res.status, detail: msg }); }
      if (res.status === 204) return null;
      try { return method === 'GET' ? await res.text() : await res.json(); } catch (e) { throw new SyncError(ctl && ctl.signal.aborted ? 'timeout' : 'offline'); }
    } finally { clearTimeout(timeout); }
  }

  const activeId = () => store.currentProfile().id;
  const linked = () => { const m = store.syncMeta(); return !!(m && m.key); };
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

  function status() {
    const m = store.syncMeta();
    if (!m || !m.key) return { linked: false, state: 'off', pending: 0 };
    const pending = Object.keys(m.outbox || {}).length;
    const error = (failure && failure.code !== 'offline' && failure.code !== 'timeout') ? failure : (m.lastError || null);
    let state = 'synced';
    if (busy) state = 'syncing';
    else if (!online() || (failure && (failure.code === 'offline' || failure.code === 'timeout'))) state = 'offline';
    else if (error) state = 'error';
    else if (pending) state = 'pending';
    return { linked: true, state, pending, lastSync: m.lastSync || null, error: state === 'offline' ? (failure || { code: 'offline' }) : error, key: m.key };
  }
  const emit = () => { if (typeof api.onchange === 'function') { try { api.onchange(status()); } catch (e) { console.error(e); } } };

  function schedule(delay) {
    clearTimeout(timer); timer = null;
    if (!linked()) return;
    timer = setTimeout(() => { timer = null; syncNow(); }, delay);
  }
  /* one sync at a time per tab, and per profile across tabs when the browser has Web Locks */
  function withLock(id, fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('tally-sync:' + id, { ifAvailable: true }, lock => lock ? fn() : 'busy');
    }
    return fn();
  }
  function syncNow() {
    if (!linked()) { emit(); return Promise.resolve(status()); }
    if (running) { again = true; return running.then(status); }
    clearTimeout(timer); timer = null;
    if (!online()) { failure = { code: 'offline' }; emit(); return Promise.resolve(status()); }
    const id = activeId();
    running = withLock(id, () => loop(id))
      .then(r => { if (r === 'busy') schedule(DEBOUNCE); else { failure = null; backoff = 0; } }, e => fail(id, e))
      .finally(() => { running = null; busy = false; emit(); if (again) { again = false; schedule(0); } });
    return running.then(status);
  }
  function fail(id, e) {
    if (!(e instanceof SyncError)) { console.warn('sync failed', e); e = new SyncError('local'); }
    failure = { code: e.code, status: e.status, path: e.path };
    if (e.code !== 'offline' && e.code !== 'timeout') store.syncUpdate(id, m => (m && m.key) ? { ...m, lastError: { code: e.code, status: e.status || null } } : m).catch(() => {});
    if (e.code === 'key' || e.code === 'upgrade') return; /* the vault is gone, the key is wrong or this app is out of date: wait for the person */
    backoff = Math.min(BACKOFF_MAX, backoff ? backoff * 2 : BACKOFF_MIN);
    schedule(backoff);
  }

  /* the next request: up to 40 entries and about 900 KB, bodies read fresh from storage */
  async function nextBatch(id, meta) {
    const entries = Object.entries(meta.outbox || {}).slice(0, BATCH);
    const bodies = await store.readDocs(id, entries.filter(([, e]) => !e.deleted).map(([p]) => p));
    const changes = [], sent = [], tooLarge = [];
    let size = 0;
    for (const [path, e] of entries) {
      if (e.deleted) { changes.push({ path, deleted: true, updatedAt: ms(e.updatedAt) }); sent.push([path, e]); continue; }
      const doc = bodies.get(path);
      if (!doc) { sent.push([path, e]); continue; } /* gone locally; its tombstone entry replaces this one */
      const n = bytes(JSON.stringify(doc));
      if (n > DOC_MAX) { tooLarge.push(path); continue; }
      if (changes.length && size + n > BATCH_BYTES) break;
      size += n;
      changes.push({ path, doc, updatedAt: ms(doc.updatedAt), deleted: false }); sent.push([path, e]);
    }
    return { changes, sent, tooLarge };
  }
  async function loop(id) {
    busy = true; emit();
    for (let round = 0; round < 1000; round++) {
      const meta = await store.syncRead(id);
      if (!meta || !meta.key) return;
      const { changes, sent, tooLarge } = await nextBatch(id, meta);
      const res = await request('POST', '/api/sync', meta.key, { cursor: meta.cursor || 0, changes });
      const still = store.syncMeta(id);
      if (!still || still.key !== meta.key) return; /* unlinked while the request was out */
      const changed = await store.applyRemote(res.changes, id, new Map(sent.map(([p, e]) => [p, e.updatedAt])));
      /* a refused copy waits while the server has more pages: the newer version is still to come and gets merged */
      const refused = new Set(Array.isArray(res.rejected) ? res.rejected : []), cleared = new Set();
      const after = await store.syncUpdate(id, m => {
        if (!m || m.key !== meta.key) return m;
        const outbox = { ...(m.outbox || {}) };
        for (const [p, e] of sent) { const cur = outbox[p]; if (cur && cur.updatedAt === e.updatedAt && !!cur.deleted === !!e.deleted && !(res.more && refused.has(p))) { delete outbox[p]; cleared.add(p); } }
        return { ...m, outbox, cursor: Math.max(m.cursor || 0, res.cursor || 0), lastSync: Date.now(), lastError: tooLarge.length ? { code: 'tooLarge', path: tooLarge[0] } : null };
      });
      if (cleared.size) await store.dropBases(id, [...cleared]);
      if (tooLarge.length) failure = { code: 'tooLarge', path: tooLarge[0] };
      if (changed.length && id === activeId() && typeof api.onremote === 'function') { try { api.onremote(changed); } catch (e) { console.error(e); } }
      emit();
      /* entries added while the request was out go in the next round; too-large documents wait for the person */
      const left = Object.keys((after && after.outbox) || {}).filter(p => !tooLarge.includes(p)).length;
      if (!res.more && !left) return;
    }
  }

  async function attach(k) {
    clearTimeout(timer); timer = null; failure = null; backoff = 0;
    await store.syncLink(activeId(), formatKey(k));
    emit();
  }
  /* linking waits for the first sync, so an unknown key is reported (and undone) right away */
  async function link(rawKey) {
    const k = normalizeKey(rawKey);
    if (!k) throw new SyncError('badKey');
    await attach(k);
    const st = await syncNow();
    if (failure && failure.code === 'key') { await unlink(); throw new SyncError('key'); }
    return st;
  }
  /* a new vault: the key comes back at once and the first upload runs in the background */
  async function createVault(invite) {
    if (!online()) throw new SyncError('offline');
    const res = await request('POST', '/api/vault', null, { invite: String(invite || '').trim() });
    await attach(normalizeKey(res.key));
    syncNow();
    return res.key;
  }
  async function unlink() {
    clearTimeout(timer); timer = null; failure = null; backoff = 0;
    await store.syncUnlink(activeId());
    emit();
  }
  /* deletes the vault on the server for every device, then unlinks this one; local data stays */
  async function deleteCloud() {
    const m = store.syncMeta();
    if (!m || !m.key) return;
    try { await request('DELETE', '/api/vault', m.key); } catch (e) { if (e.code !== 'key') throw e; }
    await unlink();
  }
  async function exportCloud() {
    const m = store.syncMeta();
    if (!m || !m.key) throw new SyncError('key');
    return request('GET', '/api/export', m.key);
  }
  /* the active profile changed: sync the new one if it is linked */
  function profileChanged() { clearTimeout(timer); timer = null; failure = null; backoff = 0; emit(); if (linked()) syncNow(); }

  function init() {
    store.onlocal = () => { emit(); schedule(DEBOUNCE); };
    window.addEventListener('online', () => { failure = null; backoff = 0; emit(); syncNow(); });
    window.addEventListener('offline', emit);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const m = store.syncMeta();
      if (m && m.key && (!m.lastSync || Date.now() - m.lastSync > STALE)) syncNow();
    });
    if (linked()) syncNow(); else emit();
  }

  const api = { init, link, createVault, unlink, deleteCloud, exportCloud, syncNow, status, profileChanged, refresh: emit, normalizeKey, formatKey, SyncError, onchange: null, onremote: null };
  MB.sync = api;
})();
