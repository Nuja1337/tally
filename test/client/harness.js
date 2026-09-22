// Boots the real app from public/ inside jsdom. One openTab() call is one browser tab; tabs that share an `idb`
// (a fake-indexeddb IDBFactory) are the same device. Scripts run in index.html order, exactly as the browser loads them.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

export const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const HTML = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
export const SCRIPTS = [...HTML.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
const SOURCES = SCRIPTS.map(file => new vm.Script(readFileSync(join(PUBLIC, file), 'utf8'), { filename: 'public/' + file }));

/* Web Locks for the tabs of one device: exclusive, with ifAvailable */
function lockManager() {
  const tails = new Map();
  return {
    request(name, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (opts.ifAvailable && tails.has(name)) return Promise.resolve().then(() => cb(null));
      const prev = tails.get(name) || Promise.resolve();
      let release; const mine = new Promise(r => { release = r; });
      const tail = prev.then(() => mine); tails.set(name, tail);
      return prev.then(async () => { try { return await cb({ name, mode: 'exclusive' }); } finally { release(); if (tails.get(name) === tail) tails.delete(name); } });
    }
  };
}

/* A device: its own IndexedDB, network switch, locks and tab-to-tab channel. `intercept(url, init)` may return a Response. */
let deviceCount = 0;
export function newDevice() {
  const device = { id: 'dev' + (++deviceCount), idb: new IDBFactory(), online: true, locks: lockManager(), tabs: new Set(), requests: [], active: 0, maxActive: 0, intercept: null, downloads: [], clipboard: '' };
  device.setOnline = on => { device.online = on; for (const tab of device.tabs) tab.window.dispatchEvent(new tab.window.Event(on ? 'online' : 'offline')); };
  return device;
}

export async function waitFor(cond, { timeout = 5000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    let v; try { v = await cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise(r => setTimeout(r, 10));
  }
}

/* opts: device (from newDevice), origin, hash, localStorage (seed), fetch (window.fetch), setup(window) before scripts run */
export async function openTab(opts = {}) {
  const device = opts.device || newDevice();
  const errors = [], warnings = [];
  const vc = new VirtualConsole();
  vc.on('error', (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' ')));
  vc.on('jsdomError', e => errors.push('jsdom: ' + (e.stack || e.message)));
  vc.on('warn', (...a) => warnings.push(a.map(String).join(' ')));
  const origin = opts.origin || 'http://localhost:8787';
  const dom = new JSDOM(HTML.replace(/<script src=[^>]+><\/script>\s*/g, ''), { url: origin + '/' + (opts.hash || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.indexedDB = device.idb; w.IDBKeyRange = IDBKeyRange;
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {}; /* not implemented in jsdom */
  for (const [k, v] of Object.entries(opts.localStorage || {})) w.localStorage.setItem(k, v);
  /* browser pieces jsdom lacks, scoped to this device */
  const nav = (k, v) => Object.defineProperty(w.navigator, k, { configurable: true, ...(typeof v === 'function' ? { get: v } : { value: v }) });
  nav('onLine', () => device.online);
  nav('locks', device.locks);
  nav('clipboard', { writeText: async s => { device.clipboard = String(s); }, readText: async () => device.clipboard });
  const channels = [];
  w.BroadcastChannel = class extends BroadcastChannel { constructor(name) { super(device.id + '/' + name); channels.push(this); } };
  const blobs = new Map(); let blobN = 0;
  w.URL.createObjectURL = blob => { const u = 'blob:' + origin + '/' + (++blobN); blobs.set(u, blob); return u; };
  w.URL.revokeObjectURL = () => {};
  const click = w.HTMLElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) device.downloads.push({ name: this.download, blob: blobs.get(this.getAttribute('href')) }); else click.call(this); };
  w.fetch = opts.fetch || (async (input, init = {}) => {
    const url = new URL(String(input), origin + '/').href, method = (init.method || 'GET').toUpperCase();
    device.requests.push({ url, method });
    if (!device.online) throw new w.TypeError('Failed to fetch');
    if (device.intercept) { const r = await device.intercept(url, init); if (r) return r; }
    const ac = new AbortController();
    if (init.signal) { if (init.signal.aborted) ac.abort(); else init.signal.addEventListener('abort', () => ac.abort()); }
    device.active++; device.maxActive = Math.max(device.maxActive, device.active);
    try { return await fetch(url, { method, headers: init.headers, body: init.body, signal: ac.signal }); }
    finally { device.active--; }
  });
  if (opts.setup) opts.setup(w);
  const ctx = dom.getInternalVMContext();
  for (const s of SOURCES) s.runInContext(ctx);
  const tab = {
    dom, window: w, document: w.document, MB: w.MB, errors, warnings, device,
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    text: sel => { const el = w.document.querySelector(sel); return el ? el.textContent : null; },
    /* the button (or link) whose text is exactly `label`, inside `within` (a selector) */
    button: (label, within) => [...w.document.querySelectorAll((within ? within + ' ' : '') + 'button, ' + (within ? within + ' ' : '') + 'a.btn')].find(b => b.textContent.trim() === label) || null,
    t: (k, v) => w.MB.i18n.t(k, v),
    go: async hash => {
      const before = w.document.querySelector('#main .page'), changes = w.location.hash !== hash;
      w.location.hash = hash;
      const route = ['workouts', 'routines', 'exercises', 'foods'].includes(hash.slice(1)) ? 'library' : hash.slice(1);
      const there = () => route === 'start' ? w.document.querySelector('#main .page.start') : w.document.querySelector(`.nav a.active[data-route="${route}"]`);
      await waitFor(() => there() && (!changes || w.document.querySelector('#main .page') !== before), { what: 'route ' + hash });
    },
    close: () => { device.tabs.delete(tab); channels.forEach(c => c.close()); try { w.close(); } catch (e) {} }
  };
  device.tabs.add(tab);
  await waitFor(() => w.document.querySelector('#main') && w.document.querySelector('#main').children.length, { what: 'app boot' });
  return tab;
}

/* raw IndexedDB access for seeding and inspecting a device, independent of the app */
function open(idb, name) {
  return new Promise((res, rej) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('docs')) req.result.createObjectStore('docs', { keyPath: 'path' }); };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
export async function seedDB(idb, name, rows) {
  const db = await open(idb, name);
  await new Promise((res, rej) => { const t = db.transaction('docs', 'readwrite'); const s = t.objectStore('docs'); for (const [path, data] of Object.entries(rows)) s.put({ path, data }); t.oncomplete = res; t.onerror = () => rej(t.error); });
  db.close();
}
export async function readDB(idb, name) {
  const db = await open(idb, name);
  const rows = await new Promise((res, rej) => { const r = db.transaction('docs', 'readonly').objectStore('docs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  db.close();
  return Object.fromEntries(rows.map(r => [r.path, r.data]));
}
export async function dbNames(idb) { return (await idb.databases()).map(d => d.name).sort(); }
