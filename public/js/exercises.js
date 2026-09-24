/* Tally — the built-in exercise library (MB.exlib, from exlib.js) and how a profile's own exercises sit on it.
   A profile exercise links to a library entry by `base`, else by the same id, else by its name or an alias; `base: 'none'`
   keeps it on its own. What the profile says wins (name, unit, per side, muscles and steps if it has them); the library
   fills in the rest. Also draws the front and back muscle map. */
window.MB = window.MB || {};
(() => {
  'use strict';
  const CATS = ['strength', 'core', 'power', 'conditioning', 'mobility', 'stretch', 'prehab', 'drill'];
  const PATTERNS = ['squat', 'hinge', 'lunge', 'hpush', 'vpush', 'hpull', 'vpull', 'carry', 'brace', 'flex', 'rotate', 'jump', 'throw', 'sprint', 'crawl', 'cardio', 'iso', 'mobility', 'stretch', 'skill'];
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  let byId = null, byName = null;
  function index() {
    if (byId) return;
    byId = new Map(); byName = new Map();
    for (const e of (MB.exlib || [])) {
      byId.set(e.id, e);
      e._q = norm([e.name, ...(e.aka || [])].join(' '));
      for (const n of [e.name, ...(e.aka || [])]) { const k = norm(n); if (k && !byName.has(k)) byName.set(k, e.id); }
    }
  }
  const list = () => { index(); return MB.exlib || []; };
  const get = id => { index(); return (id && byId.get(id)) || null; };
  const match = name => { index(); const id = byName.get(norm(name)); return id ? byId.get(id) : null; };
  /* the library entry a profile exercise stands on */
  function libFor(ex) {
    if (!ex) return null;
    if (ex.base === 'none') return null;
    return get(ex.base) || get(ex.id) || match(ex.name);
  }
  /* The page for an exercise: a profile exercise (own), a library entry (lib), or both. */
  function view(own, lib) {
    lib = lib || libFor(own);
    const o = own || {}, l = lib || {};
    const pick = (a, b) => (Array.isArray(a) && a.length ? a : (b || []));
    return {
      id: own ? own.id : l.id, name: own ? own.name : l.name, own: own || null, lib: lib || null,
      unit: own ? own.unit : l.unit || 'reps', side: own ? !!own.perSide : !!l.side,
      cat: l.cat || '', pat: l.pat || '', lvl: l.lvl || 0, eq: pick(o.eq, l.eq),
      pm: pick(o.pm, l.pm), sm: o.pm && o.pm.length ? (o.sm || []) : (l.sm || []),
      about: l.about || '', steps: pick(o.steps, l.steps), cues: l.cues || [], errs: l.errs || [], safe: l.safe || '', dose: l.dose || null,
      easier: l.easier || [], harder: l.harder || [], alt: l.alt || [],
      notes: o.cues || '', video: o.video || '', image: o.image || '', gate: o.gate || null, group: o.category || ''
    };
  }
  /* words that match: every word of the query somewhere in the name or an alias (or in extra text, like muscle names) */
  function hits(q, e, extra) { const words = norm(q).split(' ').filter(Boolean); if (!words.length) return true; const hay = (e._q || norm([e.name, ...(e.aka || [])].join(' '))) + ' ' + norm(extra || ''); return words.every(w => hay.includes(w)); }

  /* ---------- the muscle map ---------- */
  /* Two figures, front and back, 100 x 200 each. [muscle, shape, single]: a shape is an SVG path, or [cx, cy, rx, ry] for
     an ellipse; `single` shapes sit on the middle line, the rest are drawn on the left and mirrored. Head, hands, knees
     and feet are plain. */
  const B = null;
  const FRONT = [
    [B, [50, 13.5, 8.5, 10.5], 1],
    ['neck', 'M45 23L55 23L56.5 32L43.5 32Z', 1],
    ['traps', 'M43.5 30C40 32.5 36 34.5 31 35.5L37 38L44 36Z'],
    ['shoulders', 'M31 35.5C24.5 36 20.5 41 20 48C20 51 21.5 53.5 23.5 54C25 48.5 28.5 42.5 36.5 38.5Z'],
    ['chest', 'M49.5 38L37 38.5C33 41 31.5 46 32.5 51.5C34.5 56.5 41 58.5 49.5 57Z'],
    ['biceps', 'M23.5 54C21 58 20 65 21 71C22.5 74 25.5 74 27 71C28.5 65 28.5 58 27.5 52.5Z'],
    ['forearms', 'M21 76C18.5 82 17 92 17.5 100L21.5 101C23.5 93 25.5 84 26.5 77Z'],
    [B, [19.5, 106, 3.8, 5.5]],
    ['obliques', 'M34.5 58C33.5 68 34 80 37 91C38.5 95 40.5 97 42 98L42 60C39.5 59 37 58.5 34.5 58Z'],
    ['abs', 'M48.5 58.5L51.5 58.5C55 58.5 57.5 61 57.5 64.5L57.5 92.5C57.5 96 55 98.5 51.5 98.5L48.5 98.5C45 98.5 42.5 96 42.5 92.5L42.5 64.5C42.5 61 45 58.5 48.5 58.5Z', 1],
    ['hip-flexors', 'M37.5 93C40 99 44 103 48.5 106L48 99.5C45 98.5 42 96.5 39.5 92Z'],
    ['quads', 'M36.5 96C33.5 106 33 122 34.5 137C35.5 146 38 152 42 152.5C44.5 152 45.3 148 45.5 143C45.6 131 45.6 118 45 105C42.5 103 39.5 100.5 36.5 96Z'],
    ['adductors', 'M45 105C47 107.5 49.2 109.5 49.8 110.5L49.6 126C49 133 47.6 139 45.6 143C45.8 131 45.7 118 45 105Z'],
    [B, [41.5, 156.5, 5, 3.8]],
    ['shins', 'M38 161C36.5 168 37 178 39 187L42 187.5C43 179 43.8 170 43.5 161Z'],
    ['calves', 'M43.5 161C46 166 46.5 174 45 182L42.5 187C43.5 179 44.2 170 43.5 161Z'],
    [B, [40.5, 193, 5.5, 3]]
  ];
  const BACK = [
    [B, [50, 13.5, 8.5, 10.5], 1],
    ['neck', 'M45 23L55 23L56 29L44 29Z', 1],
    ['traps', 'M44 27L56 27L68 36.5L57 40L50 52L43 40L32 36.5Z', 1],
    ['rear-delts', 'M31 35.5C24.5 36 20.5 41 20 48C20 51 21.5 53.5 23.5 54C25 48.5 28.5 42.5 36.5 38.5Z'],
    ['rotator-cuff', [38, 46.5, 5, 4.5]],
    ['upper-back', 'M43.5 41C45 46 47.5 50 50 52.5L50 63C46.5 61.5 43 58 41.5 53.5C41 49 41.8 44.5 43.5 41Z'],
    ['lats', 'M33.5 51C33 61 35 74 40.5 86L50 88L50 64C45 62 41 58 38.5 53C37 52 35 51.5 33.5 51Z'],
    ['triceps', 'M23.5 54C21 58 20 65 21 71C22.5 74 25.5 74 27 71C28.5 65 28.5 58 27.5 52.5Z'],
    ['forearms', 'M21 76C18.5 82 17 92 17.5 100L21.5 101C23.5 93 25.5 84 26.5 77Z'],
    [B, [19.5, 106, 3.8, 5.5]],
    ['lower-back', 'M42 86.5L58 86.5C58.6 92 58 97 57 100.5L43 100.5C42 97 41.4 92 42 86.5Z', 1],
    ['obliques', 'M33.8 60C33.6 70 35.2 80 38.8 88.5L41.5 87C37.5 79 35.5 70 35.2 61Z'],
    ['abductors', 'M35.5 94C34 99 34.2 104.5 36 108.5L42 101C40 99 37.5 96.5 35.5 94Z'],
    ['glutes', 'M36 108.5C35.5 116 38.5 122.5 45 124C47.5 124.4 49.3 123.5 49.6 122L49.6 101.5C46 100.8 43.5 100.8 42 101Z'],
    ['hamstrings', 'M36.2 124C35 134 35.5 145 38.5 152.5C40.5 155 44.5 155 45.8 152C46.8 144 47.3 134 47.4 125.8C44 126 39.5 125.5 36.2 124Z'],
    ['adductors', 'M47.4 125.8L49.7 124.5L49.5 134C48.9 139.5 47.8 143 46.3 146C46.9 139 47.3 132 47.4 125.8Z'],
    [B, [41.5, 157.5, 5, 3]],
    ['calves', 'M37.5 160C35 166 35.5 175 38.5 182L44 182.5C46.5 175 46.5 166 44.5 160C42 159 39.5 159 37.5 160Z'],
    [B, 'M38.5 182L44 182.5L43 190L40 190Z'],
    [B, [40.5, 193, 5.5, 3]]
  ];
  const shape = (s, a) => Array.isArray(s) ? `<ellipse ${a} cx="${s[0]}" cy="${s[1]}" rx="${s[2]}" ry="${s[3]}"/>` : `<path ${a} d="${s}"/>`;
  function figure(parts, pm, sm) {
    const attrs = m => m == null ? 'class="b"' : `class="m${pm.includes(m) ? ' p' : sm.includes(m) ? ' s' : ''}" data-m="${m}"`;
    const side = parts.filter(p => !p[2]).map(p => shape(p[1], attrs(p[0]))).join('');
    return parts.filter(p => p[2]).map(p => shape(p[1], attrs(p[0]))).join('') + side + `<g transform="translate(100 0) scale(-1 1)">${side}</g>`;
  }
  /* front and back side by side; label names the muscles for screen readers */
  function mapSVG(pm, sm, label) {
    pm = pm || []; sm = sm || [];
    return `<svg class="mm" viewBox="0 0 212 202" role="img" aria-label="${String(label || '').replace(/"/g, '&quot;')}">` +
      `<g transform="translate(3 2)">${figure(FRONT, pm, sm)}</g><g transform="translate(109 2)">${figure(BACK, pm, sm)}</g>` +
      `<path class="ln" d="M46 70H60M46 80H60M46 90H60M53 61V100"/></svg>`;
  }

  MB.exercises = { CATS, PATTERNS, norm, list, get, match, libFor, view, hits, mapSVG, reset: () => { byId = null; byName = null; } };
})();
