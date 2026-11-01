// MERCURA — scripts du site.
import { esc, fmtPrice, cap, picture, ICONS, stockLabel, lowStock } from './shared.js';
import { initTracking, track, toItem, campaignParams } from './tracking.js';
import { applyOverrides, createOrder, updateOrder, currentUser, updateUser, checkCoupon, settings, addMessage } from './store.js';
import { journalEvent } from './journal.js';

const cfg = window.MERCURA_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const page = document.body.dataset.page;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ================================================================ Catalogue (instantané + données WooCommerce en direct)
let catalogue = null;
let liveStatus = 'pending'; // 'live' | 'offline'
const byId = (id) => catalogue && catalogue.products.find((p) => p.id === String(id));

async function loadCatalogue() {
  if (catalogue) return catalogue;
  const r = await fetch('/assets/data/catalogue.json');
  catalogue = await r.json();
  return catalogue;
}

const cleanName = (s) => s.replace(/&#8217;|&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s*\((sold[\s-]?out|épuisé|rupture[^)]*)\)\s*/i, '').trim();

async function refreshLive() {
  await loadCatalogue();
  if (!cfg.commerce.liveData) {
    // Visualisation : catalogue publié + modifications faites dans l'administration.
    catalogue.products.forEach(applyOverrides);
    liveStatus = 'live';
    applyLiveToDom();
    document.dispatchEvent(new CustomEvent('mercura:live'));
    return;
  }
  const KEY = 'mercura_live_v1';
  let live = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.t < 5 * 60 * 1000) live = cached.d;
  } catch { /* */ }
  if (!live) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const ids = catalogue.products.map((p) => p.id).join(',');
      const r = await fetch(`${cfg.commerce.storeApi}/products?include=${ids}&per_page=100`, { credentials: 'omit', signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      live = data.map((p) => ({
        id: String(p.id), nom: cleanName(p.name), prix: Number(p.prices.price) / 10 ** (p.prices.currency_minor_unit || 0),
        enStock: !!p.is_in_stock, achetable: !!p.is_purchasable && !!p.is_in_stock,
        stockMax: p.is_in_stock && p.add_to_cart ? p.add_to_cart.maximum : 0
      }));
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: live })); } catch { /* */ }
    } catch {
      liveStatus = 'offline';
      document.dispatchEvent(new CustomEvent('mercura:live'));
      return;
    }
  }
  for (const l of live) {
    const p = byId(l.id);
    if (p) Object.assign(p, l);
  }
  // Un produit absent de la réponse n'est plus en vente.
  for (const p of catalogue.products) if (!live.some((l) => l.id === p.id)) Object.assign(p, { enStock: false, achetable: false, stockMax: 0 });
  liveStatus = 'live';
  applyLiveToDom();
  document.dispatchEvent(new CustomEvent('mercura:live'));
}

function applyLiveToDom() {
  for (const p of catalogue.products) {
    $$(`[data-live-price="${p.id}"]`).forEach((el) => { el.textContent = fmtPrice(p.prix); });
    $$(`[data-live-old="${p.id}"]`).forEach((el) => {
      const show = p.prixBarre && p.prixBarre > p.prix;
      el.hidden = !show;
      if (show) el.innerHTML = `<span class="visually-hidden">au lieu de </span>${fmtPrice(p.prixBarre)}`;
      const off = el.nextElementSibling;
      if (off && off.classList.contains('price-off')) { off.hidden = !show; if (show) off.textContent = `−${Math.round((1 - p.prix / p.prixBarre) * 100)} %`; }
    });
    $$(`[data-live-badge="${p.id}"]`).forEach((el) => { el.hidden = p.enStock; });
    $$(`[data-product-card][data-id="${p.id}"]`).forEach((el) => { el.dataset.stock = p.achetable ? '1' : '0'; el.dataset.price = p.prix; });
    $$(`[data-add-to-cart="${p.id}"]`).forEach((b) => {
      if (b.classList.contains('card-add') || b.closest('.c-actions')) {
        b.disabled = !p.achetable;
        if (!p.achetable) b.innerHTML = `Indisponible<span class="visually-hidden"> : ${esc(p.nom)}</span>`;
      } else b.disabled = !p.achetable;
    });
    $$(`[data-live-stock="${p.id}"]`).forEach((el) => {
      el.innerHTML = stockLabel(p);
      el.classList.toggle('stock--out', !p.enStock);
      el.classList.toggle('stock--low', !!lowStock(p));
    });
    $$(`[data-buy-area="${p.id}"]`).forEach((el) => { el.hidden = !p.achetable; });
    $$(`[data-out-area="${p.id}"]`).forEach((el) => { el.hidden = p.achetable; });
    const qty = $(`#qty-${p.id}`);
    if (qty) qty.max = Math.max(1, Math.min(p.stockMax || 1, 10));
  }
}

// ================================================================ Panier
const CART_KEY = 'mercura_cart_v1';
const cart = {
  items: [],
  load() {
    try { this.items = (JSON.parse(localStorage.getItem(CART_KEY) || '{}').items || []).filter((i) => i && i.id && i.qty > 0); } catch { this.items = []; }
  },
  save() {
    try { localStorage.setItem(CART_KEY, JSON.stringify({ items: this.items, updated: Date.now() })); } catch { /* navigation privée */ }
    document.dispatchEvent(new CustomEvent('mercura:cart'));
  },
  qtyOf(id) { return this.items.find((i) => i.id === id)?.qty || 0; },
  add(id, qty) {
    const it = this.items.find((i) => i.id === id);
    if (it) it.qty += qty; else this.items.push({ id, qty });
    this.save();
  },
  set(id, qty) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    if (qty <= 0) this.items = this.items.filter((i) => i.id !== id); else it.qty = qty;
    this.save();
  },
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this.save(); },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); }
};
cart.load();
window.addEventListener('storage', (e) => { if (e.key === CART_KEY) { cart.load(); document.dispatchEvent(new CustomEvent('mercura:cart')); } });

