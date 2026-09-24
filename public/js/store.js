/* Tally — local-first storage with profiles. Everything lives in memory and is persisted to IndexedDB
   (fallback: localStorage, then memory). Document paths are relative to the active profile:
   settings/main, days/2026-09-01, foods/<id>, templates/<id>. Internally: p/<profileId>/<path>; app metadata: m/<key>.
   Sync: a linked profile keeps m/sync:<profileId> = { key, cursor, outbox: { [path]: { deleted, updatedAt } }, lastSync, lastError }.
   A day or the setup edited while linked also keeps m/base:<profileId>/<path>: its copy from before the first edit since
   the last sync, so an edit made elsewhere meanwhile can be merged in instead of one side winning.
   Local writes add outbox entries in the same transaction as the document; sync.js uploads them. Open tabs share one
   database and tell each other which keys changed (BroadcastChannel), so every tab shows the same data. */
window.MB = window.MB || {};
(() => {
  'use strict';
  const { clone } = MB.ui;
  const DB_NAME = 'tally', STORE = 'docs', LS = 'tally:', PREFS = ['theme', 'lang'];
  /* earlier names of this app, newest first: 2.0-2.1 "Mettle", 1.x "Matbook" */
  const OLD_NAMES = ['mettle', 'matbook'];
  let mem = new Map(), backend = null, kind = 'memory', pid = 'default', channel = null;
  const docL = {}, collL = {}, inflight = new Map();
  const full = p => `p/${pid}/${p}`;
  const collOf = path => path.slice(0, path.lastIndexOf('/'));
  const syncKey = id => 'm/sync:' + id;
  const baseKey = (id, path) => `m/base:${id}/${path}`;
  const mergeable = path => path === 'settings/main' || path.startsWith('days/');
  const ms = iso => Date.parse(iso) || 0;
  const isDoc = d => !!d && typeof d === 'object' && !Array.isArray(d);

  /* Backends run a list of ops in one transaction: ['put', key, data], ['del', key], ['merge', key, fn].
     A merge reads the stored value, stores fn(value) (undefined deletes) and reports the result. */
  function openIDB(name) {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      let req;
      try { req = indexedDB.open(name, 1); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => rej(new Error('IndexedDB blocked'));
    });
  }
  function idbBackend(db) {
    const tx = (mode, fn) => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('transaction aborted'));
    });
    return {
      kind: 'IndexedDB',
      getAll: () => new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly'); const r = t.objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }),
      get: keys => tx('readonly', s => { const out = new Map(); keys.forEach(k => { const r = s.get(k); r.onsuccess = () => { if (r.result) out.set(k, r.result.data); }; }); return out; }),
      run: ops => tx('readwrite', s => {
        const out = new Map();
        for (const [op, k, v] of ops) {
          if (op === 'put') s.put({ path: k, data: v });
          else if (op === 'del') s.delete(k);
          else { const r = s.get(k); r.onsuccess = () => { const next = v(r.result ? r.result.data : undefined); out.set(k, next); if (next === undefined) s.delete(k); else s.put({ path: k, data: next }); }; }
        }
        return out;
      }),
      close: () => db.close()
    };
  }
  const lsKeys = prefix => { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) ks.push(k); } return ks; };
  const lsGet = k => { const v = localStorage.getItem(LS + k); if (v == null) return undefined; try { return JSON.parse(v); } catch (e) { return undefined; } };
  const lsBackend = {
    kind: 'localStorage',
    getAll: async () => lsKeys(LS).map(k => { try { return { path: k.slice(LS.length), data: JSON.parse(localStorage.getItem(k)) }; } catch (e) { return null; } }).filter(r => r && !PREFS.includes(r.path)),
    get: async keys => new Map(keys.map(k => [k, lsGet(k)]).filter(([, v]) => v !== undefined)),
    run: async ops => {
      const out = new Map();
      for (const [op, k, v] of ops) {
        if (op === 'put') localStorage.setItem(LS + k, JSON.stringify(v));
        else if (op === 'del') localStorage.removeItem(LS + k);
        else { const next = v(lsGet(k)); out.set(k, next); if (next === undefined) localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, JSON.stringify(next)); }
      }
      return out;
    }
  };
  /* nothing persists; merges read the in-memory copy */
  const memBackend = {
    kind: 'memory', getAll: async () => [],
    get: async keys => new Map(keys.filter(k => mem.has(k)).map(k => [k, clone(mem.get(k))])),
    run: async ops => new Map(ops.filter(o => o[0] === 'merge').map(([, k, fn]) => [k, fn(clone(mem.get(k)))]))
  };
  const write = (puts, dels) => backend.run([...(dels || []).map(k => ['del', k]), ...(puts || []).map(([k, d]) => ['put', k, d])]);

  /* Data kept under an earlier name (IndexedDB, else name: keys in localStorage) is copied over once, while the tally store
     is empty. The newest name with data wins. The old copy is removed only after the new store has been written. */
  async function migrateOld() {
    for (const name of OLD_NAMES) {
      let rows = [];
      try { const old = idbBackend(await openIDB(name)); rows = await old.getAll(); old.close(); } catch (e) {}
      if (rows.length) return { rows, cleanup: () => { try { indexedDB.deleteDatabase(name); } catch (e) {} } };
      try { indexedDB.deleteDatabase(name); } catch (e) {} /* opening created an empty one */
      const prefix = name + ':';
      try {
        const keys = lsKeys(prefix).filter(k => !PREFS.includes(k.slice(prefix.length)));
        rows = keys.map(k => { try { return { path: k.slice(prefix.length), data: JSON.parse(localStorage.getItem(k)) }; } catch (e) { return null; } }).filter(Boolean);
        if (rows.length) return { rows, cleanup: () => keys.forEach(k => localStorage.removeItem(k)) };
      } catch (e) {}
    }
    return null;
  }
  function migratePrefs() {
    try { for (const k of PREFS) if (localStorage.getItem(LS + k) == null) for (const name of OLD_NAMES) { const v = localStorage.getItem(name + ':' + k); if (v != null) { localStorage.setItem(LS + k, v); break; } } } catch (e) {}
  }
  async function init() {
    try { backend = idbBackend(await openIDB(DB_NAME)); }
    catch (e) { try { localStorage.setItem(LS + '__probe', '1'); localStorage.removeItem(LS + '__probe'); backend = lsBackend; } catch (e2) { backend = memBackend; } }
    kind = backend.kind;
    let rows = await backend.getAll().catch(() => []);
    if (!rows.length && backend !== memBackend) {
      const old = await migrateOld();
      if (old) { rows = old.rows; await write(rows.map(r => [r.path, r.data]), []).then(old.cleanup, () => {}); }
    }
    mem = new Map(rows.filter(r => r && typeof r.path === 'string').map(r => [r.path, r.data]));
    /* un-namespaced 1.x paths move into the default profile */
    const legacy = [...mem.keys()].filter(k => !k.startsWith('p/') && !k.startsWith('m/'));
    if (legacy.length) {
      const puts = legacy.map(k => ['p/default/' + k, mem.get(k)]);
      legacy.forEach(k => mem.delete(k)); puts.forEach(([k, v]) => mem.set(k, v));
      await write(puts, legacy).catch(() => {});
    }
    let profs = mem.get('m/profiles');
    if (!profs || !Array.isArray(profs.list) || !profs.list.length) { profs = { list: [{ id: 'default', name: '', createdAt: new Date().toISOString() }] }; mem.set('m/profiles', profs); await write([['m/profiles', profs]], []).catch(() => {}); }
    const cur = mem.get('m/current');
    pid = (cur && profs.list.some(p => p.id === cur.id)) ? cur.id : profs.list[0].id;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    if (backend !== memBackend && typeof BroadcastChannel === 'function') { try { channel = new BroadcastChannel('tally'); channel.onmessage = onMessage; } catch (e) { channel = null; } }
    return kind;
  }
  const onError = e => { console.warn('storage write failed', e); if (typeof api.onerror === 'function') api.onerror(e); };
  const setMem = (k, v) => { if (v === undefined) mem.delete(k); else mem.set(k, v); };

  /* Every write goes through commit: one transaction, then the other tabs hear which keys changed. A merge result
     replaces the in-memory copy only when no later write to that key is still in flight. */
  function commit(ops) {
    const keys = [...new Set(ops.map(o => o[1]))];
    keys.forEach(k => inflight.set(k, (inflight.get(k) || 0) + 1));
    const done = () => keys.forEach(k => { const n = inflight.get(k) - 1; if (n > 0) inflight.set(k, n); else inflight.delete(k); });
    return backend.run(ops).then(out => {
      for (const [k, v] of out) if (inflight.get(k) === 1) setMem(k, v === undefined ? undefined : clone(v));
      done();
      if (channel) { try { channel.postMessage({ keys }); } catch (e) {} }
      return out;
    }, e => { done(); throw e; });
  }
  /* another tab wrote these keys: reload them, unless this tab has its own write to them in flight (it lands later) */
  async function onMessage(e) {
    const keys = ((e && e.data && e.data.keys) || []).filter(k => typeof k === 'string');
    if (!keys.length) return;
    let got; try { got = await backend.get(keys); } catch (err) { return; }
    const prefix = `p/${pid}/`, docs = [], meta = [];
    for (const k of keys) {
      if (inflight.has(k)) continue;
      setMem(k, got.get(k));
      if (k.startsWith(prefix)) docs.push(k.slice(prefix.length)); else if (k.startsWith('m/')) meta.push(k.slice(2));
    }
    let profileGone = false;
    if (meta.includes('profiles') && !profiles().some(p => p.id === pid) && profiles().length) { pid = profiles()[0].id; profileGone = true; }
    if (docs.length) notify(docs);
    if ((docs.length || meta.length) && typeof api.onexternal === 'function') api.onexternal({ docs, meta, profileGone });
  }

  const writeMeta = (key, val) => { mem.set('m/' + key, clone(val)); return commit([['put', 'm/' + key, clone(val)]]).catch(onError); };
  const getMeta = key => mem.has('m/' + key) ? clone(mem.get('m/' + key)) : null;

  /* profiles */
  const profiles = () => { const m = mem.get('m/profiles'); return m && Array.isArray(m.list) ? clone(m.list) : []; };
  const currentProfile = () => profiles().find(p => p.id === pid) || { id: pid, name: '' };
  function setProfile(id) { if (!profiles().some(p => p.id === id)) return false; pid = id; writeMeta('current', { id }); return true; }
  function addProfile(name) { const list = profiles(); const id = MB.ui.uid(); list.push({ id, name: String(name || '').trim(), createdAt: new Date().toISOString() }); writeMeta('profiles', { list }); return id; }
  function renameProfile(id, name) { const list = profiles(); const p = list.find(x => x.id === id); if (p) { p.name = String(name || '').trim(); writeMeta('profiles', { list }); } }
  /* deleting a profile unlinks it; the cloud copy stays */
  async function deleteProfile(id) {
    const list = profiles(); if (list.length < 2 || !list.some(p => p.id === id)) return false;
    const prefix = `p/${id}/`, bases = baseKey(id, ''); const dels = [syncKey(id), ...[...mem.keys()].filter(k => k.startsWith(prefix) || k.startsWith(bases))];
    dels.forEach(k => mem.delete(k));
    await commit(dels.map(k => ['del', k])).catch(onError);
    await writeMeta('profiles', { list: list.filter(p => p.id !== id) });
    if (pid === id) setProfile(list.find(p => p.id !== id).id);
    return true;
  }

  /* timestamps: ISO, strictly increasing within a tab so two quick edits never tie */
  let lastStamp = 0;
  function stamp() { lastStamp = Math.max(Date.now(), lastStamp + 1); return new Date(lastStamp).toISOString(); }
  const stamped = d => { const c = clone(d); if (isDoc(c) && !c.updatedAt) c.updatedAt = stamp(); return c; };

  /* outbox entries for the active profile, when it is linked; applied to memory now and merged in the same transaction */
  function outbox(entries) {
    const k = syncKey(pid), cur = mem.get(k);
    if (!cur || !cur.key || !entries.length) return [];
    const fn = m => { if (!m || !m.key) return m; const next = { ...m, outbox: { ...(m.outbox || {}) } }; for (const [p, e] of entries) next.outbox[p] = e; return next; };
    mem.set(k, fn(clone(cur)));
    return [['merge', k, fn]];
  }
  const local = paths => { const m = mem.get(syncKey(pid)); if (m && m.key && typeof api.onlocal === 'function') api.onlocal(paths); };
  /* the last synced copy of a day or the setup, kept from its first edit until the edit is uploaded (call before writing) */
  function baseOps(paths) {
    const m = mem.get(syncKey(pid)); if (!m || !m.key) return [];
    const ops = [];
    for (const p of paths) {
      if (!mergeable(p) || (m.outbox && m.outbox[p])) continue;
      const prev = mem.get(full(p)), k = baseKey(pid, p);
      if (prev === undefined) { if (mem.has(k)) { mem.delete(k); ops.push(['del', k]); } continue; }
      mem.set(k, clone(prev)); ops.push(['put', k, clone(prev)]);
    }
    return ops;
  }

  /* documents in the active profile */
  function get(path) { const k = full(path); return mem.has(k) ? clone(mem.get(k)) : null; }
  function list(coll) { const prefix = full(coll) + '/'; const out = []; for (const [p, d] of mem) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.push({ id: p.slice(prefix.length), ...clone(d) }); return out; }
  const cmp = (a, op, b) => { switch (op) { case '==': return a === b; case '!=': return a !== b; case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; default: return true; } };
  function query(coll, filters, order, limit) {
    const rows = list(coll).filter(r => (filters || []).every(([f, o, v]) => cmp(r[f], o, v)));
    if (order) { const [f, dir] = order; rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
    else rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    return rows.slice(0, limit || 100000);
  }
  function notify(paths) {
    const colls = new Set();
    paths.forEach(p => { (docL[p] || []).forEach(cb => cb(get(p))); colls.add(collOf(p)); });
    colls.forEach(c => (collL[c] || []).forEach(cb => cb(list(c))));
  }
  function setDoc(path, data) {
    const bops = baseOps([path]), d = stamped(data); mem.set(full(path), d);
    const pr = commit([['put', full(path), clone(d)], ...bops, ...outbox([[path, { deleted: false, updatedAt: d.updatedAt || null }]])]).catch(onError);
    notify([path]); local([path]);
    return pr;
  }
  function deleteDoc(path) {
    mem.delete(full(path));
    const pr = commit([['del', full(path)], ...outbox([[path, { deleted: true, updatedAt: stamp() }]])]).catch(onError);
    notify([path]); local([path]);
    return pr;
  }
  function bulk(ops) {
    const ups = (ops.upserts || []).map(([p, d]) => [p, stamped(d)]), dels = ops.deletes || [], at = stamp(), bops = baseOps(ups.map(x => x[0]));
    dels.forEach(p => mem.delete(full(p))); ups.forEach(([p, d]) => mem.set(full(p), d));
    const entries = [...dels.map(p => [p, { deleted: true, updatedAt: at }]), ...ups.map(([p, d]) => [p, { deleted: false, updatedAt: d.updatedAt || null }])];
    const pr = commit([...dels.map(p => ['del', full(p)]), ...ups.map(([p, d]) => ['put', full(p), clone(d)]), ...bops, ...outbox(entries)]).catch(onError);
    const paths = [...dels, ...ups.map(x => x[0])];
    notify(paths); local(paths);
    return pr;
  }
  function subscribeDoc(path, cb) { (docL[path] = docL[path] || []).push(cb); cb(get(path)); return () => { docL[path] = (docL[path] || []).filter(x => x !== cb); }; }
  function subscribeColl(coll, cb) { (collL[coll] = collL[coll] || []).push(cb); cb(list(coll)); return () => { collL[coll] = (collL[coll] || []).filter(x => x !== cb); }; }
  function refresh() { Object.keys(docL).forEach(p => docL[p].forEach(cb => cb(get(p)))); Object.keys(collL).forEach(c => collL[c].forEach(cb => cb(list(c)))); }
  /* erasing unlinks first and never uploads deletions: the cloud copy stays */
  async function eraseProfile() {
    const prefix = full(''), bases = baseKey(pid, ''); const dels = [syncKey(pid), ...[...mem.keys()].filter(k => k.startsWith(prefix) || k.startsWith(bases))];
    dels.forEach(k => mem.delete(k));
    await commit(dels.map(k => ['del', k])).catch(onError);
    refresh();
  }
  const count = () => { const prefix = full(''); let n = 0; for (const k of mem.keys()) if (k.startsWith(prefix)) n++; return n; };

  /* ---------- sync bookkeeping (used by sync.js) ---------- */
  const syncMeta = (id = pid) => { const m = mem.get(syncKey(id)); return m ? clone(m) : null; };
  /* the stored copy, which another tab may have changed */
  async function syncRead(id = pid) {
    const k = syncKey(id), got = await backend.get([k]);
    if (!inflight.has(k)) setMem(k, got.get(k));
    return syncMeta(id);
  }
  async function syncUpdate(id, fn) {
    const k = syncKey(id), f = m => fn(m === undefined ? undefined : clone(m));
    setMem(k, f(clone(mem.get(k))));
    await commit([['merge', k, f]]);
    return syncMeta(id);
  }
  /* first link: every local document goes into the outbox; the server keeps the newer copy of each */
  async function syncLink(id, key) {
    const prefix = `p/${id}/`, out = {};
    for (const [k, d] of mem) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = { deleted: false, updatedAt: (d && d.updatedAt) || null };
    const meta = { key, cursor: 0, outbox: out, lastSync: null, lastError: null };
    mem.set(syncKey(id), clone(meta));
    await commit([['put', syncKey(id), meta]]);
  }
  async function syncUnlink(id = pid) { const dels = [syncKey(id), ...[...mem.keys()].filter(k => k.startsWith(baseKey(id, '')))]; dels.forEach(k => mem.delete(k)); await commit(dels.map(k => ['del', k])); }
  /* uploaded: those edits are the server's copy now, so their bases go */
  async function dropBases(id, paths) {
    const ks = paths.map(p => baseKey(id, p)).filter(k => mem.has(k)); if (!ks.length) return;
    ks.forEach(k => mem.delete(k)); await commit(ks.map(k => ['del', k])).catch(onError);
  }
  /* current bodies, read from storage so a write from another tab is never missed */
  async function readDocs(id, paths) {
    const prefix = `p/${id}/`, got = await backend.get(paths.map(p => prefix + p)), out = new Map();
    for (const p of paths) if (got.has(prefix + p)) out.set(p, got.get(prefix + p));
    return out;
  }
  /* Pulled changes, written without touching the outbox. A change applies when it is newer than the local document (or
     there is none). When the document also has a local edit waiting to upload, both edits are kept: a day or the setup is
     merged against its base (entry by entry) and queued again; any other document keeps the newer copy, and a newer local
     one is queued again. Tombstones delete unless a newer local edit waits. Returns changed paths. */
  async function applyRemote(changes, id = pid, sent) {
    const meta = await syncRead(id), waiting = (meta && meta.outbox) || {}, changed = new Set(), ops = [], requeue = {};
    /* this device's own upload coming back (edited again since): not a conflict, but the new base */
    const mine = c => !!sent && sent.has(c.path) && ms(sent.get(c.path)) === c.updatedAt;
    const valid = c => c && typeof c.path === 'string' && typeof c.updatedAt === 'number' && (c.deleted || isDoc(c.doc));
    const both = (changes || []).filter(c => valid(c) && !c.deleted && waiting[c.path] && !waiting[c.path].deleted && ms(waiting[c.path].updatedAt) !== c.updatedAt && !mine(c));
    const bases = both.some(c => mergeable(c.path)) ? await backend.get(both.filter(c => mergeable(c.path)).map(c => baseKey(id, c.path))) : new Map();
    for (const c of changes || []) {
      if (!valid(c)) continue;
      const w = waiting[c.path], remote = c.deleted ? null : { ...c.doc, updatedAt: new Date(c.updatedAt).toISOString() };
      if (both.includes(c)) {
        const at = stamp(), k = `p/${id}/${c.path}`;
        if (mergeable(c.path)) {
          const base = bases.has(baseKey(id, c.path)) ? bases.get(baseKey(id, c.path)) : null;
          ops.push(['merge', k, cur => { changed.add(c.path); return cur === undefined ? remote : { ...MB.schema.mergeDoc(c.path, base, cur, remote), updatedAt: at }; }], ['put', baseKey(id, c.path), remote]);
          requeue[c.path] = at;
        } else if (ms(w.updatedAt) > c.updatedAt) {
          ops.push(['merge', k, cur => cur === undefined ? cur : { ...cur, updatedAt: at }]); requeue[c.path] = at;
        } else ops.push(['merge', k, () => { changed.add(c.path); return remote; }]);
        continue;
      }
      if (mine(c) && w && ms(w.updatedAt) !== c.updatedAt && mergeable(c.path)) { ops.push(['put', baseKey(id, c.path), remote]); mem.set(baseKey(id, c.path), clone(remote)); continue; }
      if (w && ms(w.updatedAt) >= c.updatedAt) continue;
      ops.push(['merge', `p/${id}/${c.path}`, cur => {
        if (cur !== undefined && ms(cur.updatedAt) >= c.updatedAt) return cur;
        if (c.deleted) { if (cur !== undefined) changed.add(c.path); return undefined; }
        changed.add(c.path);
        return { ...c.doc, updatedAt: new Date(c.updatedAt).toISOString() };
      }]);
    }
    if (!ops.length) return [];
    const again = Object.entries(requeue);
    if (again.length) ops.push(['merge', syncKey(id), m => { if (!m || !m.key) return m; const next = { ...m, outbox: { ...(m.outbox || {}) } }; for (const [p, at] of again) next.outbox[p] = { deleted: false, updatedAt: at }; return next; }]);
    await commit(ops);
    for (const [p] of again) { const k = baseKey(id, p), b = both.find(c => c.path === p); if (b && mergeable(p)) mem.set(k, { ...b.doc, updatedAt: new Date(b.updatedAt).toISOString() }); }
    const paths = [...changed];
    if (id === pid && paths.length) notify(paths);
    return paths;
  }

  const api = { init, kind: () => kind, get, list, query, setDoc, deleteDoc, bulk, subscribeDoc, subscribeColl, refresh, eraseProfile, count, getMeta, setMeta: writeMeta,
    profiles, currentProfile, setProfile, addProfile, renameProfile, deleteProfile, stamp,
    syncMeta, syncRead, syncUpdate, syncLink, syncUnlink, readDocs, applyRemote, dropBases,
    onerror: null, onlocal: null, onexternal: null };
  migratePrefs(); /* runs before boot reads the theme and language */
  MB.store = api;
})();
