// Mesure d'audience et publicité : Google Consent Mode v2, GA4, Google Ads.
// Aucune balise n'est chargée tant que les identifiants ne sont pas renseignés dans config.js,
// et (en mode 'basic') tant que le visiteur n'a pas donné son accord.
import { esc } from './shared.js';
import { journalPageView, journalEvent } from './journal.js';

const cfg = window.MERCURA_CONFIG;
const T = { ...cfg.tracking };
const COOKIE = 'mercura_consent';
const qs = new URLSearchParams(location.search);

// Mode test : ?debug_tracking=1 simule des identifiants, affiche les événements et ne charge aucun script Google.
let debug = false;
try {
  if (qs.has('debug_tracking')) sessionStorage.setItem('mercura_debug', qs.get('debug_tracking') === '0' ? '' : '1');
  debug = sessionStorage.getItem('mercura_debug') === '1';
} catch { /* stockage indisponible */ }
if (debug) { T.ga4Id = T.ga4Id || 'G-TEST'; T.adsId = T.adsId || 'AW-TEST'; T.adsPurchaseLabel = T.adsPurchaseLabel || 'test'; }
const enabled = !!(T.ga4Id || T.adsId);

window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
const gtag = window.gtag;

gtag('consent', 'default', {
  ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
  functionality_storage: 'granted', security_storage: 'granted', wait_for_update: 500
});
gtag('set', 'ads_data_redaction', true);
if (T.consentMode === 'advanced') gtag('set', 'url_passthrough', true);

// ---------------------------------------------------------------- Consentement
function cookieDomain() {
  // Partage du choix avec le sous-domaine de paiement (ex. commande.mercuraparfums.com).
  try {
    const root = new URL(cfg.siteUrl).hostname.replace(/^www\./, '');
    return location.hostname === root || location.hostname.endsWith('.' + root) ? '; domain=.' + root : '';
  } catch { return ''; }
}
export function readConsent() {
  const m = document.cookie.match(/(?:^|;\s*)mercura_consent=([^;]+)/);
  if (!m) return null;
  try {
    const c = JSON.parse(decodeURIComponent(m[1]));
    return c.v === T.consentVersion ? c : null;
  } catch { return null; }
}
function writeConsent(a, m) {
  const c = { v: T.consentVersion, a: !!a, m: !!m, t: new Date().toISOString().slice(0, 10) };
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(c))}; Max-Age=${T.consentDays * 86400}; Path=/; SameSite=Lax${secure}${cookieDomain()}`;
  return c;
}

let tagsLoaded = false;
function loadTags(c) {
  if (!enabled) return;
  const wantGa = T.ga4Id && (T.consentMode === 'advanced' || c?.a);
  const wantAds = T.adsId && (T.consentMode === 'advanced' || c?.m);
  if (!wantGa && !wantAds) return;
  if (!tagsLoaded) {
    tagsLoaded = true;
    gtag('js', new Date());
    if (!debug) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(wantGa ? T.ga4Id : T.adsId);
      document.head.appendChild(s);
    }
  }
  if (wantGa && !loadTags.ga) { loadTags.ga = true; gtag('config', T.ga4Id, { send_page_view: true }); log('config', { id: T.ga4Id }); }
  if (wantAds && !loadTags.ads) { loadTags.ads = true; gtag('config', T.adsId); log('config', { id: T.adsId }); }
}

function applyConsent(c) {
  gtag('consent', 'update', {
    analytics_storage: c.a ? 'granted' : 'denied',
    ad_storage: c.m ? 'granted' : 'denied', ad_user_data: c.m ? 'granted' : 'denied', ad_personalization: c.m ? 'granted' : 'denied'
  });
  log('consent update', { mesure: c.a, publicite: c.m });
  loadTags(c);
  if (c.m) captureClickIds();
}

function banner(custom = false) {
  document.querySelector('.consent')?.remove();
  const c = readConsent() || { a: false, m: false };
  const el = document.createElement('section');
  el.className = 'consent';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'consent-title');
  el.innerHTML = `<h2 id="consent-title">Vos choix de cookies</h2>