// Lignes validées avec les prix et stocks actuels (jamais les prix enregistrés dans le navigateur).
function cartLines() {
  return cart.items.map((it) => {
    const p = byId(it.id);
    if (!p) return { id: it.id, qty: it.qty, missing: true };
    const max = Math.min(p.stockMax || 0, 99);
    let qty = it.qty, msg = null, cls = null;
    if (!p.achetable) { msg = "Ce parfum n'est plus disponible. Retirez-le pour poursuivre."; cls = 'err'; }
    else if (liveStatus === 'live' && max && qty > max) { qty = max; msg = 'Quantité ajustée à la disponibilité actuelle.'; cls = 'warn'; }
    return { id: it.id, p, qty, requested: it.qty, ok: p.achetable, msg, cls, total: p.achetable ? p.prix * qty : 0 };
  });
}
function cartSummary() {
  const lines = cartLines();
  const valid = lines.filter((l) => l.ok);
  const subtotal = valid.reduce((s, l) => s + l.total, 0);
  return { lines, valid, subtotal, blocked: lines.some((l) => !l.ok), count: valid.reduce((s, l) => s + l.qty, 0) };
}
function syncAdjustedQuantities() {
  // Enregistre les quantités ramenées au stock pour que le panier transmis soit exact.
  let changed = false;
  for (const l of cartLines()) if (l.ok && l.qty !== l.requested) { const it = cart.items.find((i) => i.id === l.id); it.qty = l.qty; changed = true; }
  if (changed) { try { localStorage.setItem(CART_KEY, JSON.stringify({ items: cart.items, updated: Date.now() })); } catch { /* */ } }
}

function updateCount() {
  const n = cart.count();
  $$('[data-cart-count]').forEach((el) => { el.textContent = n; el.dataset.count = n; });
  $$('[data-cart-label]').forEach((el) => { el.textContent = n ? `Panier, ${n} article${n > 1 ? 's' : ''}` : 'Panier vide'; });
}
function bump() {
  $$('[data-cart-count]').forEach((el) => { el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 300); });
}

function lineHTML(l, compact) {
  if (l.missing) return `<li class="cart-line is-unavailable"><span class="thumb"></span><div><h3>Article indisponible</h3></div><span></span><div class="controls"><button type="button" class="remove" data-remove="${esc(l.id)}">Retirer</button></div></li>`;
  const { p } = l;
  const max = Math.max(1, Math.min(p.stockMax || 1, 99));
  return `<li class="cart-line${l.ok ? '' : ' is-unavailable'}">
  <a class="thumb" href="${p.url}" tabindex="-1" aria-hidden="true">${picture(p.img, { sizes: '76px', alt: '' })}</a>
  <div><h3><a href="${p.url}">${esc(p.nom)}</a></h3><p class="meta">${esc(p.concentration)} · ${p.volumeMl} ml · ${fmtPrice(p.prix)}${p.prixBarre ? ` <s>${fmtPrice(p.prixBarre)}</s>` : ''}</p></div>
  <span class="line-total">${l.ok ? fmtPrice(l.total) : '—'}</span>
  <div class="controls">
    ${l.ok ? `<div class="qty qty--sm" data-line-qty="${p.id}"><button type="button" data-step="-1" aria-label="Diminuer la quantité de ${esc(p.nom)}"${l.qty <= 1 ? '' : ''}>−</button><label class="visually-hidden" for="lq-${compact ? 'd' : 'p'}-${p.id}">Quantité de ${esc(p.nom)}</label><input id="lq-${compact ? 'd' : 'p'}-${p.id}" type="number" inputmode="numeric" min="1" max="${max}" value="${l.qty}"><button type="button" data-step="1" aria-label="Augmenter la quantité de ${esc(p.nom)}"${l.qty >= max && liveStatus === 'live' ? ' disabled' : ''}>+</button></div>` : '<span></span>'}
    <button type="button" class="remove" data-remove="${p.id}">Retirer<span class="visually-hidden"> ${esc(p.nom)} du panier</span></button>
  </div>
  ${l.msg ? `<p class="line-msg ${l.cls}" role="alert">${l.msg}</p>` : ''}
</li>`;
}

function totalsHTML(s) {
  return `<div class="totals">
  <div><span>Sous-total (${s.count} article${s.count > 1 ? 's' : ''})</span><span>${fmtPrice(s.subtotal)}</span></div>
  ${(() => { const sv = s.valid.reduce((t, l) => t + (l.p.prixBarre ? (l.p.prixBarre - l.p.prix) * l.qty : 0), 0); return sv ? `<div class="saving"><span>Dont réduction</span><span>−${fmtPrice(sv)}</span></div>` : ''; })()}
  <div class="note"><span>Livraison</span><span>Offerte en France (24/48 h)</span></div>
</div>`;
}
const emptyHTML = `<div class="cart-empty"><p>Votre panier est vide.</p><a class="btn" href="/parfums/">Découvrir les parfums ${ICONS.arrow}</a></div>`;
const liveNote = () => liveStatus === 'offline' ? '<p class="notice small" role="status">Les prix et disponibilités n\'ont pas pu être actualisés. Ils seront vérifiés lors du paiement.</p>' : '';

// Boutique ouverte ou commandes suspendues (réglage de l'administration).
const shopOpen = () => settings().boutiqueOuverte !== false;
const closedNotice = () => shopOpen() ? '' : `<p class="notice notice--err" role="alert">${esc(settings().messageFermeture || 'Les commandes sont momentanément suspendues.')}</p>`;

function checkoutButton(s, label = 'Commander') {
  return `${closedNotice()}<button type="button" class="btn btn--block" data-checkout${s.valid.length && !s.blocked && shopOpen() ? '' : ' disabled'}>${label} ${ICONS.arrow}</button>`;
}

// Code promo appliqué (mémorisé pour la visite ; revérifié à chaque affichage).
const COUPON_KEY = 'mercura_coupon';
const appliedCode = () => { try { return sessionStorage.getItem(COUPON_KEY) || ''; } catch { return ''; } };
function couponState(s) {
  const code = appliedCode();
  if (!code) return null;
  const r = checkCoupon(code, s.subtotal);
  return { ...r, code: r.ok ? r.coupon.code : code };
}
function couponHTML(cs) {
  if (cs && cs.ok) return `<div class="coupon coupon--on"><span>Code <b>${esc(cs.code)}</b> appliqué</span><button type="button" class="linklike" data-coupon-remove>Retirer</button></div>`;
  return `<form class="coupon" data-coupon-form novalidate><label class="visually-hidden" for="coupon-in">Code promo</label><input id="coupon-in" name="code" placeholder="Code promo" autocomplete="off" value="${cs ? esc(cs.code) : ''}"><button type="submit" class="btn btn--ghost">Appliquer</button>${cs && !cs.ok ? `<p class="err" role="alert">${esc(cs.msg)}</p>` : ''}</form>`;
}

