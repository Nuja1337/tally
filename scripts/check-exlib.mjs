// The built-in exercise library (public/js/exlib.js): every entry complete, from the shared vocabularies, text within
// its limits, ids and names unique, and every easier / harder / swap link pointing at an entry. Exit code 1 on any problem.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, MB: {} }; ctx.window.MB = ctx.MB;
vm.runInNewContext(readFileSync(join(root, 'public/js/exlib.js'), 'utf8'), ctx);
vm.runInNewContext(readFileSync(join(root, 'public/js/exercises.js'), 'utf8'), ctx);
const schemaSrc = readFileSync(join(root, 'public/js/schema.js'), 'utf8');
const listOf = name => JSON.parse(schemaSrc.match(new RegExp(`const ${name} = (\\[[^\\]]+\\])`))[1].replace(/'/g, '"'));
const MUSCLES = listOf('MUSCLES'), EQUIPMENT = listOf('EQUIPMENT'), UNITS = listOf('UNITS');
const { CATS, PATTERNS } = ctx.MB.exercises;
const lib = ctx.MB.exlib;
const KEYS = ['id', 'name', 'aka', 'cat', 'pat', 'eq', 'lvl', 'unit', 'side', 'pm', 'sm', 'about', 'steps', 'cues', 'errs', 'safe', 'dose', 'easier', 'harder', 'alt'];
const problems = [], ids = new Map(), names = new Map();
if (!Array.isArray(lib) || !lib.length) problems.push('MB.exlib is empty');
for (const e of lib || []) {
  const p = msg => problems.push(`${e && e.id}: ${msg}`);
  for (const k of KEYS) if (!(k in e)) p(`missing ${k}`);
  for (const k of Object.keys(e)) if (!KEYS.includes(k)) p(`unknown key ${k}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id)) p('id is not a slug');
  if (ids.has(e.id)) p('id twice'); ids.set(e.id, e);
  for (const n of [e.name, ...(e.aka || [])]) { const k = ctx.MB.exercises.norm(n); if (names.has(k) && names.get(k) !== e.id) p(`name or alias "${n}" also on ${names.get(k)}`); names.set(k, e.id); }
  if (!CATS.includes(e.cat)) p(`cat ${e.cat}`);
  if (!PATTERNS.includes(e.pat)) p(`pat ${e.pat}`);
  if (!UNITS.includes(e.unit)) p(`unit ${e.unit}`);
  if (typeof e.side !== 'boolean') p('side not a boolean');
  if (![1, 2, 3].includes(e.lvl)) p('lvl');
  for (const q of e.eq || []) if (!EQUIPMENT.includes(q)) p(`eq ${q}`);
  if (!(e.pm || []).length) p('no primary muscles');
  for (const m of [...(e.pm || []), ...(e.sm || [])]) if (!MUSCLES.includes(m)) p(`muscle ${m}`);
  const len = (s, max, what) => { if (typeof s !== 'string') p(`${what} not text`); else if (s.length > max) p(`${what} longer than ${max}`); };
  len(e.about, 240, 'about'); len(e.safe, 180, 'safe');
  for (const [k, lo, hi, max] of [['steps', 3, 6, 150], ['cues', 2, 4, 90], ['errs', 2, 4, 120]]) { const a = e[k] || []; if (a.length < lo || a.length > hi) p(`${k} count`); a.forEach((s, i) => len(s, max, `${k}[${i}]`)); }
  if (!e.dose || !Number.isInteger(e.dose.sets) || typeof e.dose.reps !== 'string' || typeof e.dose.rest !== 'string') p('dose');
}
for (const e of lib || []) for (const k of ['easier', 'harder', 'alt']) for (const id of e[k] || []) {
  if (!ids.has(id)) problems.push(`${e.id}: ${k} links to missing ${id}`);
  else if (id === e.id) problems.push(`${e.id}: ${k} links to itself`);
  else if ((k === 'easier' && ids.get(id).easier.includes(e.id)) || (k === 'harder' && ids.get(id).harder.includes(e.id))) problems.push(`${e.id}: ${k} ${id} says the same of it`);
}
if (problems.length) { console.error(`exercise library check failed (${problems.length}):\n  ` + problems.join('\n  ')); process.exit(1); }
console.log(`exercise library ok: ${lib.length} exercises`);
