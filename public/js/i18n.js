/* Tally — interface languages. Only the interface is translated; the user's own names stay as typed. */
window.MB = window.MB || {};
(() => {
  'use strict';
  const LANGS = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', ja: '日本語', ko: '한국어', zh: '中文' };
  const LOCALES = { en: undefined, es: 'es', fr: 'fr', pt: 'pt-BR', de: 'de', ja: 'ja', ko: 'ko', zh: 'zh-CN' };
  const dict = {};
  let lang = 'en';
  const KEY = 'tally:lang';
  function add(code, strings) { dict[code] = Object.assign(dict[code] || {}, strings); }
  function detect() {
    try { const saved = localStorage.getItem(KEY); if (saved && LANGS[saved]) return saved; } catch (e) {}
    const prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (const p of prefs) { const primary = String(p).toLowerCase().split('-')[0]; if (LANGS[primary]) return primary; }
    return 'en';
  }
  function set(code, persist) {
    if (!LANGS[code]) code = 'en';
    lang = code; document.documentElement.lang = code;
    if (persist !== false) { try { localStorage.setItem(KEY, code); } catch (e) {} }
  }
  function t(key, vars) {
    let s = (dict[lang] && dict[lang][key]);
    if (s == null) s = dict.en && dict.en[key];
    if (s == null) return key;
    if (Array.isArray(s)) return s;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] == null ? '' : vars[k]);
    return s;
  }
  /* plural helper for unit words: t returns [singular, plural] */
  function unit(key, n) { const v = t(key); return Array.isArray(v) ? (Math.abs(n) === 1 ? v[0] : v[1]) : v; }
  const locale = () => LOCALES[lang];
  const rel = (days) => { try { return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-days, 'day'); } catch (e) { return days + 'd'; } };
  MB.i18n = { LANGS, dict, add, detect, set, t, unit, locale, rel, get lang() { return lang; } };
})();