function renderDrawer() {
  const body = $('[data-cart-drawer-body]'), foot = $('[data-cart-drawer-foot]');
  if (!body) return;
  if (!cart.items.length) { body.innerHTML = emptyHTML; foot.hidden = true; return; }
  const s = cartSummary();
  body.innerHTML = `${liveNote()}<ul class="cart-lines">${s.lines.map((l) => lineHTML(l, true)).join('')}</ul>`;
  foot.hidden = false;
  foot.innerHTML = `${totalsHTML(s)}<div class="btn-row">${checkoutButton(s)}<a class="btn btn--ghost btn--block" href="/panier/">Voir le panier</a></div>`;
}

function renderCartPage() {
  const root = $('#cart-page-root');
  if (!root) return;
  if (!cart.items.length) { root.innerHTML = emptyHTML; return; }
  const s = cartSummary();
  const returned = new URLSearchParams(location.search).get('erreur') === 'indisponible'
    ? '<p class="notice notice--err" role="alert">Les articles de votre panier n\'étaient plus disponibles au moment du paiement. Les disponibilités ont été actualisées ci-dessous.</p>' : '';
  root.innerHTML = `<div class="cart-page">
  <div>${returned}${liveNote()}<h2 class="visually-hidden">Articles du panier</h2><ul class="cart-lines" style="border-top:1px solid var(--line)">${s.lines.map((l) => lineHTML(l, false)).join('')}</ul>
    <p style="margin-top:24px"><a class="link-arrow" href="/parfums/">Continuer mes achats</a></p></div>
  <aside class="summary" aria-labelledby="summary-title">
    <h2 id="summary-title">Récapitulatif</h2>
    ${totalsHTML(s)}
    ${s.blocked ? '<p class="notice notice--err" role="alert">Un article de votre panier n\'est plus disponible. Retirez-le pour poursuivre votre commande.</p>' : ''}
    ${checkoutButton(s, 'Commander')}
    <ul class="secure-list"><li>${ICONS.whatsapp}Commande confirmée avec vous sur WhatsApp</li><li>${ICONS.globe}Livraison offerte en France en 24/48 h</li><li>${ICONS.mail}Une question ? <a href="mailto:${cfg.contact.email}">${cfg.contact.email}</a></li></ul>
  </aside>
</div>`;
}

function handoffUrl() {
  const s = cartSummary();
  const items = s.valid.map((l) => `${l.p.id}:${l.qty}`).join(',');
  const u = new URL(cfg.commerce.checkoutBase.replace(/\/$/, '') + '/');
  u.searchParams.set(cfg.commerce.handoffParam, items);
  for (const [k, v] of Object.entries(campaignParams())) u.searchParams.set(k, v);
  return u.toString();
}

