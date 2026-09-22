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

export const newDevice = () => ({ idb: new IDBFactory() });

export async function waitFor(cond, { timeout = 3000, what = 'condition' } = {}) {
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
  if (opts.fetch) w.fetch = opts.fetch;
  if (opts.setup) opts.setup(w);
  const ctx = dom.getInternalVMContext();
  for (const s of SOURCES) s.runInContext(ctx);
  const tab = {
    dom, window: w, document: w.document, MB: w.MB, errors, warnings, device,
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    text: sel => { const el = w.document.querySelector(sel); return el ? el.textContent : null; },
    go: async hash => { w.location.hash = hash; await waitFor(() => w.document.querySelector('.nav a.active') || hash === '#start', { what: 'route ' + hash }); await new Promise(r => setTimeout(r, 0)); },
    close: () => { try { w.close(); } catch (e) {} }
  };
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
