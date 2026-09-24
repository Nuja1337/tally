/* Tally — DOM helpers, dates, sheets, toasts, form pieces and small charts. Attaches to window.MB.ui */
window.MB = window.MB || {};
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const loc = () => (MB.i18n ? MB.i18n.locale() : undefined);
  const fmt = n => Math.round(+n || 0).toLocaleString(loc());
  const fmt1 = n => (Math.round((+n || 0) * 10) / 10).toLocaleString(loc());
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), loc());
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || uid();

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x; }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'htmlFor') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const svg = markup => { const d = h('div', { class: 'svgwrap', html: markup }); return d; };

  /* dates */
  const pad2 = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  /* the day starts at dayStart minutes past midnight (the profile's setting): before then, today is still yesterday */
  let dayStart = 0;
  const setDayStart = min => { dayStart = Math.max(0, Math.min(360, Math.round(Number(min) || 0))); };
  const dayStartMin = () => dayStart;
  const today = () => dstr(new Date(Date.now() - dayStart * 60000));
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
  const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dow = s => DOW[parseD(s).getDay()];
  const dayName = (key, style) => { const d = new Date(2024, 0, 7 + DOW.indexOf(key)); return d.toLocaleDateString(loc(), { weekday: style || 'short' }); };
  const fmtLong = s => parseD(s).toLocaleDateString(loc(), { weekday: 'long', month: 'long', day: 'numeric' });
  const fmtShort = s => parseD(s).toLocaleDateString(loc(), { month: 'short', day: 'numeric' });
  const fmtDay = s => parseD(s).toLocaleDateString(loc(), { day: 'numeric' });
  const fmtMonth = s => parseD(s).toLocaleDateString(loc(), { month: 'short' });
  const weekStart = s => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); };
  const fmtTime = hhmm => { if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return ''; const [hh, mm] = hhmm.split(':').map(Number); return new Date(2024, 0, 1, hh, mm).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' }); };
  const isImageUrl = u => /\.(gif|png|jpe?g|webp|svg|avif)(\?.*)?$/i.test(String(u || ''));
  /* thumbnail that hides itself when the URL is not an image or fails to load */
  function thumb(url, cls) { if (!url || !isImageUrl(url)) return null; const im = h('img', { class: cls || 'thumb', src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); im.addEventListener('error', () => im.remove()); return im; }

  /* sheet and toast */
  let sheetEl = null;
  function openSheet(title, body, opts) {
    closeSheet();
    const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) closeSheet(); } },
      h('div', { class: 'sheet' + (opts && opts.wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h3', null, title), h('button', { class: 'btn ghost icon', 'aria-label': MB.i18n ? MB.i18n.t('c.close') : 'Close', onclick: closeSheet }, '\u00d7')),
        h('div', { class: 'sheet-body' }, body)));
    document.body.append(ov);
    sheetEl = ov;
    return ov;
  }
  /* onSheetClosed handlers run after a sheet really closes, not when one sheet replaces another */
  const closedHandlers = [];
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; setTimeout(() => { if (!sheetEl) closedHandlers.forEach(fn => fn()); }, 0); } }
  const sheetOpen = () => !!sheetEl;
  const onSheetClosed = fn => { closedHandlers.push(fn); };
  let toastTimer = null;
  function toast(msg, opts = {}) {
    const old = $('.toast'); if (old) old.remove();
    const t = h('div', { class: 'toast', role: 'status' }, h('span', null, msg),
      opts.action ? h('button', { onclick: () => { t.remove(); opts.onAction(); } }, opts.action) : null);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), opts.ms || (opts.sticky ? 12000 : (opts.action ? 6000 : 2400)));
  }
  function confirmSheet(title, text, label, onYes, cancelLabel) {
    openSheet(title, h('div', null, h('p', null, text), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => { closeSheet(); onYes(); } }, label),
      h('button', { class: 'btn', onclick: closeSheet }, cancelLabel || 'Cancel'))));
  }

  /* form pieces */
  function section(title, sub, body, cls) {
    return h('section', { class: 'card' + (cls ? ' ' + cls : '') },
      title == null ? null : h('div', { class: 'card-head' }, h('h2', null, title), sub == null ? null : (typeof sub === 'string' ? h('small', null, sub) : sub)), body);
  }
  function statCard(big, lab, sub) { return h('div', { class: 'stat' }, h('div', { class: 'big' }, big), h('div', { class: 'lab' }, lab), sub ? h('div', { class: 'sub' }, sub) : null); }
  function numField(label, obj, key, onChange, step) {
    return h('label', { class: 'field' }, h('span', null, label),
      h('input', { type: 'number', step: step || 'any', inputmode: 'decimal', value: obj[key] == null ? '' : obj[key],
        oninput: e => { obj[key] = e.target.value === '' ? null : num(e.target.value); onChange && onChange(); } }));
  }
  function textField(label, obj, key, onChange, ph) {
    return h('label', { class: 'field' }, h('span', null, label),
      h('input', { type: 'text', value: obj[key] == null ? '' : obj[key], placeholder: ph || '',
        oninput: e => { obj[key] = e.target.value; onChange && onChange(); } }));
  }
  function selectField(label, obj, key, options, onChange) {
    return h('label', { class: 'field' }, h('span', null, label),
      h('select', { onchange: e => { obj[key] = e.target.value; onChange && onChange(); } },
        options.map(o => h('option', { value: o.value, selected: o.value === obj[key] }, o.label))));
  }
  function segmented(options, value, onChange) {
    const el = h('div', { class: 'seg', role: 'tablist' });
    const draw = () => el.replaceChildren(...options.map(o => h('button', { class: 'seg-btn' + (o.value === value ? ' on' : ''), role: 'tab', 'aria-selected': o.value === value ? 'true' : 'false',
      onclick: () => { if (o.value === value) return; value = o.value; draw(); onChange(value); } }, o.label)));
    draw();
    return el;
  }
  function helpTip(text) {
    const tip = h('span', { class: 'tip', role: 'tooltip' }, text);
    const b = h('button', { class: 'help', type: 'button', 'aria-label': 'Help', onclick: e => { e.stopPropagation(); tip.classList.toggle('show'); } }, '?');
    document.addEventListener('click', () => tip.classList.remove('show'));
    return h('span', { class: 'helpwrap' }, b, tip);
  }
  /* Drag to reorder: rows are the list's children marked data-sort, each with a .drag handle. Pointer drags move the
     row live; arrow keys on the handle move it one place. onMove(from, to) runs once, after the row has moved. */
  const GRIP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  const dragHandle = () => h('button', { class: 'drag', type: 'button', 'aria-label': MB.i18n ? MB.i18n.t('c.reorder') : 'Reorder', title: MB.i18n ? MB.i18n.t('c.reorder') : 'Reorder', html: GRIP });
  function sortable(list, onMove) {
    const rows = () => [...list.children].filter(x => x.hasAttribute('data-sort'));
    const rowOf = el => { const r = el && el.closest('[data-sort]'); return r && r.parentElement === list ? r : null; };
    list.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.drag'), row = handle && rowOf(handle);
      if (!row || (e.button != null && e.button !== 0)) return;
      e.preventDefault();
      const from = rows().indexOf(row);
      row.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      const move = ev => {
        const rs = rows(), i = rs.indexOf(row), prev = rs[i - 1], next = rs[i + 1], y = ev.clientY;
        const mid = el => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
        if (next && y > mid(next)) next.after(row); else if (prev && y < mid(prev)) prev.before(row);
      };
      const end = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
        row.classList.remove('dragging');
        const to = rows().indexOf(row); if (to !== from && to >= 0) onMove(from, to);
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    });
    list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const handle = e.target.closest('.drag'), row = handle && rowOf(handle); if (!row) return;
      const rs = rows(), i = rs.indexOf(row), j = i + (e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault(); if (j < 0 || j >= rs.length) return;
      if (j < i) rs[j].before(row); else rs[j].after(row);
      onMove(i, j);
      const again = [...list.children].filter(x => x.hasAttribute('data-sort'))[j]; const hd = again && again.querySelector('.drag'); if (hd) hd.focus();
    });
    return list;
  }
  const moveItem = (arr, from, to) => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); return arr; };
  /* editable list of {id, ...fields}. fields: [{key,label,type,small,options}]. opts.sortable adds drag handles. */
  function listEditor(arr, fields, onChange, addLabel, extra, opts) {
    opts = opts || {};
    const wrap = h('div', { class: 'editor' }), rows = h('div', { class: 'editor-rows' });
    if (opts.sortable) sortable(rows, (from, to) => { moveItem(arr, from, to); onChange(); draw(); });
    const draw = () => { rows.replaceChildren(...arr.map((item, i) => h('div', { class: 'editor-row', 'data-sort': opts.sortable ? '' : null },
      opts.sortable ? dragHandle() : null,
      fields.map(f => f.type === 'select'
        ? h('select', { class: f.small ? 'sm' : '', 'aria-label': f.label, onchange: e => { item[f.key] = e.target.value; onChange(); } }, f.options().map(o => h('option', { value: o.value, selected: o.value === (item[f.key] || '') }, o.label)))
        : h('input', { type: f.type || 'text', class: f.small ? 'sm' : '', placeholder: f.label, 'aria-label': f.label, value: item[f.key] == null ? '' : item[f.key], inputmode: f.type === 'number' ? 'decimal' : null,
          oninput: e => { item[f.key] = f.type === 'number' ? (e.target.value === '' ? null : num(e.target.value)) : e.target.value; onChange(); } })),
      extra ? extra(item, i, draw) : null,
      h('button', { class: 'btn ghost icon', 'aria-label': MB.i18n ? MB.i18n.t('c.remove') : 'Remove', onclick: () => { arr.splice(i, 1); onChange(); draw(); } }, '\u00d7'))));
    };
    wrap.append(rows, h('div', null, h('button', { class: 'btn small', type: 'button', onclick: () => {
      const it = { id: uid() };
      fields.forEach(f => it[f.key] = f.type === 'number' ? null : (f.type === 'select' ? (f.options()[0] || { value: '' }).value : ''));
      arr.push(it); onChange(); draw();
      const all = rows.querySelectorAll('.editor-row'); const inp = all.length && all[all.length - 1].querySelector('input'); if (inp) inp.focus();
    } }, addLabel)));
    draw();
    wrap.redraw = draw;
    return wrap;
  }

  /* charts: plain SVG strings using theme variables */
  function ring(value, target, opts) {
    opts = opts || {};
    const r = 42, c = 2 * Math.PI * r, pct = target > 0 ? Math.min(1, value / target) : 0, over = target > 0 && value > target * 1.05;
    const color = opts.color || (over ? 'var(--red)' : 'var(--accent)');
    return `<svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${opts.label || ''} ${fmt(value)} / ${fmt(target)}">
  <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--track)" stroke-width="9"/>
  <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
  <text x="50" y="47" text-anchor="middle" font-size="19" font-weight="700" fill="var(--ink)">${fmt(value)}</text>
  <text x="50" y="63" text-anchor="middle" font-size="10" fill="var(--muted)">${target > 0 ? '/ ' + fmt(target) : ''}${opts.unit ? ' ' + opts.unit : ''}</text></svg>`;
  }
  function bars(items, opts) {
    /* items: [{label, value, hit}] */
    opts = opts || {};
    const W = 600, H = opts.height || 150, pt = 14, pb = 24, pl = 4, pr = 4;
    const max = Math.max(opts.target || 0, ...items.map(i => i.value), 1) * 1.08;
    const n = items.length, gap = n > 14 ? 3 : 8, bw = (W - pl - pr - gap * (n - 1)) / n;
    const y = v => pt + (1 - v / max) * (H - pt - pb);
    const rects = items.map((it, i) => {
      const x = pl + i * (bw + gap), top = y(it.value), hgt = Math.max(0, H - pb - top);
      const fill = it.value <= 0 ? 'var(--track)' : (it.color || (it.hit === false ? 'var(--track2)' : 'var(--accent)'));
      const label = (n <= 14 || i % Math.ceil(n / 10) === 0) && it.label ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="var(--muted)">${it.label}</text>` : '';
      return `<rect x="${x.toFixed(1)}" y="${(it.value <= 0 ? H - pb - 3 : top).toFixed(1)}" width="${bw.toFixed(1)}" height="${(it.value <= 0 ? 3 : hgt).toFixed(1)}" rx="${Math.min(5, bw / 2)}" fill="${fill}"/>${label}`;
    }).join('');
    const target = opts.target ? `<line x1="${pl}" x2="${W - pr}" y1="${y(opts.target).toFixed(1)}" y2="${y(opts.target).toFixed(1)}" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 4"/>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label || ''}">${rects}${target}</svg>`;
  }
  /* stacked bars: items [{label, parts: [{value, color}]}] */
  function stacked(items, opts) {
    opts = opts || {};
    const W = 600, H = opts.height || 150, pt = 14, pb = 24, pl = 4, pr = 4;
    const sums = items.map(i => i.parts.reduce((a, p) => a + p.value, 0)), max = Math.max(opts.target || 0, ...sums, 1) * 1.08;
    const n = items.length, gap = n > 14 ? 3 : 8, bw = (W - pl - pr - gap * (n - 1)) / n, y = v => (1 - v / max) * (H - pt - pb);
    const out = items.map((it, i) => {
      const x = pl + i * (bw + gap); let top = H - pb;
      const segs = sums[i] > 0 ? it.parts.filter(p => p.value > 0).map(p => { const hh = (H - pt - pb) - y(p.value); top -= hh; return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${p.color}"/>`; }).join('')
        : `<rect x="${x.toFixed(1)}" y="${H - pb - 3}" width="${bw.toFixed(1)}" height="3" rx="1.5" fill="var(--track)"/>`;
      const label = (n <= 14 || i % Math.ceil(n / 10) === 0) && it.label ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="var(--muted)">${it.label}</text>` : '';
      return `<g>${segs}</g>${label}`;
    }).join('');
    const target = opts.target ? `<line x1="${pl}" x2="${W - pr}" y1="${(pt + y(opts.target)).toFixed(1)}" y2="${(pt + y(opts.target)).toFixed(1)}" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 4"/>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label || ''}">${out}${target}</svg>`;
  }
  function trend(points, opts) {
    /* points: [{date, v}] sorted; draws a light line with dots and a 7-day average */
    opts = opts || {};
    const W = 600, H = 190, pl = 8, pr = 8, pt = 14, pb = 22;
    const vals = points.map(p => p.v);
    const avg = points.map((p, i) => { const win = points.slice(Math.max(0, i - 6), i + 1); return win.reduce((a, q) => a + q.v, 0) / win.length; });
    const extra = [opts.goal, ...(opts.band || [])].filter(v => v != null);
    let lo = Math.min(...vals, ...extra), hi = Math.max(...vals, ...extra);
    const pad = Math.max(1, (hi - lo) * 0.15); lo -= pad; hi += pad;
    const t0 = new Date(points[0].date.replace(/-/g, '/')).getTime(), t1 = new Date(points[points.length - 1].date.replace(/-/g, '/')).getTime();
    const x = d => { const tt = new Date(d.replace(/-/g, '/')).getTime(); return pl + (t1 > t0 ? (tt - t0) / (t1 - t0) : 0.5) * (W - pl - pr); };
    const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    const line = pts => pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const vf = opts.fmt || fmt1;
    const dots = points.map(p => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" fill="var(--accent)" fill-opacity=".55"/>`).join('');
    const avgPath = line(points.map((p, i) => ({ date: p.date, v: avg[i] })));
    const goal = opts.goal == null ? '' : `<line x1="${pl}" x2="${W - pr}" y1="${y(opts.goal).toFixed(1)}" y2="${y(opts.goal).toFixed(1)}" stroke="var(--green)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - pr}" y="${(y(opts.goal) - 5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--green)">${opts.goalLabel || ''}</text>`;
    const band = opts.band ? `<rect x="${pl}" width="${W - pl - pr}" y="${y(opts.band[1]).toFixed(1)}" height="${Math.max(1, y(opts.band[0]) - y(opts.band[1])).toFixed(1)}" fill="var(--green)" fill-opacity=".1"/>` : '';
    const last = points[points.length - 1];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label || ''}">${band}${goal}
  <path d="${line(points)}" fill="none" stroke="var(--accent)" stroke-opacity=".35" stroke-width="1.5" stroke-linejoin="round"/>${dots}
  <path d="${avgPath}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${x(last.date).toFixed(1)}" y="${(y(avg[avg.length - 1]) - 8).toFixed(1)}" text-anchor="end" font-size="11" font-weight="700" fill="var(--ink)">${vf(last.v)}</text>
  <text x="${pl}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmtShort(points[0].date)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtShort(last.date)}</text></svg>`;
  }
  /* a tiny line for a tile: points [{date, v}] (dates may repeat), an optional goal as a dashed line */
  function spark(points, opts) {
    opts = opts || {};
    const W = 120, H = 34, p = 3, vals = points.map(q => q.v), extra = opts.goal != null ? [opts.goal] : [];
    let lo = Math.min(...vals, ...extra), hi = Math.max(...vals, ...extra); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const tt = d => parseD(d).getTime(), t0 = tt(points[0].date), t1 = tt(points[points.length - 1].date);
    const x = (q, i) => p + (t1 > t0 ? (tt(q.date) - t0) / (t1 - t0) : (points.length > 1 ? i / (points.length - 1) : 0.5)) * (W - 2 * p), y = v => p + (hi - v) / (hi - lo) * (H - 2 * p);
    const pts = points.map((q, i) => `${x(q, i).toFixed(1)},${y(q.v).toFixed(1)}`).join(' '), last = points[points.length - 1];
    const goal = opts.goal == null ? '' : `<line x1="0" x2="${W}" y1="${y(opts.goal).toFixed(1)}" y2="${y(opts.goal).toFixed(1)}" stroke="var(--green)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${opts.label || ''}">${goal}<polyline points="${pts}" fill="none" stroke="var(--kc, var(--accent))" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${x(last, points.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2.4" fill="var(--kc, var(--accent))"/></svg>`;
  }
  function heat(map, weeks, endDate, color, marks) {
    /* map: {date: ratio 0..1, or a grade name}; grid of weeks columns, Mon..Sun rows; marks: {date: color} rings a day (big events) */
    const start = weekStart(addDays(endDate, -7 * (weeks - 1)));
    const cell = 12, gap = 3, W = weeks * (cell + gap), H = 7 * (cell + gap) + 12;
    let rects = '';
    for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d); if (date > endDate) continue;
      const r = map[date], graded = typeof r === 'string', op = r == null || graded ? 1 : 0.25 + 0.75 * r;
      rects += `<rect x="${w * (cell + gap)}" y="${d * (cell + gap) + 12}" width="${cell}" height="${cell}" rx="3" fill="${r == null ? 'var(--track)' : graded ? 'var(--g-' + r + ')' : (color || 'var(--green)')}" fill-opacity="${op.toFixed(2)}"><title>${date}</title></rect>`;
      if (marks && marks[date]) rects += `<rect x="${w * (cell + gap) - 1}" y="${d * (cell + gap) + 11}" width="${cell + 2}" height="${cell + 2}" rx="4" fill="none" stroke="${marks[date]}" stroke-width="2"/>`;
    }
    const months = []; let lastM = '';
    for (let w = 0; w < weeks; w++) { const m = fmtMonth(addDays(start, w * 7)); if (m !== lastM) { months.push(`<text x="${w * (cell + gap)}" y="9" font-size="9" fill="var(--muted)">${m}</text>`); lastM = m; } }
    return `<svg class="heat" viewBox="0 0 ${W} ${H}" role="img">${months.join('')}${rects}</svg>`;
  }

  MB.ui = { dragHandle, sortable, moveItem, $, uid, clone, deepEq, fmt, fmt1, num, byName, slug, h, svg, today, setDayStart, dayStartMin, spark, isDate, parseD, addDays, diffDays, DOW, DAYS, dow, dayName, fmtLong, fmtShort, fmtDay, fmtMonth, weekStart, fmtTime, isImageUrl, thumb,
    openSheet, closeSheet, sheetOpen, onSheetClosed, toast, confirmSheet, section, statCard, numField, textField, selectField, segmented, helpTip, listEditor, ring, bars, stacked, trend, heat };
})();