// ---------------------------------------------------------------- Page de commande (interface de paiement, visualisation)
const COUNTRY_CODES = 'FR BE CH LU MC DE AT ES IT PT NL IE GB DK SE NO FI PL CZ GR RO HU BG HR SI SK EE LV LT CY MT IS US CA MX BR AR CL CO PE AU NZ JP KR CN HK SG TW TH VN MY ID PH IN AE SA QA KW BH OM IL TR EG MA DZ TN SN CI CM GA CG CD ML BF GN NE TG BJ MG MU RE GP MQ GF YT NC PF ZA NG GH KE'.split(' ');
function countryOptions() {
  let names;
  try { names = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { names = { of: (c) => c }; }
  return COUNTRY_CODES.map((c) => [c, names.of(c)]).sort((a, b) => a[0] === 'FR' ? -1 : b[0] === 'FR' ? 1 : a[1].localeCompare(b[1], 'fr'))
    .map(([c, n]) => `<option value="${c}"${c === 'FR' ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
const field = (id, label, attrs = '', wide = false) => `<div class="field${wide ? ' field--wide' : ''}"><label for="${id}">${label}</label><input id="${id}" name="${id}" ${attrs} aria-describedby="${id}-err"><p class="err" id="${id}-err" hidden></p></div>`;

const shipFR = () => ($('#co-country')?.value || 'FR') === 'FR';
function shippingChoiceHTML() {
  return shipFR()
    ? `<span class="choice-body"><b>Livraison à domicile en France</b><small>Livrée en 24/48 h.</small></span><span class="choice-price"><strong>Offerte</strong></span>`
    : `<span class="choice-body"><b>Livraison internationale</b><small>Le tarif s'affichera ici selon le pays de livraison.</small></span><span class="choice-price">Selon le pays</span>`;
}

function checkoutSummaryHTML(s) {
  const saving = s.valid.reduce((t, l) => t + (l.p.prixBarre ? (l.p.prixBarre - l.p.prix) * l.qty : 0), 0);
  const cs = couponState(s);
  const off = cs && cs.ok ? cs.remise : 0;
  return `<h2 id="summary-title">Votre commande</h2>
  <ul class="co-lines">${s.lines.map((l) => l.missing ? '' : `<li class="${l.ok ? '' : 'is-off'}">
    <span class="co-thumb">${picture(l.p.img, { sizes: '64px', alt: '' })}<span class="co-qty" aria-hidden="true">${l.qty}</span></span>
    <span class="co-name"><b>${esc(l.p.nom)}</b><small>${esc(l.p.concentration)} · ${l.p.volumeMl} ml · quantité ${l.qty}</small>${l.ok ? '' : '<small class="err">Plus disponible à la commande</small>'}</span>
    <span class="co-price">${l.ok ? fmtPrice(l.total) : '—'}${l.ok && l.p.prixBarre ? `<s>${fmtPrice(l.p.prixBarre * l.qty)}</s>` : ''}</span></li>`).join('')}</ul>
  <p><a class="link-arrow" href="/panier/">Modifier le panier</a></p>
  <div class="totals">
    <div><span>Sous-total</span><span>${fmtPrice(s.subtotal)}</span></div>
    ${saving ? `<div class="saving"><span>Dont réduction</span><span>−${fmtPrice(saving)}</span></div>` : ''}
    ${off ? `<div class="saving"><span>Code ${esc(cs.code)}</span><span>−${fmtPrice(off)}</span></div>` : ''}
    ${shipFR() ? '<div class="free"><span>Livraison France · 24/48 h</span><span>Offerte</span></div>' : '<div class="note"><span>Livraison internationale</span><span>Selon le pays</span></div>'}
    <div class="grand"><span>Total${shipFR() ? '' : ' (hors livraison)'}</span><span>${fmtPrice(s.subtotal - off)}</span></div>
  </div>
  ${couponHTML(cs)}
  ${closedNotice()}
  ${s.blocked ? '<p class="notice notice--err" role="alert">Un article n\'est plus disponible à la commande. <a href="/panier/">Retirez-le du panier</a> pour poursuivre.</p>' : ''}`;
}

function renderCheckout() {
  const root = $('#checkout-root');
  if (!root) return;
  if (!cart.items.length) { root.innerHTML = emptyHTML; return; }
  const s = cartSummary();
  if (!$('#co-form', root)) {
    root.innerHTML = `<div class="co-grid">
  <form id="co-form" class="co-form" novalidate>
    <section class="co-section" aria-labelledby="co-s1"><h2 id="co-s1"><span class="co-step">1</span>Vos coordonnées</h2>
      <div class="form-row">${field('co-first', 'Prénom', 'autocomplete="given-name" required')}${field('co-last', 'Nom', 'autocomplete="family-name" required')}</div>
      ${field('co-email', 'E-mail <span class="opt">(facultatif)</span>', 'type="email" autocomplete="email"', true)}
    </section>
    <section class="co-section" aria-labelledby="co-s2"><h2 id="co-s2"><span class="co-step">2</span>Adresse de livraison</h2>
      ${field('co-address', 'Adresse', 'autocomplete="address-line1" required', true)}
      ${field('co-address2', 'Complément d\'adresse <span class="opt">(facultatif)</span>', 'autocomplete="address-line2"', true)}
      <div class="form-row form-row--3">${field('co-zip', 'Code postal', 'autocomplete="postal-code" inputmode="text" required')}${field('co-city', 'Ville', 'autocomplete="address-level2" required')}
        <div class="field"><label for="co-country">Pays</label><select id="co-country" name="co-country" autocomplete="country">${countryOptions()}</select></div></div>
      <div data-ship-choice class="ship-line">${shippingChoiceHTML()}</div>
    </section>
    <section class="co-section" aria-labelledby="co-s3"><h2 id="co-s3"><span class="co-step">3</span>Validation sur WhatsApp</h2>
      <ol class="wa-steps">
        <li>WhatsApp s'ouvre avec le récapitulatif de votre commande, déjà rédigé.</li>
        <li>Vous l'envoyez : nous vous confirmons la disponibilité et le délai d'expédition.</li>
        <li>Nous convenons ensemble du règlement par message, avant l'envoi de votre colis.</li>
      </ol>
      <label class="check check--terms"><input type="checkbox" id="co-terms" name="co-terms" aria-describedby="co-terms-err"> <span>J'ai lu et j'accepte les <a href="/cgv/" target="_blank" rel="noopener">conditions générales de vente</a>.</span></label>
      <p class="err" id="co-terms-err" hidden></p>
      <button type="submit" class="btn btn--block btn--wa" data-co-pay>Commander sur WhatsApp</button>
      <p class="hint wa-hint">Votre commande sera envoyée au ${esc((cfg.whatsapp && cfg.whatsapp.display) || cfg.contact.phone)}. Aucun paiement n'est demandé sur le site. WhatsApp doit être installé sur votre téléphone, ou WhatsApp Web ouvert sur ordinateur.</p>
      <p class="form-msg" id="co-status" role="status"></p>
    </section>
  </form>
  <aside class="summary co-summary" aria-labelledby="summary-title" data-co-summary></aside>
</div>`;
    initCheckoutForm();
  }
  $('[data-co-summary]', root).innerHTML = checkoutSummaryHTML(s);
  const cs = couponState(s);
  const btn = $('[data-co-pay]', root);
  btn.innerHTML = `${ICONS.whatsapp} Commander sur WhatsApp · ${fmtPrice(s.subtotal - (cs && cs.ok ? cs.remise : 0))}`;
  btn.disabled = !s.valid.length || s.blocked || !shopOpen();
}
document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-coupon-form]')) return;
  e.preventDefault();
  const code = e.target.elements.code.value.trim();
  try { if (code) sessionStorage.setItem(COUPON_KEY, code); else sessionStorage.removeItem(COUPON_KEY); } catch { /* */ }
  renderCheckout();
  const cs = couponState(cartSummary());
  if (cs && cs.ok) toast(`Code ${cs.code} appliqué : −${fmtPrice(cs.remise)}`);
  else $('#coupon-in')?.focus();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-coupon-remove]')) return;
  try { sessionStorage.removeItem(COUPON_KEY); } catch { /* */ }
  renderCheckout();
});

// Lien WhatsApp avec un message déjà rédigé (wa.me fonctionne sur mobile, WhatsApp Web et l'application de bureau).
const waNumber = () => String((cfg.whatsapp && cfg.whatsapp.number) || cfg.contact.phoneHref || '').replace(/\D/g, '');
function whatsappUrl(text) { return `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`; }
const euro = (n) => fmtPrice(n).replace(/ | /g, ' ');

