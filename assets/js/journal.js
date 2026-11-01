// MERCURA — journal de fréquentation (démonstration).
// Enregistre, sans aucune donnée personnelle, les pages vues et les étapes d'achat dans ce navigateur,
// pour alimenter la page « Flux du site » de l'administration. Rien n'est envoyé à un serveur.
// En production, ce journal sera remplacé par GA4 ou par un point de collecte serveur, soumis au consentement.

const KEY = 'mercura_journal_v1';
const SESSION = 'mercura_visit_v1';
const MAX = 3000;
const SESSION_MS = 30 * 60 * 1000;

export function readJournal() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function clearJournal() { try { localStorage.removeItem(KEY); } catch { /* */ } }

function allowed() {
  const cfg = window.MERCURA_CONFIG || {};
  if (cfg.environment === 'preview') return true;
  const m = document.cookie.match(/(?:^|;\s*)mercura_consent=([^;]+)/);
  try { return !!(m && JSON.parse(decodeURIComponent(m[1])).a); } catch { return false; }
}

// Visite = suite de pages sans interruption de plus de 30 minutes.
function visit() {
  const now = Date.now();
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch { /* */ }
  if (!v || now - v.last > SESSION_MS) v = { id: Math.random().toString(36).slice(2, 10), start: now, isNew: true };
  else v.isNew = false;
  v.last = now;
  try { sessionStorage.setItem(SESSION, JSON.stringify({ id: v.id, start: v.start, last: v.last })); } catch { /* */ }
  return v;
}

function device() {
  const w = Math.min(screen.width, innerWidth || screen.width);
  return w < 700 ? 'mobile' : w < 1100 ? 'tablette' : 'ordinateur';
}

function source() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('utm_source')) return { src: qs.get('utm_source').slice(0, 60), med: (qs.get('utm_medium') || '').slice(0, 40), camp: (qs.get('utm_campaign') || '').slice(0, 80) };
  if (qs.has('gclid') || qs.has('gbraid') || qs.has('wbraid')) return { src: 'google', med: 'cpc', camp: '' };
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.hostname !== location.hostname) return { src: ref.hostname.replace(/^www\./, ''), med: 'referral', camp: '' };
  } catch { /* */ }
  return { src: '(direct)', med: '', camp: '' };
}

function push(e) {
  if (!allowed()) return;
  try {
    const list = readJournal();
    list.push(e);
    if (list.length > MAX) list.splice(0, list.length - MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* stockage plein ou indisponible */ }
}

const v = visit();
export function journalPageView() {
  push({ t: Date.now(), s: v.id, e: 'page_view', p: location.pathname, ti: document.title.replace(/ \| Mercura Paris$/, '').replace(/ — Eau de parfum.*$/, '').slice(0, 90), ...(v.isNew ? { n: 1, d: device(), ...source() } : {}) });
}
// Événements de la boutique : seuls le nom, le montant et les noms de parfums sont conservés.
export function journalEvent(name, params = {}) {
  const e = { t: Date.now(), s: v.id, e: name, p: location.pathname };
  if (params.value != null) e.v = Number(params.value) || 0;
  if (Array.isArray(params.items)) e.it = params.items.slice(0, 10).map((i) => [i.item_name, i.quantity || 1]);
  if (params.search_term) e.q = String(params.search_term).slice(0, 60);
  push(e);
}