<p>Avec votre accord, Mercura utilise des cookies Google pour mesurer l'audience du site et l'efficacité de ses annonces. Le panier et le site fonctionnent sans eux. <a href="/confidentialite/">En savoir plus</a></p>
<div class="consent-opts"${custom ? '' : ' hidden'}>
  <label class="consent-opt"><input type="checkbox" name="a"${c.a ? ' checked' : ''}><b>Mesure d'audience</b><span>Google Analytics : pages vues, recherches et ventes, de façon agrégée.</span></label>
  <label class="consent-opt"><input type="checkbox" name="m"${c.m ? ' checked' : ''}><b>Publicité</b><span>Google Ads : mesure des visites et des commandes issues de nos annonces.</span></label>
</div>
<div class="consent-actions">
  <button type="button" class="btn btn--ghost" data-c="refuse">Tout refuser</button>
  <button type="button" class="btn" data-c="accept">Tout accepter</button>
  <button type="button" class="btn btn--ghost wide" data-c="${custom ? 'save' : 'custom'}">${custom ? 'Enregistrer mes choix' : 'Personnaliser'}</button>
</div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const act = b.dataset.c;
    if (act === 'custom') { banner(true); return; }
    const choice = act === 'accept' ? [true, true] : act === 'refuse' ? [false, false]
      : [el.querySelector('[name=a]').checked, el.querySelector('[name=m]').checked];
    applyConsent(writeConsent(...choice));
    el.remove();
  });
  document.body.appendChild(el);
  (custom ? el.querySelector('input') : el.querySelector('[data-c=accept]')).focus({ preventScroll: true });
}

// ---------------------------------------------------------------- Paramètres de campagne
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'];
const CLICK = ['gclid', 'gbraid', 'wbraid'];
function store(key, obj) { try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch { /* */ } }
function read(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function captureCampaign() {
  const found = Object.fromEntries(UTM.filter((k) => qs.get(k)).map((k) => [k, qs.get(k).slice(0, 150)]));
  if (Object.keys(found).length) store('mercura_campaign', found);
}
function captureClickIds() {
  // Identifiants de clic publicitaires : conservés uniquement avec le consentement « Publicité ».
  const found = Object.fromEntries(CLICK.filter((k) => qs.get(k)).map((k) => [k, qs.get(k).slice(0, 200)]));
  if (Object.keys(found).length) store('mercura_click', found);
}
export function campaignParams() {
  const c = readConsent();
  return { ...(read('mercura_campaign') || {}), ...(c?.m ? read('mercura_click') || {} : {}) };
}

// ---------------------------------------------------------------- Événements
let panel = null;
function log(name, params) {
  if (!debug) return;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'debug-panel';
    panel.setAttribute('aria-label', 'Journal des événements de mesure');
    panel.innerHTML = '<b>Mesure — mode test</b> (aucune donnée envoyée)<br>';
    document.body.appendChild(panel);
  }
  panel.insertAdjacentHTML('beforeend', `<div><b>${esc(name)}</b> ${esc(JSON.stringify(params))}</div>`);
  panel.scrollTop = panel.scrollHeight;
  window.__mercuraEvents = window.__mercuraEvents || [];
  window.__mercuraEvents.push({ name, params });
}

export function track(name, params = {}) {
  log(name, params);
  journalEvent(name, params);
  if (!enabled) return;
  gtag('event', name, params);
  if (name === 'add_to_cart' && T.adsId && T.adsAddToCartLabel) gtag('event', 'conversion', { send_to: `${T.adsId}/${T.adsAddToCartLabel}`, value: params.value, currency: params.currency });
}

export function toItem(p, qty = 1, extra = {}) {
  return { item_id: p.id, item_name: p.nom, item_brand: 'Mercura', item_category: 'Parfums', item_variant: `${p.volumeMl} ml`, price: p.prix, quantity: qty, ...extra };
}

export function initTracking() {
  captureCampaign();
  journalPageView();
  const c = readConsent();
  if (T.consentMode === 'advanced') loadTags(c);
  if (c) applyConsent(c);
  else if (enabled) banner(false);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-consent-manage]')) { e.preventDefault(); banner(true); }
  });
}
export const trackingInfo = { enabled, debug };