function orderMessage(o) {
  const a = o.adresse;
  return [
    'Bonjour Mercura, je souhaite commander :',
    '',
    ...o.lignes.map((l) => `• ${l.nom}, eau de parfum 50 ml × ${l.qte} : ${euro(l.total)}`),
    ...(o.remiseCode ? [`Code promo ${o.code} : −${euro(o.remiseCode)}`] : []),
    `Total : ${euro(o.total)}`,
    `Livraison : ${o.livraison}`,
    '',
    `Commande n° ${o.numero}`,
    `Nom : ${o.client}`,
    `Adresse : ${[a.ligne1, a.ligne2].filter(Boolean).join(', ')}, ${a.cp} ${a.ville}, ${COUNTRY_NAME(a.pays)}`,
    ...(o.email ? [`E-mail : ${o.email}`] : []),
    '',
    'Pouvez-vous me confirmer la disponibilité et les modalités de paiement ? Merci.'
  ].join('\n');
}
// Fiche produit : commande directe d'un parfum par WhatsApp, sans passer par le panier.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wa-direct]');
  if (!b) return;
  const p = byId(b.dataset.waDirect);
  if (!p || !p.achetable) return;
  if (!shopOpen()) { toast(settings().messageFermeture); return; }
  const qty = Math.max(1, parseInt($(`#qty-${p.id}`)?.value, 10) || 1);
  const text = `Bonjour Mercura, je souhaite commander ${p.nom}, eau de parfum 50 ml × ${qty} (${euro(p.prix * qty)}).\nPouvez-vous me confirmer la disponibilité et les modalités de paiement ? Merci.`;
  track('generate_lead', { method: 'whatsapp_direct', currency: 'EUR', value: p.prix * qty, items: [toItem(p, qty)] });
  journalEvent('commande_whatsapp', { value: p.prix * qty, items: [{ item_name: p.nom, quantity: qty }] });
  window.open(whatsappUrl(text), '_blank');
});
const COUNTRY_NAME = (c) => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(c); } catch { return c; } };

function initCheckoutForm() {
  const form = $('#co-form');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'co-country') {
      $('[data-ship-choice]', form).innerHTML = shippingChoiceHTML();
      renderCheckout();
    }
  });
  const rules = {
    'co-first': (v) => !!v || 'Indiquez votre prénom.',
    'co-last': (v) => !!v || 'Indiquez votre nom.',
    'co-email': (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || 'Cette adresse e-mail semble incomplète.',
    'co-address': (v) => v.length >= 4 || 'Indiquez votre adresse (numéro et rue).',
    'co-zip': (v) => (form.elements['co-country'].value !== 'FR' ? !!v : /^\d{5}$/.test(v)) || (form.elements['co-country'].value === 'FR' ? 'Le code postal français comporte 5 chiffres.' : 'Indiquez votre code postal.'),
    'co-city': (v) => !!v || 'Indiquez votre ville.'
  };
  const show = (id, msg) => {
    const el = $('#' + id), err = $(`#${id}-err`);
    el.setAttribute('aria-invalid', !!msg);
    err.hidden = !msg; err.textContent = msg || '';
  };
  const check = (id) => { const r = rules[id](form.elements[id].value.trim()); show(id, r === true ? '' : r); return r === true; };
  Object.keys(rules).forEach((id) => form.elements[id].addEventListener('blur', () => { if (form.elements[id].value) check(id); }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const status = $('#co-status');
    const bad = Object.keys(rules).filter((id) => !check(id));
    const terms = $('#co-terms');
    const termsErr = $('#co-terms-err');
    termsErr.hidden = terms.checked;
    termsErr.textContent = terms.checked ? '' : 'Veuillez accepter les conditions générales de vente.';
    terms.setAttribute('aria-invalid', !terms.checked);
    if (bad.length || !terms.checked) {
      const n = bad.length + (terms.checked ? 0 : 1);
      status.className = 'form-msg err';
      status.textContent = n > 1 ? `${n} éléments sont à corriger.` : 'Un élément est à corriger.';
      (bad.length ? form.elements[bad[0]] : terms).focus();
      return;
    }
    const s = cartSummary();
    if (!shopOpen()) { status.className = 'form-msg err'; status.textContent = settings().messageFermeture; return; }
    const v = (id) => form.elements[id].value.trim();
    const user = currentUser();
    const saving = s.valid.reduce((t, l) => t + (l.p.prixBarre ? (l.p.prixBarre - l.p.prix) * l.qty : 0), 0);
    const cs = couponState(s);
    const off = cs && cs.ok ? cs.remise : 0;
    // La demande est enregistrée (admin › Commandes, statut « En attente ») puis envoyée par WhatsApp.
    const order = createOrder({
      canal: 'whatsapp', statut: 'attente',
      userId: user ? user.id : null,
      email: v('co-email').toLowerCase(), telephone: user?.telephone || '',
      client: `${v('co-first')} ${v('co-last')}`,
      adresse: { prenom: v('co-first'), nom: v('co-last'), ligne1: v('co-address'), ligne2: v('co-address2'), cp: v('co-zip'), ville: v('co-city'), pays: form.elements['co-country'].value },
      livraison: shipFR() ? 'France, offerte (24/48 h)' : 'Internationale, tarif à confirmer',
      paiement: 'À convenir sur WhatsApp',
      lignes: s.valid.map((l) => ({ id: l.p.id, nom: l.p.nom, prix: l.p.prix, qte: l.qty, total: l.total })),
      sousTotal: s.subtotal, remise: saving, code: off ? cs.code : null, remiseCode: off, total: s.subtotal - off
    }, Object.fromEntries(s.valid.map((l) => [l.p.id, l.p.stockMax])));
    const url = whatsappUrl(orderMessage(order));
    updateOrder(order.id, { whatsappUrl: url });
    try { sessionStorage.removeItem(COUPON_KEY); } catch { /* */ }
    track('generate_lead', { method: 'whatsapp', currency: 'EUR', value: order.total, items: s.valid.map((l) => toItem(l.p, l.qty)) });
    journalEvent('commande_whatsapp', { value: order.total, items: order.lignes.map((l) => ({ item_name: l.nom, quantity: l.qte })) });
    if (user && form.elements['co-save'] && form.elements['co-save'].checked) updateUser(user.id, { adresse: order.adresse });
    cart.items = [];
    cart.save();
    // Ouvre WhatsApp dans un nouvel onglet (ou l'application sur mobile), puis affiche la confirmation.
    window.open(url, '_blank');
    location.href = '/commande/confirmation/?n=' + encodeURIComponent(order.numero);
  });
  // Préremplissage pour un client connecté.
  const u = currentUser();
  if (u) {
    const set = (id, val) => { if (val && form.elements[id] && !form.elements[id].value) form.elements[id].value = val; };
    set('co-email', u.email); set('co-first', u.prenom); set('co-last', u.nom);
    if (u.adresse) { set('co-address', u.adresse.ligne1); set('co-address2', u.adresse.ligne2); set('co-zip', u.adresse.cp); set('co-city', u.adresse.ville); if (u.adresse.pays) form.elements['co-country'].value = u.adresse.pays; }
    form.querySelector('.check--terms').insertAdjacentHTML('beforebegin', '<label class="check"><input type="checkbox" name="co-save" checked> Enregistrer cette adresse dans mon compte</label>');
  } else {
    form.querySelector('#co-s1').insertAdjacentHTML('afterend', '<p class="hint co-login">Déjà client ? <a href="/compte/connexion/?retour=/commande/">Connectez-vous</a> pour retrouver vos informations. La commande sans compte reste possible.</p>');
  }
}

