// Dictionary parity: every language has exactly the English keys, the same {placeholders} and the same value shapes.
// Also checks that literal t('key') calls in public/js use keys that exist in English. Exit code 1 on any problem.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'js', 'i18n');
const EXPECTED = ['en', 'es', 'fr', 'pt', 'de', 'ja', 'ko', 'zh'];

const dicts = {};
const problems = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const code = file.slice(0, -3);
  const registered = [];
  const MB = { i18n: { add: (c, strings) => { registered.push(c); dicts[c] = Object.assign(dicts[c] || {}, strings); } } };
  try { vm.runInNewContext(readFileSync(join(dir, file), 'utf8'), { MB, window: { MB } }, { filename: file }); }
  catch (e) { problems.push(`${file}: does not load (${e.message})`); continue; }
  if (!registered.length || registered.some(c => c !== code)) problems.push(`${file}: registers ${JSON.stringify([...new Set(registered)])}, expected only "${code}"`);
}
for (const code of EXPECTED) if (!dicts[code]) problems.push(`missing dictionary: ${code}.js`);
for (const code of Object.keys(dicts)) if (!EXPECTED.includes(code)) problems.push(`unexpected dictionary: ${code}`);

const placeholders = v => (Array.isArray(v) ? v : [v]).flatMap(s => String(s).match(/\{\w+\}/g) || []).sort().join(' ');
const shape = v => Array.isArray(v) ? `list of ${v.length}` : typeof v;
const en = dicts.en || {};
for (const code of EXPECTED.filter(c => c !== 'en' && dicts[c])) {
  const d = dicts[code];
  for (const k of Object.keys(en)) {
    if (!(k in d)) { problems.push(`${code}: missing "${k}"`); continue; }
    if (shape(d[k]) !== shape(en[k])) problems.push(`${code}: "${k}" is a ${shape(d[k])}, English has a ${shape(en[k])}`);
    else if (placeholders(d[k]) !== placeholders(en[k])) problems.push(`${code}: "${k}" placeholders [${placeholders(d[k])}] differ from English [${placeholders(en[k])}]`);
    if (typeof d[k] === 'string' && !d[k].trim() && en[k].trim()) problems.push(`${code}: "${k}" is empty`);
  }
  for (const k of Object.keys(d)) if (!(k in en)) problems.push(`${code}: extra key "${k}" not in English`);
}

/* literal t('key') / t("key") / unit('key') calls must resolve in English */
const jsDir = join(root, 'public', 'js');
for (const file of readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
  const src = readFileSync(join(jsDir, file), 'utf8');
  for (const m of src.matchAll(/\b(?:t|unit|u)\(\s*['"]([a-zA-Z][\w-]*\.[\w.-]+)['"]\s*[,)]/g)) if (!(m[1] in en)) problems.push(`${file}: t('${m[1]}') has no English string`);
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):\n  ` + [...new Set(problems)].join('\n  '));
  process.exit(1);
}
console.log(`i18n ok: ${EXPECTED.length} dictionaries, ${Object.keys(en).length} keys each`);
