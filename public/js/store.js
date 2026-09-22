/* Tally — local-first storage with profiles. Everything lives in memory and is persisted to IndexedDB
   (fallback: localStorage, then memory). Document paths are relative to the active profile:
   settings/main, days/2026-09-01, foods/<id>, templates/<id>. Internally: p/<profileId>/<path>; app metadata: m/<key>. */
window.MB = window.MB || {};
(() => {
  'use strict';
  const { clone, uid } = MB.ui;
  const DB_NAME = 'tally', STORE = 'docs', LS = 'tally:', PREFS = ['theme', 'lang'];
  /* earlier names of this app, newest first: 2.0-2.1 "Mettle", 1.x "Matbook" */
  const OLD_NAMES = ['mettle', 'matbook'];
  let mem = new Map(), backend = null, kind = 'memory', pid = 'default';
  const docL = {}, collL = {};
  const full = p => `p/${pid}/${p}`;
  const collOf = path => path.slice(0, path.lastIndexOf('/'));

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
      const t = db.transaction(STORE, mode); fn(t.objectStore(STORE));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
    return {
      kind: 'IndexedDB',
      getAll: () => new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly'); const r = t.objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }),
      write: (puts, dels) => tx('readwrite', s => { (dels || []).forEach(p => s.delete(p)); (puts || []).forEach(([p, d]) => s.put({ path: p, data: d })); }),
      clear: () => tx('readwrite', s => s.clear()),
      close: () => db.close()
    };
  }
  const lsKeys = prefix => { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) ks.push(k); } return ks; };
  const lsBackend = {
    kind: 'localStorage',
    getAll: async () => lsKeys(LS).map(k => { try { return { path: k.slice(LS.length), data: JSON.parse(localStorage.getItem(k)) }; } catch (e) { return null; } }).filter(r => r && !PREFS.includes(r.path)),
    write: async (puts, dels) => { (dels || []).forEach(p => localStorage.removeItem(LS + p)); (puts || []).forEach(([p, d]) => localStorage.setItem(LS + p, JSON.stringify(d))); },
    clear: async () => lsKeys(LS).filter(k => !PREFS.includes(k.slice(LS.length))).forEach(k => localStorage.removeItem(k))
  };
  const memBackend = { kind: 'memory', getAll: async () => [], write: async () => {}, clear: async () => {} };

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
      if (old) { rows = old.rows; await backend.write(rows.map(r => [r.path, r.data]), []).then(old.cleanup, () => {}); }
    }
    mem = new Map(rows.filter(r => r && typeof r.path === 'string').map(r => [r.path, r.data]));
    /* un-namespaced 1.x paths move into the default profile */
    const legacy = [...mem.keys()].filter(k => !k.startsWith('p/') && !k.startsWith('m/'));
    if (legacy.length) {
      const puts = legacy.map(k => ['p/default/' + k, mem.get(k)]);
      legacy.forEach(k => mem.delete(k)); puts.forEach(([k, v]) => mem.set(k, v));
      await backend.write(puts, legacy).catch(() => {});
    }
    let profs = mem.get('m/profiles');
    if (!profs || !Array.isArray(profs.list) || !profs.list.length) { profs = { list: [{ id: 'default', name: '', createdAt: new Date().toISOString() }] }; mem.set('m/profiles', profs); await backend.write([['m/profiles', profs]], []).catch(() => {}); }
    const cur = mem.get('m/current');
    pid = (cur && profs.list.some(p => p.id === cur.id)) ? cur.id : profs.list[0].id;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
    return kind;
  }
  const onError = e => { console.warn('storage write failed', e); if (typeof api.onerror === 'function') api.onerror(e); };
  const writeMeta = (key, val) => { mem.set('m/' + key, clone(val)); return backend.write([['m/' + key, clone(val)]], []).catch(onError); };
  const getMeta = key => mem.has('m/' + key) ? clone(mem.get('m/' + key)) : null;

  /* profiles */
  const profiles = () => { const m = mem.get('m/profiles'); return m && Array.isArray(m.list) ? clone(m.list) : []; };
  const currentProfile = () => profiles().find(p => p.id === pid) || { id: pid, name: '' };
  function setProfile(id) { if (!profiles().some(p => p.id === id)) return false; pid = id; writeMeta('current', { id }); return true; }
  function addProfile(name) { const list = profiles(); const id = uid(); list.push({ id, name: String(name || '').trim(), createdAt: new Date().toISOString() }); writeMeta('profiles', { list }); return id; }
  function renameProfile(id, name) { const list = profiles(); const p = list.find(x => x.id === id); if (p) { p.name = String(name || '').trim(); writeMeta('profiles', { list }); } }
  async function deleteProfile(id) {
    const list = profiles(); if (list.length < 2 || !list.some(p => p.id === id)) return false;
    const prefix = `p/${id}/`; const dels = [...mem.keys()].filter(k => k.startsWith(prefix));
    dels.forEach(k => mem.delete(k));
    await backend.write([], dels).catch(onError);
    await writeMeta('profiles', { list: list.filter(p => p.id !== id) });
    if (pid === id) setProfile(list.find(p => p.id !== id).id);
    return true;
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
  function setDoc(path, data) { mem.set(full(path), clone(data)); const pr = backend.write([[full(path), clone(data)]], []).catch(onError); notify([path]); return pr; }
  function deleteDoc(path) { mem.delete(full(path)); const pr = backend.write([], [full(path)]).catch(onError); notify([path]); return pr; }
  function bulk(ops) {
    const puts = (ops.upserts || []).map(([p, d]) => [full(p), clone(d)]), dels = (ops.deletes || []).map(full);
    dels.forEach(p => mem.delete(p)); puts.forEach(([p, d]) => mem.set(p, clone(d)));
    const pr = backend.write(puts, dels).catch(onError);
    notify([...(ops.deletes || []), ...(ops.upserts || []).map(x => x[0])]);
    return pr;
  }
  function subscribeDoc(path, cb) { (docL[path] = docL[path] || []).push(cb); cb(get(path)); return () => { docL[path] = (docL[path] || []).filter(x => x !== cb); }; }
  function subscribeColl(coll, cb) { (collL[coll] = collL[coll] || []).push(cb); cb(list(coll)); return () => { collL[coll] = (collL[coll] || []).filter(x => x !== cb); }; }
  function refresh() { Object.keys(docL).forEach(p => docL[p].forEach(cb => cb(get(p)))); Object.keys(collL).forEach(c => collL[c].forEach(cb => cb(list(c)))); }
  async function eraseProfile() {
    const prefix = full('') ; const dels = [...mem.keys()].filter(k => k.startsWith(prefix));
    dels.forEach(k => mem.delete(k));
    await backend.write([], dels).catch(onError);
    refresh();
  }
  const count = () => { const prefix = full(''); let n = 0; for (const k of mem.keys()) if (k.startsWith(prefix)) n++; return n; };
  const api = { init, kind: () => kind, get, list, query, setDoc, deleteDoc, bulk, subscribeDoc, subscribeColl, refresh, eraseProfile, count, getMeta, setMeta: writeMeta,
    profiles, currentProfile, setProfile, addProfile, renameProfile, deleteProfile, onerror: null };
  migratePrefs(); /* runs before boot reads the theme and language */
  MB.store = api;
})();