function renderAll() {
  updateCount();
  renderDrawer();
  renderCartPage();
  renderCheckout();
}

function openDrawer() {
  const d = $('#cart-drawer');
  if (!d) return;
  renderDrawer();
  if (!d.open) d.showModal();
  const s = cartSummary();
  track('view_cart', { currency: 'EUR', value: s.subtotal, items: s.valid.map((l) => toItem(l.p, l.qty)) });
}

function addToCart(id, qty, listName) {
  const p = byId(id);
  if (!p || !p.achetable) return { ok: false, msg: "Ce parfum n'est pas disponible pour le moment." };
  const max = Math.min(p.stockMax || 99, 99);
  const already = cart.qtyOf(id);
  const n = liveStatus === 'live' ? Math.min(qty, Math.max(0, max - already)) : qty;
  if (n <= 0) return { ok: false, msg: 'Quantité maximale disponible déjà dans votre panier.' };
  cart.add(id, n);
  bump();
  track('add_to_cart', { currency: 'EUR', value: p.prix * n, items: [toItem(p, n, listName ? { item_list_name: listName } : {})] });
  return { ok: true, n, msg: n < qty ? `${n} ajouté${n > 1 ? 's' : ''} : quantité limitée à la disponibilité.` : 'Ajouté au panier.' };
}

async function goCheckout() {
  syncAdjustedQuantities();
  const s = cartSummary();
  if (!s.valid.length || s.blocked) return;
  const params = { currency: 'EUR', value: s.subtotal, items: s.valid.map((l) => toItem(l.p, l.qty)) };
  if (cfg.commerce.mode === 'woocommerce') {
    // Petit délai pour laisser partir l'événement avant de quitter la page.
    let done = false;
    const go = () => { if (!done) { done = true; location.href = handoffUrl(); } };
    track('begin_checkout', { ...params, event_callback: go });
    setTimeout(go, 600);
  } else {
    location.href = '/commande/';
  }
}

// ================================================================ Interface générale
function initHeader() {
  const h = $('[data-header]');
  const onScroll = () => h && h.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const toggle = $('[data-menu-toggle]'), menu = $('#menu-mobile');
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open);
    toggle.querySelector('.visually-hidden').textContent = open ? 'Fermer le menu' : 'Ouvrir le menu';
    toggle.innerHTML = toggle.innerHTML.replace(/<svg[\s\S]*<\/svg>/, open ? ICONS.close : ICONS.menu);
    menu.hidden = !open;
    document.body.classList.toggle('menu-open', open);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') { toggle.click(); toggle.focus(); } });

}

function initDialogs() {
  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close-dialog]');
    if (close) close.closest('dialog').close();
    // Clic sur le fond : fermeture.
    if (e.target.tagName === 'DIALOG' && e.target.open) {
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });
  $('[data-cart-open]')?.addEventListener('click', (e) => {
    if (page === 'cart' || page === 'checkout') return;
    e.preventDefault();
    openDrawer();
  });
}

function initCartEvents() {
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-to-cart]');
    if (add && !add.disabled) {
      const res = addToCart(add.dataset.addToCart, 1, add.dataset.list);
      if (res.ok) {
        if (add.classList.contains('card-add')) {
          const html = add.innerHTML;
          add.classList.add('is-added');
          add.innerHTML = `Ajouté ✓<span class="visually-hidden"> au panier</span>`;
          setTimeout(() => { add.classList.remove('is-added'); add.innerHTML = html; }, 1600);
        }
        openDrawer();
      } else toast(res.msg);
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const p = byId(rm.dataset.remove);
      const q = cart.qtyOf(rm.dataset.remove);
      cart.remove(rm.dataset.remove);
      if (p) track('remove_from_cart', { currency: 'EUR', value: p.prix * q, items: [toItem(p, q)] });
      return;
    }
    const step = e.target.closest('[data-line-qty] [data-step]');
    if (step) {
      const id = step.closest('[data-line-qty]').dataset.lineQty;
      const p = byId(id);
      const next = cart.qtyOf(id) + Number(step.dataset.step);
      const max = liveStatus === 'live' ? Math.min(p.stockMax || 1, 99) : 99;
      if (next >= 1 && next <= max) cart.set(id, next);
      focusAfterRender = `[data-line-qty="${id}"] [data-step="${step.dataset.step}"]`;
      return;
    }
    if (e.target.closest('[data-checkout]')) { e.preventDefault(); goCheckout(); }
  });
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-line-qty] input');
    if (!inp) return;
    const id = inp.closest('[data-line-qty]').dataset.lineQty;
    const p = byId(id);
    const max = liveStatus === 'live' ? Math.min(p.stockMax || 1, 99) : 99;
    let v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    cart.set(id, Math.min(v, max));
  });
  document.addEventListener('mercura:cart', () => {
    renderAll();
    if (focusAfterRender) { const el = $(focusAfterRender); if (el && !el.disabled) el.focus(); focusAfterRender = null; }
  });
  document.addEventListener('mercura:live', renderAll);
}
let focusAfterRender = null;

function toast(msg) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-visible'), 4000);
}

// ================================================================ Recherche
function initSearch() {
  const dlg = $('#search-dialog');
  const input = $('#search-input'), list = $('#search-results');
  if (!dlg) return;
  $$('[data-search-open]').forEach((b) => b.addEventListener('click', async () => {
    await loadCatalogue();
    dlg.showModal();
    input.value = '';
    list.innerHTML = '';
    input.focus();
  }));
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = norm(input.value.trim());
      if (q.length < 2) { list.innerHTML = ''; return; }
      const res = catalogue.products.map((p) => {
        const notes = [...p.notes.tete, ...p.notes.coeur, ...p.notes.fond];
        const nameHit = norm(p.nom).includes(q);
        const noteHits = notes.filter((n) => norm(n).includes(q));
        return { p, score: (nameHit ? 10 : 0) + noteHits.length, noteHits };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
      list.innerHTML = res.length ? res.map(({ p, noteHits }) => `<li><a href="${p.url}">
        <span class="sr-img">${picture(p.img, { sizes: '52px', alt: '' })}</span>
        <span><b>${esc(p.nom)}</b><small>${noteHits.length ? 'Notes : ' + noteHits.map((n) => esc(cap(n))).join(', ') : esc(p.accroche)}</small></span>
        <span class="price">${p.enStock ? fmtPrice(p.prix) : 'Indisponible'}</span></a></li>`).join('')
        : `<li class="muted" style="padding:16px 0">Aucun parfum ne correspond à « ${esc(input.value.trim())} ».</li>`;
      track('search', { search_term: input.value.trim().slice(0, 60) });
    }, 160);
  });
}

// ================================================================ Listes de produits (mesure)
function initLists() {
  const lists = $$('[data-item-list]');
  if (!lists.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const ul = en.target;
      const items = $$('[data-product-card]', ul).filter((c) => !c.hidden).map((c, i) => {
        const p = byId(c.dataset.id);
        return p && toItem(p, 1, { index: i, item_list_id: ul.dataset.itemList, item_list_name: ul.dataset.listName });
      }).filter(Boolean);
      track('view_item_list', { item_list_id: ul.dataset.itemList, item_list_name: ul.dataset.listName, items });
    }
  }, { threshold: 0, rootMargin: '0px 0px -25% 0px' });
  lists.forEach((l) => io.observe(l));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-select-item]');
    if (!a) return;
    const ul = a.closest('[data-item-list]');
    const p = byId(a.dataset.selectItem);
    if (p && ul) track('select_item', { item_list_id: ul.dataset.itemList, item_list_name: ul.dataset.listName, items: [toItem(p, 1, { item_list_name: ul.dataset.listName })] });
  });
}

// ================================================================ Boutique : recherche, filtres, tri
function initCatalogue() {
  const grid = $('#cat-grid');
  if (!grid) return;
  const q = $('#cat-q'), stock = $('#cat-stock'), sort = $('#cat-sort'), count = $('#cat-count'), empty = $('#cat-empty');
  const chips = $$('[data-family]');
  const cards = $$('[data-product-card]', grid);
  const params = new URLSearchParams(location.search);
  q.value = params.get('q') || '';
  stock.checked = params.get('dispo') === '1';
  if (params.get('tri') && [...sort.options].some((o) => o.value === params.get('tri'))) sort.value = params.get('tri');
  const fams = new Set((params.get('famille') || '').split(',').filter(Boolean));
  chips.forEach((c) => c.setAttribute('aria-pressed', fams.has(c.dataset.family)));

  function apply(push) {
    const terms = norm(q.value.trim()).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of cards) {
      const hay = norm(c.dataset.search);
      const okQ = terms.every((t) => hay.includes(t));
      const okF = !fams.size || c.dataset.families.split(' ').some((f) => fams.has(f));
      const okS = !stock.checked || c.dataset.stock === '1';
      c.hidden = !(okQ && okF && okS);
      if (!c.hidden) shown++;
    }
    const key = sort.value;
    const sorted = [...cards].sort((a, b) => key === 'prix-asc' ? a.dataset.price - b.dataset.price || a.dataset.order - b.dataset.order
      : key === 'prix-desc' ? b.dataset.price - a.dataset.price || a.dataset.order - b.dataset.order
        : key === 'nom' ? a.dataset.name.localeCompare(b.dataset.name, 'fr') : a.dataset.order - b.dataset.order);
    sorted.forEach((c) => grid.appendChild(c));
    count.textContent = shown === cards.length ? `${shown} parfums` : `${shown} parfum${shown > 1 ? 's' : ''} sur ${cards.length}`;
    empty.hidden = shown > 0;
    if (push) {
      const u = new URLSearchParams();
      if (q.value.trim()) u.set('q', q.value.trim());
      if (fams.size) u.set('famille', [...fams].join(','));
      if (stock.checked) u.set('dispo', '1');
      if (sort.value !== 'selection') u.set('tri', sort.value);
      // Les paramètres de campagne (utm, gclid…) sont conservés dans l'adresse.
      for (const [k, v] of new URLSearchParams(location.search)) if (/^(utm_|gclid|gbraid|wbraid)/.test(k)) u.set(k, v);
      history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : ''));
    }
  }
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => apply(true), 120); });
  stock.addEventListener('change', () => apply(true));
  sort.addEventListener('change', () => apply(true));
  chips.forEach((c) => c.addEventListener('click', () => {
    const f = c.dataset.family;
    fams.has(f) ? fams.delete(f) : fams.add(f);
    c.setAttribute('aria-pressed', fams.has(f));
    apply(true);
  }));
  $('#cat-reset').addEventListener('click', () => {
    q.value = ''; stock.checked = false; sort.value = 'selection'; fams.clear();
    chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
    apply(true);
    q.focus();
  });
  document.addEventListener('mercura:live', () => apply(false));
  apply(false);
}

// ================================================================ Fiche produit
function initQtySteppers() {
  $$('[data-qty]').forEach((box) => {
    const input = $('input', box), minus = $('[data-qty-minus]', box), plus = $('[data-qty-plus]', box);
    const clamp = () => {
      const max = Number(input.max) || 10;
      let v = parseInt(input.value, 10);
      if (!Number.isFinite(v) || v < 1) v = 1;
      if (v > max) v = max;
      input.value = v;
      minus.disabled = v <= 1;
      plus.disabled = v >= max;
    };
    minus.addEventListener('click', () => { input.value = Number(input.value) - 1; clamp(); });
    plus.addEventListener('click', () => { input.value = Number(input.value) + 1; clamp(); });
    input.addEventListener('change', clamp);
    document.addEventListener('mercura:live', clamp);
    clamp();
  });
}

function initProduct() {
  const root = $('[data-product-page]');
  if (!root) return;
  const id = root.dataset.productPage;
  loadCatalogue().then(() => {
    const p = byId(id);
    if (p) track('view_item', { currency: 'EUR', value: p.prix, items: [toItem(p)] });
  });

  // Galerie
  const track_ = $('[data-gallery-track]', root);
  const thumbs = $$('[data-goto]', root);
  const dots = $$('.gallery-dots span', root);
  if (track_ && thumbs.length) {
    const slides = $$('.gallery-slide', track_);
    thumbs.forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.goto);
      track_.scrollTo({ left: slides[i].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) {
        const i = slides.indexOf(en.target);
        thumbs.forEach((t, k) => t.setAttribute('aria-current', k === i));
        dots.forEach((d, k) => d.classList.toggle('is-active', k === i));
      }
    }, { root: track_, threshold: 0.6 });
    slides.forEach((s) => io.observe(s));
  }

  // Ajout au panier
  const form = $(`[data-buy-form="${id}"]`);
  const msg = $('[data-buy-msg]', root);
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const qty = parseInt($(`#qty-${id}`).value, 10) || 1;
    const res = addToCart(id, qty, 'Fiche produit');
    msg.className = 'form-msg ' + (res.ok ? 'ok' : 'err');
    msg.textContent = res.msg;
    if (res.ok) openDrawer();
  });

  // Barre d'achat fixe (mobile) : visible tant que le bouton principal n'est pas à l'écran.
  const bar = $('[data-sticky-buy]');
  const anchor = $('[data-main-add]', root) || $(`[data-out-area="${id}"]`, root);
  if (bar && anchor) {
    const setVis = (v) => {
      bar.classList.toggle('is-visible', v);
      bar.setAttribute('aria-hidden', !v);
      $$('a,button', bar).forEach((b) => { b.tabIndex = v ? 0 : -1; });
    };
    new IntersectionObserver(([en]) => setVis(!en.isIntersecting)).observe(anchor);
  }
}

// ================================================================ Contact
function initContact() {
  const form = $('#contact-form');
  if (!form) return;
  const status = $('#cf-status');
  const rules = {
    name: (v) => v.trim().length >= 2 || 'Indiquez votre nom.',
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Indiquez une adresse e-mail valide, par exemple nom@exemple.fr.',
    subject: (v) => !!v || 'Choisissez un sujet.',
    message: (v) => v.trim().length >= 10 || 'Votre message doit contenir au moins 10 caractères.'
  };
  const check = (el) => {
    const res = rules[el.name](el.value);
    const err = $(`#${el.id}-err`);
    const bad = res !== true;
    el.setAttribute('aria-invalid', bad);
    err.hidden = !bad;
    err.textContent = bad ? res : '';
    return !bad;
  };
  Object.keys(rules).forEach((n) => form.elements[n].addEventListener('blur', (e) => { if (e.target.value) check(e.target); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const els = Object.keys(rules).map((n) => form.elements[n]);
    const bad = els.filter((el) => !check(el));
    if (bad.length) {
      status.className = 'form-msg err';
      status.textContent = bad.length > 1 ? `${bad.length} champs sont à corriger.` : 'Un champ est à corriger.';
      bad[0].focus();
      return;
    }
    const f = Object.fromEntries(els.map((el) => [el.name, el.value.trim()]));
    const body = `${f.message}\n\n— ${f.name}\n${f.email}`;
    // Démonstration : copie du message dans la messagerie de l'administration (en ligne : envoi au serveur).
    addMessage({ nom: f.name, email: f.email.toLowerCase(), sujet: form.elements.subject.selectedOptions?.[0]?.textContent || f.subject, message: f.message });

    // Envoi automatique à la boîte de Mercura (Web3Forms) ; « Répondre » renvoie à l'adresse du visiteur.
    const key = cfg.contactForm && cfg.contactForm.web3formsKey;
    if (key) {
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      status.className = 'form-msg';
      status.textContent = 'Envoi en cours…';
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ access_key: key, subject: '[Site] ' + f.subject, from_name: 'Site Mercura', name: f.name, email: f.email, replyto: f.email, message: f.message, botcheck: form.elements.botcheck.checked })
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.success) throw new Error(out.message || res.status);
        status.className = 'form-msg ok';
        status.textContent = 'Merci, votre message a bien été envoyé. Nous vous répondons au plus vite par e-mail.';
        track('generate_lead', { method: 'contact_form' });
        form.reset();
      } catch (err) {
        status.className = 'form-msg err';
        status.innerHTML = `Le message n'a pas pu être envoyé. Réessayez, ou écrivez-nous directement à <a href="mailto:${cfg.contact.email}">${cfg.contact.email}</a>.`;
      } finally {
        btn.disabled = false;
      }
      return;
    }

    status.className = 'form-msg ok';
    status.textContent = 'Votre logiciel de messagerie va s\'ouvrir avec votre message. Il ne vous reste qu\'à l\'envoyer.';
    track('generate_lead', { method: 'contact_form' });
    location.href = `mailto:${cfg.contact.email}?subject=${encodeURIComponent('[Site] ' + f.subject)}&body=${encodeURIComponent(body)}`;
  });
}

// ================================================================ Bandeau d'information (activable dans l'administration)
function initBanner() {
  const b = settings().bandeau || {};
  if (!b.actif || !b.texte) return;
  const el = document.createElement('div');
  el.className = 'info-bar';
  el.setAttribute('role', 'note');
  const safeLink = b.lien && /^(\/|https:\/\/)/.test(b.lien) ? b.lien : '';
  el.innerHTML = safeLink ? `<a href="${esc(safeLink)}">${esc(b.texte)}</a>` : `<span>${esc(b.texte)}</span>`;
  document.querySelector('.site-header')?.before(el);
}

// ================================================================ Démarrage
initBanner();
initTracking();
initHeader();
initDialogs();
initCartEvents();
initSearch();
initQtySteppers();
initCatalogue();
initProduct();
initContact();
updateCount();

loadCatalogue().then(() => {
  initLists();
  renderAll();
  if (page === 'cart') {
    const s = cartSummary();
    track('view_cart', { currency: 'EUR', value: s.subtotal, items: s.valid.map((l) => toItem(l.p, l.qty)) });
  }
  if (page === 'checkout' && cart.items.length) {
    const s = cartSummary();
    track('begin_checkout', { currency: 'EUR', value: s.subtotal, items: s.valid.map((l) => toItem(l.p, l.qty)), checkout_mode: cfg.commerce.mode });
  }
  // Prix et stocks en direct : sur les pages où ils comptent pour la décision d'achat.
  if (['product', 'catalogue', 'collection', 'cart', 'checkout', 'home'].includes(page) || cart.items.length) refreshLive();
}).catch(() => { /* catalogue indisponible : les pages restent lisibles */ });
