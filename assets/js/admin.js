// MERCURA — administration (démonstration, données dans le navigateur).
import { esc, fmtPrice } from './shared.js';
import * as S from './store.js';
import { readJournal, clearJournal } from './journal.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = $('#admin-root');
const fmtDate = (iso, time) => new Date(iso).toLocaleDateString('fr-FR', time ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
const badge = (s) => `<span class="st st--${s}">${esc(S.ORDER_STATUSES[s] || s)}</span>`;
let catalogue = null;

// Stock actuel de chaque parfum (catalogue + modifications de l'admin), pour le décompte à la validation.
const currentStocks = async () => {
  const cur = await loadCatalogue();
  return Object.fromEntries(cur.map((p) => [p.id, { cur: p.stockMax, base: catalogue.find((x) => x.id === p.id).stockMax }]));
};

async function loadCatalogue() {
  if (!catalogue) catalogue = (await (await fetch('/assets/data/catalogue.json')).json()).products;
  return catalogue.map((p) => S.applyOverrides({ ...p }));
}

// ---------------------------------------------------------------- Connexion
function renderLogin() {
  const first = !S.adminConfigured();
  root.innerHTML = `<div class="adm-login">
    <img src="/assets/img/brand/logo-noir.png" alt="Mercura Paris" height="56">
    <h1>${first ? 'Créer l\'accès administrateur' : 'Administration'}</h1>
    <p class="muted">${first ? 'Choisissez le mot de passe qui protégera l\'administration (8 caractères minimum).' : 'Saisissez votre mot de passe administrateur.'}</p>
    <form id="adm-login-form" class="form" novalidate>
      <div class="field"><label for="adm-pass">Mot de passe</label><input id="adm-pass" type="password" autocomplete="${first ? 'new-password' : 'off'}" required></div>
      ${first ? '<div class="field"><label for="adm-pass2">Confirmer le mot de passe</label><input id="adm-pass2" type="password" autocomplete="new-password" required></div>' : ''}
      <button class="btn btn--block" type="submit">${first ? 'Créer et entrer' : 'Se connecter'}</button>
      <p class="form-msg" id="adm-msg" role="status"></p>
    </form>
    ${first ? '' : '<p class="adm-demo"><button type="button" class="linklike" data-reset-pass style="text-decoration:underline;cursor:pointer">Mot de passe oublié ? Revenir au mot de passe par défaut</button></p>'}
    <p class="adm-demo">Mode démonstration : l'accès est protégé localement dans ce navigateur. Une authentification serveur sera nécessaire à la mise en ligne.</p>
  </div>`;
  $('[data-reset-pass]')?.addEventListener('click', () => {
    if (!confirm('Revenir au mot de passe par défaut (indiqué dans docs/ACCES-ADMIN.md) ? Les commandes et réglages sont conservés.')) return;
    S.resetAdminPassword();
    const msg = $('#adm-msg'); msg.className = 'form-msg ok'; msg.textContent = 'Mot de passe par défaut rétabli. Vous pouvez vous connecter.';
    $('#adm-pass').focus();
  });
  $('#adm-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Tolère les espaces ou guillemets copiés autour du mot de passe.
    const p = $('#adm-pass').value.trim().replace(/^[`'"«»\s]+|[`'"«»\s]+$/g, ''), msg = $('#adm-msg');
    try {
      if (first) {
        if (p.length < 8) throw new Error('8 caractères minimum.');
        if (p !== $('#adm-pass2').value) throw new Error('Les deux mots de passe ne correspondent pas.');
        await S.setAdminPassword(p);
      } else await S.adminLogin(p);
      S.logAdmin(first ? 'Accès administrateur créé' : 'Connexion');
      location.hash = '#tableau';
      render();
    } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  });
  $('#adm-pass').focus();
}

// ---------------------------------------------------------------- Mise en page
const NAV = [
  ['Pilotage', [['tableau', 'Tableau de bord'], ['flux', 'Flux du site']]],
  ['Ventes', [['commandes', 'Commandes'], ['clients', 'Clients'], ['messages', 'Messages']]],
  ['Catalogue', [['produits', 'Produits'], ['codes', 'Codes promo']]],
  ['Configuration', [['boutique', 'Boutique'], ['reglages', 'Réglages'], ['historique', 'Historique']]]
];
const TO_PROCESS = ['test', 'attente', 'payee', 'preparation'];
function shell(active, title, body, actions = '') {
  const d = S.db();
  const counts = { commandes: d.orders.filter((o) => TO_PROCESS.includes(o.statut)).length, messages: d.messages.filter((m) => !m.lu && !m.archive).length };
  const q = active === 'recherche' ? new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '' : '';
  root.innerHTML = `<div class="adm">
    <aside class="adm-side">
      <a class="adm-brand" href="#tableau"><img src="/assets/img/brand/logo-ivoire.png" alt="Mercura Paris" height="44"></a>
      <nav aria-label="Administration">${NAV.map(([g, items]) => `<p class="adm-group">${g}</p>${items.map(([k, l]) => `<a href="#${k}"${k === active ? ' aria-current="page"' : ''}>${l}${counts[k] ? `<span class="adm-count">${counts[k]}</span>` : ''}</a>`).join('')}`).join('')}</nav>
      <div class="adm-side-foot">${d.settings.boutiqueOuverte ? '<span class="shop-state on">Boutique ouverte</span>' : '<a class="shop-state off" href="#boutique">Commandes suspendues</a>'}<a href="/" target="_blank" rel="noopener">Voir la boutique ↗</a><button type="button" class="linklike" data-adm-logout>Se déconnecter</button></div>
    </aside>
    <main class="adm-main" id="contenu">
      <form class="adm-search" id="adm-search" role="search"><label class="visually-hidden" for="adm-q">Rechercher dans l'administration</label><input id="adm-q" type="search" placeholder="Rechercher une commande, un client, un message…" value="${esc(q)}"></form>
      <header class="adm-head"><h1>${title}</h1><div class="adm-actions">${actions}</div></header>
      <p class="adm-banner">Mode démonstration : les données sont enregistrées dans ce navigateur. Les commandes proviennent des validations de test du site (aucun paiement).</p>
      ${body}
    </main>
  </div>`;
  $('[data-adm-logout]').addEventListener('click', () => { S.logAdmin('Déconnexion'); S.adminLogout(); render(); });
  $('#adm-search').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#adm-q').value.trim(); if (v) location.hash = '#recherche?q=' + encodeURIComponent(v); });
}

// ---------------------------------------------------------------- Tableau de bord
async function viewDashboard() {
  const d = S.db();
  const orders = d.orders.filter((o) => o.statut !== 'annulee');
  const ca = orders.reduce((t, o) => t + o.total, 0);
  const articles = orders.reduce((t, o) => t + o.lignes.reduce((a, l) => a + l.qte, 0), 0);
  const products = await loadCatalogue();
  const off = products.filter((p) => !p.achetable);
  // Ventes par produit
  const per = {};
  orders.forEach((o) => o.lignes.forEach((l) => { per[l.id] = per[l.id] || { nom: l.nom, qte: 0, ca: 0 }; per[l.id].qte += l.qte; per[l.id].ca += l.total; }));
  const top = Object.values(per).sort((a, b) => b.qte - a.qte).slice(0, 5);
  // 14 derniers jours
  const days = [...Array(14)].map((_, i) => { const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - 13 + i); return dt; });
  const series = days.map((dt) => orders.filter((o) => { const od = new Date(o.date); od.setHours(0, 0, 0, 0); return od.getTime() === dt.getTime(); }).reduce((t, o) => t + o.total, 0));
  const max = Math.max(1, ...series);
  const byStatus = Object.keys(S.ORDER_STATUSES).map((k) => [k, d.orders.filter((o) => o.statut === k).length]).filter(([, n]) => n);
  // À traiter
  const seuil = d.settings.seuilStock;
  const low = products.filter((p) => p.achetable && p.stockMax != null && p.stockMax <= seuil);
  const toShip = d.orders.filter((o) => TO_PROCESS.includes(o.statut)).length;
  const toValidate = d.orders.filter((o) => o.statut === 'attente').length;
  const unread = d.messages.filter((m) => !m.lu && !m.archive).length;
  const activeCodes = d.coupons.filter((c) => c.actif).length;
  const todos = [
    !d.settings.boutiqueOuverte && ['err', 'Les commandes sont suspendues sur la boutique.', '#boutique', 'Rouvrir'],
    toValidate && ['warn', `${toValidate} commande${toValidate > 1 ? 's' : ''} WhatsApp à valider (stock non décompté tant qu'elle${toValidate > 1 ? 's ne sont pas validées' : ' n\'est pas validée'}).`, '#commandes?statut=attente', 'Valider'],
    toShip - toValidate > 0 && ['warn', `${toShip - toValidate} commande${toShip - toValidate > 1 ? 's' : ''} à préparer.`, '#commandes?statut=a-traiter', 'Voir'],
    unread && ['warn', `${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}.`, '#messages', 'Lire'],
    low.length && ['warn', `Stock bas (≤ ${seuil}) : ${low.map((p) => `${p.nom} (${p.stockMax})`).join(', ')}.`, '#produits', 'Gérer'],
    d.settings.bandeau.actif && ['info', `Bandeau affiché sur le site : « ${d.settings.bandeau.texte} »`, '#boutique', 'Modifier'],
    activeCodes && ['info', `${activeCodes} code${activeCodes > 1 ? 's' : ''} promo actif${activeCodes > 1 ? 's' : ''}.`, '#codes', 'Voir']
  ].filter(Boolean);
  shell('tableau', 'Tableau de bord', `
    ${todos.length ? `<ul class="todo-list">${todos.map(([k, t, h, l]) => `<li class="todo--${k}"><span>${esc(t)}</span><a href="${h}">${l}</a></li>`).join('')}</ul>` : '<p class="todo-ok">Rien à traiter pour le moment.</p>'}
    <div class="kpis">
      <div class="kpi"><span>Chiffre d'affaires</span><strong>${fmtPrice(ca)}</strong><small>hors commandes annulées</small></div>
      <div class="kpi"><span>Commandes</span><strong>${orders.length}</strong><small>${d.orders.length - orders.length} annulée(s)</small></div>
      <div class="kpi"><span>Panier moyen</span><strong>${orders.length ? fmtPrice(Math.round(ca / orders.length * 100) / 100) : '—'}</strong><small>${articles} article(s) vendu(s)</small></div>
      <div class="kpi"><span>Clients inscrits</span><strong>${d.users.length}</strong><small>comptes créés sur le site</small></div>
    </div>
    <div class="adm-grid">
      <section class="panel panel--wide"><h2>Ventes des 14 derniers jours</h2>
        ${orders.length ? `<div class="bars" role="img" aria-label="Chiffre d'affaires par jour sur 14 jours">${series.map((v, i) => `<div class="bar" title="${days[i].toLocaleDateString('fr-FR')} : ${fmtPrice(v)}"><span style="height:${Math.round(v / max * 100)}%"></span><em>${days[i].getDate()}</em></div>`).join('')}</div>` : '<p class="muted">Aucune commande pour le moment. Passez une commande test depuis la boutique pour voir apparaître les ventes.</p>'}
      </section>
      <section class="panel"><h2>Meilleures ventes</h2>${top.length ? `<ol class="rank">${top.map((t) => `<li><span>${esc(t.nom)}</span><b>${t.qte}</b></li>`).join('')}</ol>` : '<p class="muted">Pas encore de ventes.</p>'}</section>
      <section class="panel"><h2>Commandes par statut</h2>${byStatus.length ? `<ul class="rank">${byStatus.map(([k, n]) => `<li>${badge(k)}<b>${n}</b></li>`).join('')}</ul>` : '<p class="muted">Aucune commande.</p>'}</section>
      <section class="panel"><h2>Disponibilités</h2>${off.length ? `<ul class="rank">${off.map((p) => `<li><span>${esc(p.nom)}</span><span class="st st--annulee">Indisponible</span></li>`).join('')}</ul>` : '<p class="muted">Tous les parfums sont disponibles.</p>'}<p style="margin-top:14px"><a class="h-more" href="#produits">Gérer les produits</a></p></section>
      <section class="panel panel--wide"><h2>Dernières commandes</h2>${ordersTable(d.orders.slice(0, 5))}</section>
    </div>`);
}

// ---------------------------------------------------------------- Flux du site
const EVENT_LABELS = {
  page_view: 'Page vue', view_item: 'Fiche parfum consultée', add_to_cart: 'Ajout au panier', remove_from_cart: 'Retrait du panier',
  view_cart: 'Panier consulté', begin_checkout: 'Commande commencée', commande_test: 'Commande test validée', commande_whatsapp: 'Commande envoyée sur WhatsApp', search: 'Recherche',
  select_item: 'Parfum cliqué dans une liste', generate_lead: 'Message envoyé (contact)'
};
const PAGE_LABELS = { '/': 'Accueil', '/parfums/': 'Tous les parfums', '/collection/': 'La collection', '/maison/': 'La maison', '/panier/': 'Panier', '/commande/': 'Commande', '/commande/confirmation/': 'Confirmation', '/compte/': 'Mon compte', '/compte/connexion/': 'Connexion', '/faq/': 'FAQ', '/contact/': 'Contact', '/livraison-retours/': 'Livraison & retours' };
const SRC_LABELS = { '(direct)': 'Accès direct', google: 'Google' };
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return fmtDate(new Date(t).toISOString(), true);
}
const pct = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';
function countBy(list, key) {
  const m = new Map();
  list.forEach((x) => { const k = typeof key === 'function' ? key(x) : x[key]; if (k != null) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const rankList = (rows, label = (k) => esc(k), empty = 'Aucune donnée.') => rows.length
  ? `<ul class="rank">${rows.map(([k, n]) => `<li><span>${label(k)}</span><b>${n}</b></li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;

function viewFlux() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const days = Number(params.get('j') || 7);
  const all = readJournal();
  const from = days ? Date.now() - days * 86400000 : 0;
  const ev = all.filter((e) => e.t >= from);
  const views = ev.filter((e) => e.e === 'page_view');
  const sessions = new Set(ev.map((e) => e.s));
  const firsts = views.filter((e) => e.n);
  const sessWith = (name) => new Set(ev.filter((e) => e.e === name).map((e) => e.s)).size;
  const funnel = [['Visites', sessions.size], ['Fiche parfum vue', sessWith('view_item')], ['Ajout au panier', sessWith('add_to_cart')], ['Commande commencée', sessWith('begin_checkout')], ['Commande envoyée (WhatsApp)', sessWith('commande_whatsapp') + sessWith('commande_test')]];
  const live = new Set(ev.filter((e) => Date.now() - e.t < 5 * 60000).map((e) => e.s)).size;
  // Visites par jour
  const nd = Math.min(days || 30, 30);
  const dayList = [...Array(nd)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - nd + 1 + i); return d; });
  const perDay = dayList.map((d) => new Set(ev.filter((e) => { const x = new Date(e.t); x.setHours(0, 0, 0, 0); return x.getTime() === d.getTime(); }).map((e) => e.s)).size);
  const max = Math.max(1, ...perDay);
  const viewedPerfumes = countBy(ev.filter((e) => e.e === 'view_item' && e.it), (e) => e.it[0][0]);
  const added = new Map();
  ev.filter((e) => e.e === 'add_to_cart' && e.it).forEach((e) => e.it.forEach(([n, q]) => added.set(n, (added.get(n) || 0) + q)));
  const perfumeRows = viewedPerfumes.map(([n, c]) => [n, c, added.get(n) || 0]);
  [...added.keys()].filter((n) => !viewedPerfumes.some(([x]) => x === n)).forEach((n) => perfumeRows.push([n, 0, added.get(n)]));
  const feed = ev.filter((e) => !['view_item_list', 'view_cart'].includes(e.e)).slice(-40).reverse();
  const periods = [[1, '24 h'], [7, '7 jours'], [30, '30 jours'], [0, 'Tout']];

  shell('flux', 'Flux du site', `
    <div class="adm-filters seg" role="group" aria-label="Période">${periods.map(([j, l]) => `<a class="seg-btn" href="#flux?j=${j}"${j === days ? ' aria-current="true"' : ''}>${l}</a>`).join('')}
      <span class="live"><i></i>${live} visiteur${live > 1 ? 's' : ''} actif${live > 1 ? 's' : ''} (5 dernières min.)</span></div>
    <div class="kpis">
      <div class="kpi"><span>Visites</span><strong>${sessions.size}</strong><small>dont ${perDay[perDay.length - 1]} aujourd'hui</small></div>
      <div class="kpi"><span>Pages vues</span><strong>${views.length}</strong><small>${sessions.size ? (views.length / sessions.size).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '0'} page(s) par visite</small></div>
      <div class="kpi"><span>Ajouts au panier</span><strong>${ev.filter((e) => e.e === 'add_to_cart').length}</strong><small>${pct(sessWith('add_to_cart'), sessions.size)} des visites</small></div>
      <div class="kpi"><span>Taux de conversion</span><strong>${pct(sessWith('commande_whatsapp') + sessWith('commande_test'), sessions.size)}</strong><small>visites avec commande envoyée</small></div>
    </div>
    ${!all.length ? '<section class="panel"><p class="muted">Aucune visite enregistrée pour le moment. Naviguez sur la boutique dans ce navigateur (autre onglet) : les pages vues et les étapes d\'achat apparaîtront ici en direct.</p></section>' : `
    <div class="adm-grid">
      <section class="panel panel--wide"><h2>Visites par jour</h2>
        <div class="bars" style="grid-template-columns:repeat(${nd},minmax(0,1fr))" role="img" aria-label="Nombre de visites par jour">${perDay.map((v, i) => `<div class="bar" title="${dayList[i].toLocaleDateString('fr-FR')} : ${v} visite(s)"><span style="height:${Math.round(v / max * 100)}%"></span><em>${nd > 14 && i % 3 ? '' : dayList[i].getDate()}</em></div>`).join('')}</div></section>
      <section class="panel panel--wide"><h2>Parcours d'achat</h2>
        <ol class="funnel">${funnel.map(([l, n], i) => `<li><span class="f-label">${l}</span><span class="f-bar"><span style="width:${funnel[0][1] && n ? Math.max(2, n / funnel[0][1] * 100) : 0}%"></span></span><b>${n}</b><small>${i ? pct(n, funnel[0][1]) : ''}</small></li>`).join('')}</ol></section>
      <section class="panel"><h2>Pages les plus vues</h2>${rankList(countBy(views, 'p').slice(0, 10), (p) => `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(PAGE_LABELS[p] || (views.find((v) => v.p === p) || {}).ti || p)}</a>`)}</section>
      <section class="panel"><h2>Sources de trafic</h2>${rankList(countBy(firsts, (e) => e.src + (e.med ? ' / ' + e.med : '')).slice(0, 10), (k) => esc(SRC_LABELS[k] || k))}
        <h2 style="margin-top:24px">Campagnes</h2>${rankList(countBy(firsts.filter((e) => e.camp), 'camp').slice(0, 6), undefined, 'Aucune visite issue d\'une campagne (paramètres utm_campaign).')}</section>
      <section class="panel"><h2>Appareils</h2>${rankList(countBy(firsts, 'd'), (k) => esc(cap1(k)))}
        <h2 style="margin-top:24px">Recherches</h2>${rankList(countBy(ev.filter((e) => e.e === 'search' && e.q), (e) => e.q.toLowerCase()).slice(0, 8), undefined, 'Aucune recherche.')}</section>
      <section class="panel panel--wide"><h2>Intérêt par parfum</h2>${perfumeRows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Parfum</th><th class="num">Fiches vues</th><th class="num">Ajouts au panier</th><th class="num">Taux d'ajout</th></tr></thead><tbody>${perfumeRows.map(([n, c, a]) => `<tr><td>${esc(n)}</td><td class="num">${c}</td><td class="num">${a}</td><td class="num">${pct(a, c)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune fiche parfum consultée sur la période.</p>'}</section>
      <section class="panel panel--wide"><h2>Activité en direct</h2>
        <ul class="feed">${feed.map((e) => `<li><time>${ago(e.t)}</time><span class="fv">Visite ${esc(e.s.slice(0, 4).toUpperCase())}</span><span class="fe fe--${esc(e.e)}">${esc(EVENT_LABELS[e.e] || e.e)}</span><span class="fd">${feedDetail(e)}</span></li>`).join('')}</ul></section>
    </div>`}
    <p class="adm-note">Démonstration : ces chiffres proviennent des visites faites <strong>dans ce navigateur</strong> (aucune donnée personnelle, rien n'est envoyé). Une fois GA4 relié et le site en ligne, ce tableau sera alimenté par les vraies visites, avec le consentement des visiteurs. <button class="linklike danger" type="button" data-clear-journal>Effacer le journal</button></p>`);
  $('[data-clear-journal]').addEventListener('click', () => { if (confirm('Effacer tout le journal de visites ?')) { clearJournal(); viewFlux(); } });
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function feedDetail(e) {
  if (e.e === 'page_view') return `${esc(PAGE_LABELS[e.p] || e.ti || e.p)}${e.n ? ` <small>· ${esc(SRC_LABELS[e.src] || e.src)}${e.d ? ', ' + esc(e.d) : ''}</small>` : ''}`;
  if (e.e === 'search') return `« ${esc(e.q || '')} »`;
  const items = (e.it || []).map(([n, q]) => q > 1 ? `${esc(n)} ×${q}` : esc(n)).join(', ');
  return `${items}${e.v ? ` <small>· ${fmtPrice(e.v)}</small>` : ''}`;
}

// ---------------------------------------------------------------- Commandes
function ordersTable(list, selectable = false) {
  if (!list.length) return '<p class="muted">Aucune commande.</p>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${selectable ? '<th class="chk"><input type="checkbox" data-sel-all aria-label="Tout sélectionner"></th>' : ''}<th>N°</th><th>Date</th><th>Client</th><th>Articles</th><th>Statut</th><th class="num">Total</th></tr></thead><tbody>
  ${list.map((o) => `<tr data-href="#commande/${o.id}">${selectable ? `<td class="chk"><input type="checkbox" data-sel="${o.id}" aria-label="Sélectionner ${esc(o.numero)}"></td>` : ''}<td><a href="#commande/${o.id}">${esc(o.numero)}</a>${o.notes && o.notes.length ? ' <span class="tag" title="Notes internes">note</span>' : ''}</td><td>${fmtDate(o.date, true)}</td><td>${esc(o.client)}<br><small>${esc(o.email)}</small></td><td>${o.lignes.reduce((t, l) => t + l.qte, 0)}</td><td>${badge(o.statut)}${o.suivi && o.suivi.numero ? '<br><small>Suivi renseigné</small>' : ''}</td><td class="num">${fmtPrice(o.total)}${o.code ? `<br><small>${esc(o.code)}</small>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function viewOrders() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = (params.get('q') || '').toLowerCase(), st = params.get('statut') || '';
  const all = S.db().orders;
  const list = all.filter((o) => (!st || (st === 'a-traiter' ? TO_PROCESS.includes(o.statut) : o.statut === st)) && (!q || [o.numero, o.client, o.email, o.code || ''].join(' ').toLowerCase().includes(q)));
  const tabs = [['', 'Toutes', all.length], ['a-traiter', 'À traiter', all.filter((o) => TO_PROCESS.includes(o.statut)).length], ['expediee', 'Expédiées', all.filter((o) => o.statut === 'expediee').length], ['livree', 'Livrées', all.filter((o) => o.statut === 'livree').length], ['annulee', 'Annulées', all.filter((o) => o.statut === 'annulee').length]];
  shell('commandes', 'Commandes', `
    <div class="adm-filters seg" role="group" aria-label="Filtrer par statut">${tabs.map(([k, l, n]) => `<a class="seg-btn" href="#commandes?statut=${k}"${k === st ? ' aria-current="true"' : ''}>${l} <span class="seg-n">${n}</span></a>`).join('')}</div>
    <form class="adm-filters" id="ord-filters"><label class="visually-hidden" for="ord-q">Rechercher</label><input id="ord-q" type="search" placeholder="N°, client, e-mail ou code promo" value="${esc(q)}">
      <button class="btn btn--ghost" type="submit">Rechercher</button></form>
    <div class="bulk" id="bulk" hidden><span id="bulk-n"></span><label class="visually-hidden" for="bulk-st">Nouveau statut</label><select id="bulk-st">${Object.entries(S.ORDER_STATUSES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn btn--sm" type="button" data-bulk-apply>Appliquer</button><button class="btn btn--sm btn--ghost" type="button" data-bulk-print>Bons de préparation</button><button class="linklike danger" type="button" data-bulk-del>Supprimer</button></div>
    <section class="panel">${ordersTable(list, true)}</section>`, `<button class="btn btn--ghost" type="button" data-export-csv>Exporter (CSV)</button>`);
  $('#ord-filters').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#commandes?q=${encodeURIComponent($('#ord-q').value)}&statut=${st}`; });
  const selected = () => $$('[data-sel]:checked').map((c) => c.dataset.sel);
  const refresh = () => { const n = selected().length; $('#bulk').hidden = !n; $('#bulk-n').textContent = `${n} commande${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`; };
  $('[data-sel-all]')?.addEventListener('change', (e) => { $$('[data-sel]').forEach((c) => { c.checked = e.target.checked; }); refresh(); });
  $$('[data-sel]').forEach((c) => c.addEventListener('change', refresh));
  $('[data-bulk-apply]').addEventListener('click', async () => { const ids = selected(); S.setOrdersStatus(ids, $('#bulk-st').value, await currentStocks()); viewOrders(); toast(`${ids.length} commande(s) mise(s) à jour.`); });
  $('[data-bulk-print]').addEventListener('click', () => printSlips(S.db().orders.filter((o) => selected().includes(o.id))));
  $('[data-bulk-del]').addEventListener('click', () => {
    const ids = selected();
    if (!ids.length || !confirm(`Supprimer définitivement ${ids.length > 1 ? `ces ${ids.length} commandes` : 'cette commande'} ? Cette action est irréversible.`)) return;
    S.deleteOrders(ids); viewOrders(); toast(`${ids.length} commande${ids.length > 1 ? 's supprimées' : ' supprimée'}.`);
  });
  $('[data-export-csv]').addEventListener('click', () => {
    const rows = [['numero', 'date', 'client', 'email', 'telephone', 'adresse', 'cp', 'ville', 'pays', 'statut', 'articles', 'code_promo', 'remise_code', 'total', 'transporteur', 'suivi']].concat(list.map((o) => [o.numero, o.date, o.client, o.email, o.telephone, [o.adresse.ligne1, o.adresse.ligne2].filter(Boolean).join(', '), o.adresse.cp, o.adresse.ville, o.adresse.pays, S.ORDER_STATUSES[o.statut], o.lignes.map((l) => `${l.qte}x ${l.nom}`).join(' | '), o.code || '', o.remiseCode || 0, o.total, o.suivi?.transporteur || '', o.suivi?.numero || '']));
    download('commandes-mercura.csv', '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  });
}
// Bons de préparation imprimables (une page par commande).
function printSlips(list) {
  if (!list.length) return;
  const w = open('', '_blank');
  if (!w) { toast('Autorisez les fenêtres pour imprimer.'); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bons de préparation</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#141210;margin:0}section{padding:32px;page-break-after:always}h1{font:500 22px Georgia,serif;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border-bottom:1px solid #ccc;padding:8px 4px;text-align:left}.r{text-align:right}.box{display:inline-block;width:14px;height:14px;border:1px solid #141210}.g{display:grid;grid-template-columns:1fr 1fr;gap:24px}small{color:#666}</style></head><body>${list.map((o) => `<section><h1>Mercura Paris · Bon de préparation</h1><p><b>${esc(o.numero)}</b> · ${fmtDate(o.date, true)}</p>
    <div class="g"><div><small>Livrer à</small><br>${esc(o.adresse.prenom)} ${esc(o.adresse.nom)}<br>${esc(o.adresse.ligne1)}${o.adresse.ligne2 ? '<br>' + esc(o.adresse.ligne2) : ''}<br>${esc(o.adresse.cp)} ${esc(o.adresse.ville)} (${esc(o.adresse.pays)})<br>${esc(o.telephone || '')}</div><div><small>Livraison</small><br>${esc(o.livraison)}${o.suivi?.numero ? `<br>${esc(o.suivi.transporteur)} ${esc(o.suivi.numero)}` : ''}</div></div>
    <table><thead><tr><th></th><th>Parfum</th><th class="r">Quantité</th></tr></thead><tbody>${o.lignes.map((l) => `<tr><td><span class="box"></span></td><td>${esc(l.nom)} · Eau de parfum 50 ml</td><td class="r">${l.qte}</td></tr>`).join('')}</tbody></table>
    <p><small>Articles : ${o.lignes.reduce((t, l) => t + l.qte, 0)}</small></p></section>`).join('')}<script>print()<\/script></body></html>`);
  w.document.close();
}
function viewOrder(id) {
  const d = S.db();
  const o = d.orders.find((x) => x.id === id);
  if (!o) { shell('commandes', 'Commande introuvable', '<p><a class="h-more" href="#commandes">← Retour aux commandes</a></p>'); return; }
  const a = o.adresse || {};
  const u = o.userId && d.users.find((x) => x.id === o.userId);
  const idx = d.orders.findIndex((x) => x.id === id);
  const prev = d.orders[idx + 1], next = d.orders[idx - 1];
  shell('commandes', `Commande ${esc(o.numero)}`, `
    <p class="adm-crumbs"><a class="h-more" href="#commandes">← Retour aux commandes</a><span>${next ? `<a class="h-more" href="#commande/${next.id}">← Plus récente</a>` : ''}${prev ? `<a class="h-more" href="#commande/${prev.id}">Plus ancienne →</a>` : ''}</span></p>
    <div class="adm-grid">
      <section class="panel panel--wide"><h2>Articles</h2>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Parfum</th><th>Qté</th><th class="num">Prix</th><th class="num">Total</th></tr></thead><tbody>${o.lignes.map((l) => `<tr><td>${esc(l.nom)}</td><td>${l.qte}</td><td class="num">${fmtPrice(l.prix)}</td><td class="num">${fmtPrice(l.total)}</td></tr>`).join('')}</tbody>
        <tfoot>${o.remise ? `<tr><td colspan="3">Dont réduction (prix barrés)</td><td class="num">−${fmtPrice(o.remise)}</td></tr>` : ''}${o.remiseCode ? `<tr><td colspan="3">Code promo ${esc(o.code)}</td><td class="num">−${fmtPrice(o.remiseCode)}</td></tr>` : ''}<tr><td colspan="3">Livraison</td><td class="num">${esc(o.livraison)}</td></tr><tr class="tot"><td colspan="3">Total</td><td class="num">${fmtPrice(o.total)}</td></tr></tfoot></table></div>
      </section>
      <section class="panel"><h2>Statut</h2>
        ${!S.CONFIRMED.includes(o.statut) && o.statut !== 'annulee' ? `<div class="validate-box"><p><strong>Commande à valider.</strong> Validez-la quand le paiement est reçu : le stock sera alors décompté.</p><button class="btn btn--block" type="button" data-validate>Valider la commande (paiement reçu)</button></div>` : ''}
        <form id="st-form" class="form"><label class="visually-hidden" for="st-sel">Statut de la commande</label><select id="st-sel">${Object.entries(S.ORDER_STATUSES).map(([k, l]) => `<option value="${k}"${k === o.statut ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="btn" type="submit">Mettre à jour</button></form>
        <p class="hint" style="margin-top:10px">${o.stockDecompte ? 'Stock décompté à la validation ; il est remis en vente si la commande est annulée ou remise en attente.' : 'Stock non décompté : la commande n\'est pas encore validée.'}</p>
        <ul class="history">${(o.historique || []).slice().reverse().map((h) => `<li>${badge(h.statut)}<small>${fmtDate(h.date, true)}</small></li>`).join('')}</ul>
      </section>
      <section class="panel"><h2>Expédition</h2>
        <form id="ship-form" class="form">
          <div class="field"><label for="sh-car">Transporteur</label><select id="sh-car">${Object.keys(S.CARRIERS).map((c) => `<option${o.suivi?.transporteur === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="sh-num">Numéro de suivi</label><input id="sh-num" value="${esc(o.suivi?.numero || '')}" autocomplete="off"></div>
          <label class="check"><input type="checkbox" id="sh-mark"${o.statut === 'expediee' || o.statut === 'livree' ? ' disabled' : ' checked'}> Passer la commande en « Expédiée »</label>
          <button class="btn" type="submit">Enregistrer le suivi</button>
        </form>
        ${S.trackUrl(o.suivi) ? `<p style="margin-top:12px"><a class="h-more" href="${esc(S.trackUrl(o.suivi))}" target="_blank" rel="noopener">Suivre le colis ↗</a></p>` : ''}
        <p class="hint" style="margin-top:10px">Le client voit le transporteur et le numéro dans son espace.</p>
      </section>
      <section class="panel"><h2>Client</h2><p><strong>${esc(o.client)}</strong><br><a href="mailto:${esc(o.email)}?subject=${encodeURIComponent('Votre commande Mercura ' + o.numero)}">${esc(o.email)}</a><br>${esc(o.telephone || '')}</p><p>${u ? `<a class="h-more" href="#client/${u.id}">Fiche client</a>` : '<span class="muted">Commande sans compte</span>'}</p></section>
      <section class="panel"><h2>Livraison</h2><p>${esc(a.prenom)} ${esc(a.nom)}<br>${esc(a.ligne1)}${a.ligne2 ? '<br>' + esc(a.ligne2) : ''}<br>${esc(a.cp)} ${esc(a.ville)} (${esc(a.pays || 'FR')})</p><p class="muted">${esc(o.livraison)}</p></section>
      <section class="panel"><h2>Notes internes</h2>
        ${(o.notes || []).length ? `<ul class="notes">${o.notes.map((n) => `<li><p>${esc(n.texte)}</p><small>${fmtDate(n.date, true)}</small></li>`).join('')}</ul>` : '<p class="muted">Aucune note. Les notes ne sont visibles que dans l\'administration.</p>'}
        <form id="note-form" class="form" style="margin-top:12px"><label class="visually-hidden" for="note-t">Nouvelle note</label><textarea id="note-t" rows="3" placeholder="Ajouter une note…"></textarea><button class="btn btn--ghost btn--sm" type="submit">Ajouter</button></form>
      </section>
      <section class="panel"><h2>Paiement</h2><p>${esc(o.paiement)}</p><p class="row-actions"><button class="btn btn--ghost btn--sm" type="button" data-slip>Bon de préparation</button><button class="btn btn--ghost btn--sm" type="button" data-print>Imprimer la fiche</button></p><p><button class="linklike danger" type="button" data-del>Supprimer la commande</button></p></section>
    </div>`);
  $('[data-validate]')?.addEventListener('click', async () => {
    S.setOrderStatus(o.id, 'payee', undefined, await currentStocks());
    viewOrder(o.id); toast(`Commande ${o.numero} validée : stock décompté.`);
  });
  $('#st-form').addEventListener('submit', async (e) => { e.preventDefault(); S.setOrderStatus(o.id, $('#st-sel').value, undefined, await currentStocks()); viewOrder(o.id); toast('Statut mis à jour.'); });
  $('#ship-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const numero = $('#sh-num').value.trim();
    if (!numero) { toast('Indiquez le numéro de suivi.'); return; }
    S.updateOrder(o.id, { suivi: { transporteur: $('#sh-car').value, numero } }, `suivi ${$('#sh-car').value} ${numero}`);
    if ($('#sh-mark').checked) S.setOrderStatus(o.id, 'expediee', undefined, await currentStocks());
    viewOrder(o.id); toast('Suivi enregistré.');
  });
  $('#note-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#note-t').value.trim(); if (!t) return; S.addOrderNote(o.id, t); viewOrder(o.id); });
  $('[data-slip]').addEventListener('click', () => printSlips([o]));
  $('[data-print]').addEventListener('click', () => print());
  $('[data-del]').addEventListener('click', () => { if (confirm(`Supprimer définitivement la commande ${o.numero} ?`)) { S.deleteOrder(o.id); location.hash = '#commandes'; } });
}

// ---------------------------------------------------------------- Produits
async function viewProducts() {
  const products = await loadCatalogue();
  const ov = S.productOverrides();
  const seuil = S.settings().seuilStock;
  shell('produits', 'Produits', `
    <p class="muted" style="margin:0 0 18px">Les modifications s'appliquent immédiatement à la boutique (dans ce navigateur). Stock à 0 : le parfum passe automatiquement en « Indisponible ». Alerte de stock bas : ${seuil} flacons ou moins (<a href="#boutique">modifier</a>).</p>
    <section class="panel"><div class="tbl-wrap"><table class="tbl tbl--products"><thead><tr><th>Parfum</th><th>Prix (€)</th><th>Prix barré (€)</th><th>Stock</th><th>Disponible</th><th></th></tr></thead><tbody>
    ${products.map((p) => `<tr data-pid="${p.id}">
      <td><div class="prod-cell">${p.img ? `<img src="${p.img.base}-${p.img.widths[0]}.webp" alt="" width="44" height="55">` : ''}<span><strong>${esc(p.nom)}</strong><small>${esc(p.accroche)}</small>${ov[p.id] ? '<em class="mod">modifié</em>' : ''}${p.achetable && p.stockMax != null && p.stockMax <= seuil ? '<em class="mod mod--low">stock bas</em>' : ''}${!p.achetable ? '<em class="mod mod--off">indisponible</em>' : ''}</span></div></td>
      <td><input class="in-num" type="number" min="0" step="1" name="prix" value="${p.prix}" aria-label="Prix de ${esc(p.nom)}"></td>
      <td><input class="in-num" type="number" min="0" step="1" name="prixBarre" value="${p.prixBarre || ''}" placeholder="—" aria-label="Prix barré de ${esc(p.nom)}"></td>
      <td><input class="in-num" type="number" min="0" step="1" name="stock" value="${p.stockMax ?? ''}" data-init="${p.stockMax ?? ''}" placeholder="non suivi" aria-label="Stock de ${esc(p.nom)}"></td>
      <td><label class="switch"><input type="checkbox" name="disponible"${p.achetable ? ' checked' : ''} aria-label="${esc(p.nom)} disponible"><span></span></label></td>
      <td class="row-actions"><button class="btn btn--sm" type="button" data-save>Enregistrer</button>${ov[p.id] ? '<button class="linklike" type="button" data-reset>Annuler les modifications</button>' : ''}<a class="h-more" href="${p.url}" target="_blank" rel="noopener">Voir</a></td>
    </tr>`).join('')}
    </tbody></table></div></section>`);
  $$('[data-save]').forEach((b) => b.addEventListener('click', () => {
    const tr = b.closest('tr'), id = tr.dataset.pid, v = (n) => tr.querySelector(`[name=${n}]`);
    const prix = Number(v('prix').value), barre = v('prixBarre').value ? Number(v('prixBarre').value) : null;
    if (!(prix > 0)) { alert('Le prix doit être supérieur à 0.'); return; }
    if (barre && barre <= prix) { alert('Le prix barré doit être supérieur au prix de vente.'); return; }
    const patch = { prix, prixBarre: barre, disponible: v('disponible').checked };
    // Le stock n'est enregistré que s'il a été changé ici.
    if (v('stock').value !== v('stock').dataset.init) Object.assign(patch, { stock: v('stock').value === '' ? null : Number(v('stock').value), stockModifie: v('stock').value !== '', stockRef: catalogue.find((x) => x.id === id).stockMax });
    S.setProductOverride(id, patch, tr.querySelector('strong').textContent);
    viewProducts().then(() => toast('Produit enregistré.'));
  }));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => { const tr = b.closest('tr'); S.resetProductOverride(tr.dataset.pid, tr.querySelector('strong').textContent); viewProducts(); }));
}

// ---------------------------------------------------------------- Clients
function viewClients() {
  const d = S.db();
  const rows = d.users.map((u) => { const os = d.orders.filter((o) => (o.userId === u.id || o.email === u.email) && o.statut !== 'annulee'); return { u, n: os.length, total: os.reduce((t, o) => t + o.total, 0) }; });
  const guests = [...new Set(d.orders.filter((o) => !o.userId && !d.users.some((u) => u.email === o.email)).map((o) => o.email))];
  shell('clients', 'Clients', `
    <section class="panel"><h2>Comptes clients (${rows.length})</h2>${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client</th><th>E-mail</th><th>Inscription</th><th>Ville</th><th>Commandes</th><th class="num">Total dépensé</th></tr></thead><tbody>
    ${rows.sort((a, b) => b.total - a.total).map(({ u, n, total }) => `<tr data-href="#client/${u.id}"><td><a href="#client/${u.id}">${esc(u.prenom)} ${esc(u.nom)}</a></td><td>${esc(u.email)}</td><td>${fmtDate(u.cree)}</td><td>${esc(u.adresse ? u.adresse.ville : '—')}</td><td>${n}</td><td class="num">${fmtPrice(total)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Aucun compte client pour le moment.</p>'}</section>
    <section class="panel"><h2>Commandes sans compte (${guests.length})</h2>${guests.length ? `<ul class="rank">${guests.map((e) => `<li><a href="#commandes?q=${encodeURIComponent(e)}">${esc(e)}</a></li>`).join('')}</ul>` : '<p class="muted">Aucune.</p>'}</section>`,
  rows.length ? '<button class="btn btn--ghost" type="button" data-export-clients>Exporter (CSV)</button>' : '');
  $('[data-export-clients]')?.addEventListener('click', () => {
    const r = [['prenom', 'nom', 'email', 'telephone', 'ville', 'inscription', 'commandes', 'total']].concat(rows.map(({ u, n, total }) => [u.prenom, u.nom, u.email, u.telephone, u.adresse?.ville || '', u.cree, n, total]));
    download('clients-mercura.csv', '﻿' + r.map((x) => x.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  });
}
function viewClient(id) {
  const d = S.db();
  const u = d.users.find((x) => x.id === id);
  if (!u) { shell('clients', 'Client introuvable', '<p><a class="h-more" href="#clients">← Retour aux clients</a></p>'); return; }
  const os = d.orders.filter((o) => o.userId === u.id || o.email === u.email);
  const valid = os.filter((o) => o.statut !== 'annulee');
  const total = valid.reduce((t, o) => t + o.total, 0);
  const fav = countBy(valid.flatMap((o) => o.lignes.flatMap((l) => Array(l.qte).fill(l.nom))), (x) => x).slice(0, 3);
  const msgs = d.messages.filter((m) => m.email === u.email);
  const a = u.adresse;
  shell('clients', `${esc(u.prenom)} ${esc(u.nom)}`, `
    <p><a class="h-more" href="#clients">← Retour aux clients</a></p>
    <div class="kpis"><div class="kpi"><span>Commandes</span><strong>${valid.length}</strong><small>${os.length - valid.length} annulée(s)</small></div><div class="kpi"><span>Total dépensé</span><strong>${fmtPrice(total)}</strong><small>panier moyen ${valid.length ? fmtPrice(Math.round(total / valid.length * 100) / 100) : '—'}</small></div><div class="kpi"><span>Client depuis</span><strong style="font-size:1.4rem">${fmtDate(u.cree)}</strong><small>&nbsp;</small></div><div class="kpi"><span>Dernière commande</span><strong style="font-size:1.4rem">${os[0] ? fmtDate(os[0].date) : '—'}</strong><small>&nbsp;</small></div></div>
    <div class="adm-grid">
      <section class="panel"><h2>Coordonnées</h2><p><a href="mailto:${esc(u.email)}">${esc(u.email)}</a><br>${esc(u.telephone || 'Téléphone non renseigné')}</p>${a ? `<p>${esc(a.prenom)} ${esc(a.nom)}<br>${esc(a.ligne1)}${a.ligne2 ? '<br>' + esc(a.ligne2) : ''}<br>${esc(a.cp)} ${esc(a.ville)}</p>` : '<p class="muted">Aucune adresse enregistrée.</p>'}</section>
      <section class="panel"><h2>Parfums préférés</h2>${rankList(fav, undefined, 'Pas encore d\'achat.')}</section>
      <section class="panel"><h2>Messages (${msgs.length})</h2>${msgs.length ? `<ul class="rank">${msgs.map((m) => `<li><a href="#message/${m.id}">${esc(m.sujet)}</a><small>${fmtDate(m.date)}</small></li>`).join('')}</ul>` : '<p class="muted">Aucun message.</p>'}</section>
      <section class="panel panel--wide"><h2>Commandes</h2>${ordersTable(os)}</section>
    </div>
    <p style="margin-top:22px"><button class="linklike danger" type="button" data-del-user>Supprimer ce compte client</button> <span class="muted" style="font-size:.82rem">(ses commandes sont conservées)</span></p>`);
  $('[data-del-user]').addEventListener('click', () => { if (confirm(`Supprimer le compte de ${u.email} ?`)) { S.deleteUser(u.id); location.hash = '#clients'; } });
}

// ---------------------------------------------------------------- Codes promo
function viewCodes() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const list = S.coupons();
  const edit = list.find((c) => c.id === params.get('modifier'));
  const today = new Date().toISOString().slice(0, 10);
  const state = (c) => !c.actif ? ['annulee', 'Désactivé'] : c.fin && today > c.fin ? ['annulee', 'Expiré'] : c.debut && today < c.debut ? ['attente', 'Programmé'] : c.usagesMax && c.usages >= c.usagesMax ? ['annulee', 'Épuisé'] : ['livree', 'Actif'];
  const orders = S.db().orders.filter((o) => o.code && o.statut !== 'annulee');
  const c = edit || { type: 'pct', actif: true };
  shell('codes', 'Codes promo', `<div class="adm-grid">
    <section class="panel panel--wide"><h2>Codes (${list.length})</h2>${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Remise</th><th>Conditions</th><th>Validité</th><th>Utilisations</th><th class="num">Remises accordées</th><th>État</th><th></th></tr></thead><tbody>
      ${list.map((x) => { const [k, l] = state(x); const used = orders.filter((o) => o.code === x.code); return `<tr><td><b class="code">${esc(x.code)}</b>${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</td><td>${x.type === 'pct' ? `${x.valeur} %` : fmtPrice(Number(x.valeur))}</td><td>${x.minimum ? `dès ${fmtPrice(Number(x.minimum))}` : '—'}</td><td>${x.debut || x.fin ? `${x.debut ? 'du ' + fmtDate(x.debut) : ''} ${x.fin ? 'au ' + fmtDate(x.fin) : ''}` : 'sans limite'}</td><td>${x.usages || 0}${x.usagesMax ? ` / ${x.usagesMax}` : ''}</td><td class="num">${fmtPrice(used.reduce((t, o) => t + (o.remiseCode || 0), 0))}</td><td><span class="st st--${k}">${l}</span></td>
        <td class="row-actions"><label class="switch"><input type="checkbox" data-toggle="${x.id}"${x.actif ? ' checked' : ''} aria-label="Activer ${esc(x.code)}"><span></span></label><a class="h-more" href="#codes?modifier=${x.id}">Modifier</a><button class="linklike danger" type="button" data-del-code="${x.id}">Supprimer</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted">Aucun code promo. Créez-en un ci-dessous : il pourra être saisi par vos clients sur la page de commande.</p>'}</section>
    <section class="panel panel--wide"><h2>${edit ? `Modifier ${esc(edit.code)}` : 'Nouveau code'}</h2>
      <form id="code-form" class="form code-form" novalidate>
        <div class="field"><label for="cf-code">Code</label><input id="cf-code" name="code" value="${esc(c.code || '')}" placeholder="BIENVENUE10" required autocomplete="off" style="text-transform:uppercase"></div>
        <div class="field"><label for="cf-type">Type de remise</label><select id="cf-type" name="type"><option value="pct"${c.type === 'pct' ? ' selected' : ''}>Pourcentage</option><option value="fixe"${c.type === 'fixe' ? ' selected' : ''}>Montant fixe (€)</option></select></div>
        <div class="field"><label for="cf-val">Valeur</label><input id="cf-val" name="valeur" type="number" min="1" step="1" value="${esc(c.valeur ?? '')}" required></div>
        <div class="field"><label for="cf-min">Achat minimum (€) <span class="opt">(facultatif)</span></label><input id="cf-min" name="minimum" type="number" min="0" step="1" value="${esc(c.minimum ?? '')}"></div>
        <div class="field"><label for="cf-deb">Début <span class="opt">(facultatif)</span></label><input id="cf-deb" name="debut" type="date" value="${esc(c.debut || '')}"></div>
        <div class="field"><label for="cf-fin">Fin <span class="opt">(facultatif)</span></label><input id="cf-fin" name="fin" type="date" value="${esc(c.fin || '')}"></div>
        <div class="field"><label for="cf-max">Utilisations max. <span class="opt">(facultatif)</span></label><input id="cf-max" name="usagesMax" type="number" min="1" step="1" value="${esc(c.usagesMax ?? '')}"></div>
        <div class="field"><label for="cf-note">Note interne <span class="opt">(facultatif)</span></label><input id="cf-note" name="note" value="${esc(c.note || '')}" placeholder="ex. newsletter d'octobre"></div>
        <label class="check"><input type="checkbox" name="actif"${c.actif ? ' checked' : ''}> Actif</label>
        <div class="row-actions"><button class="btn" type="submit">${edit ? 'Enregistrer' : 'Créer le code'}</button>${edit ? '<a class="h-more" href="#codes">Annuler</a>' : ''}</div>
        <p class="form-msg" id="cf-msg" role="status"></p>
      </form></section>
  </div>`);
  $('#code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements, msg = $('#cf-msg');
    const num = (n) => f[n].value === '' ? null : Number(f[n].value);
    try {
      const valeur = num('valeur');
      if (!(valeur > 0)) throw new Error('Indiquez la valeur de la remise.');
      if (f.type.value === 'pct' && valeur > 90) throw new Error('Un pourcentage ne peut pas dépasser 90 %.');
      if (f.debut.value && f.fin.value && f.fin.value < f.debut.value) throw new Error('La date de fin précède la date de début.');
      S.saveCoupon({ id: edit?.id, code: f.code.value, type: f.type.value, valeur, minimum: num('minimum'), debut: f.debut.value || null, fin: f.fin.value || null, usagesMax: num('usagesMax'), note: f.note.value.trim(), actif: f.actif.checked });
      location.hash = '#codes'; viewCodes(); toast(edit ? 'Code modifié.' : 'Code créé.');
    } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  });
  $$('[data-toggle]').forEach((t) => t.addEventListener('change', () => { const x = list.find((y) => y.id === t.dataset.toggle); S.saveCoupon({ ...x, actif: t.checked }); viewCodes(); }));
  $$('[data-del-code]').forEach((b) => b.addEventListener('click', () => { const x = list.find((y) => y.id === b.dataset.delCode); if (confirm(`Supprimer le code ${x.code} ?`)) { S.deleteCoupon(x.id); viewCodes(); } }));
}

// ---------------------------------------------------------------- Messages
function viewMessages() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const box = params.get('boite') || 'reception';
  const all = S.db().messages;
  const list = all.filter((m) => box === 'archives' ? m.archive : !m.archive);
  shell('messages', 'Messages', `
    <div class="adm-filters seg" role="group" aria-label="Boîte"><a class="seg-btn" href="#messages"${box === 'reception' ? ' aria-current="true"' : ''}>Réception <span class="seg-n">${all.filter((m) => !m.archive).length}</span></a><a class="seg-btn" href="#messages?boite=archives"${box === 'archives' ? ' aria-current="true"' : ''}>Archives <span class="seg-n">${all.filter((m) => m.archive).length}</span></a></div>
    <section class="panel">${list.length ? `<ul class="inbox">${list.map((m) => `<li class="${m.lu ? '' : 'unread'}"><a href="#message/${m.id}"><b>${esc(m.nom)}</b><span class="ib-sub">${esc(m.sujet)}</span><span class="ib-prev">${esc(m.message.slice(0, 110))}</span><time>${fmtDate(m.date, true)}</time></a></li>`).join('')}</ul>` : `<p class="muted">${box === 'archives' ? 'Aucun message archivé.' : 'Aucun message. Les messages envoyés depuis la page Contact du site arrivent ici.'}</p>`}</section>`);
}
function viewMessage(id) {
  const m = S.db().messages.find((x) => x.id === id);
  if (!m) { shell('messages', 'Message introuvable', '<p><a class="h-more" href="#messages">← Retour aux messages</a></p>'); return; }
  if (!m.lu) S.updateMessage(id, { lu: true });
  const u = S.db().users.find((x) => x.email === m.email);
  const reply = `mailto:${m.email}?subject=${encodeURIComponent('Re : ' + m.sujet)}&body=${encodeURIComponent(`\n\n\n> ${m.message.split('\n').join('\n> ')}`)}`;
  shell('messages', esc(m.sujet), `
    <p><a class="h-more" href="#messages${m.archive ? '?boite=archives' : ''}">← Retour aux messages</a></p>
    <section class="panel msg">
      <p class="msg-from"><b>${esc(m.nom)}</b> &lt;<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>&gt;${u ? ` · <a class="h-more" href="#client/${u.id}">Fiche client</a>` : ''}<br><small>${fmtDate(m.date, true)}</small></p>
      <div class="msg-body">${esc(m.message).replace(/\n/g, '<br>')}</div>
      <p class="row-actions"><a class="btn btn--sm" href="${esc(reply)}">Répondre</a><button class="btn btn--sm btn--ghost" type="button" data-unread>Marquer non lu</button><button class="btn btn--sm btn--ghost" type="button" data-archive>${m.archive ? 'Remettre en réception' : 'Archiver'}</button><button class="linklike danger" type="button" data-del-msg>Supprimer</button></p>
    </section>`);
  $('[data-unread]').addEventListener('click', () => { S.updateMessage(id, { lu: false }); location.hash = '#messages'; });
  $('[data-archive]').addEventListener('click', () => { S.updateMessage(id, { archive: !m.archive }); location.hash = '#messages'; toast(m.archive ? 'Message remis en réception.' : 'Message archivé.'); });
  $('[data-del-msg]').addEventListener('click', () => { if (confirm('Supprimer ce message ?')) { S.deleteMessage(id); location.hash = '#messages'; } });
}

// ---------------------------------------------------------------- Boutique
function viewShop() {
  const s = S.settings();
  shell('boutique', 'Boutique', `<div class="adm-grid">
    <section class="panel"><h2>Prise de commandes</h2>
      <form id="shop-open" class="form">
        <label class="check"><span class="switch"><input type="checkbox" name="ouverte"${s.boutiqueOuverte ? ' checked' : ''}><span></span></span> Commandes ouvertes</label>
        <div class="field"><label for="sh-msg">Message affiché quand les commandes sont suspendues</label><textarea id="sh-msg" name="message" rows="3">${esc(s.messageFermeture)}</textarea></div>
        <p class="hint">Suspendues : le site reste visible, les parfums peuvent être mis au panier, mais le paiement est bloqué et ce message s'affiche dans le panier et sur la page de commande.</p>
        <button class="btn" type="submit">Enregistrer</button></form></section>
    <section class="panel"><h2>Bandeau d'information</h2>
      <form id="shop-bar" class="form">
        <label class="check"><span class="switch"><input type="checkbox" name="actif"${s.bandeau.actif ? ' checked' : ''}><span></span></span> Afficher le bandeau en haut du site</label>
        <div class="field"><label for="bar-t">Texte</label><input id="bar-t" name="texte" maxlength="120" value="${esc(s.bandeau.texte)}" placeholder="ex. Fermeture de l'atelier du 24 au 26 décembre"></div>
        <div class="field"><label for="bar-l">Lien <span class="opt">(facultatif : /page/ ou https://…)</span></label><input id="bar-l" name="lien" value="${esc(s.bandeau.lien)}" placeholder="/livraison-retours/"></div>
        <div class="bar-preview" aria-hidden="true"><span class="info-bar">${esc(s.bandeau.texte || 'Aperçu du bandeau')}</span></div>
        <p class="hint">Pour une information pratique (fermeture, délais). N'y annoncez une offre que si elle est réellement appliquée.</p>
        <button class="btn" type="submit">Enregistrer</button></form></section>
    <section class="panel"><h2>Stock</h2>
      <form id="shop-stock" class="form">
        <label class="check"><input type="checkbox" name="decompte"${s.decompterStock ? ' checked' : ''}> Décompter le stock quand je valide une commande (et le remettre en cas d'annulation)</label>
        <div class="field"><label for="st-seuil">Alerte de stock bas à partir de</label><input id="st-seuil" name="seuil" type="number" min="0" step="1" value="${s.seuilStock}"></div>
        <button class="btn" type="submit">Enregistrer</button></form></section>
    <section class="panel"><h2>Livraison</h2>
      <p>France : <strong>offerte</strong>, expédition en 24/48 h.</p>
      <p class="muted">Ces conditions sont inscrites dans les pages du site (fiches, panier, FAQ). Pour les modifier, il faut changer la configuration puis régénérer le site.</p></section>
    <section class="panel panel--wide"><h2>Fichiers du site</h2>
      <ul class="rank">
        <li><span>Flux produits Google Merchant Center</span><a class="h-more" href="/flux/google-merchant.xml" target="_blank" rel="noopener">Ouvrir</a></li>
        <li><span>Plan du site (sitemap)</span><a class="h-more" href="/sitemap.xml" target="_blank" rel="noopener">Ouvrir</a></li>
        <li><span>Consignes aux moteurs de recherche (robots.txt)</span><a class="h-more" href="/robots.txt" target="_blank" rel="noopener">Ouvrir</a></li>
        <li><span>Redirections de l'ancien site (CSV)</span><a class="h-more" href="/redirections/redirections.csv" target="_blank" rel="noopener">Ouvrir</a></li>
      </ul></section>
  </div>`);
  $('#shop-open').addEventListener('submit', (e) => { e.preventDefault(); const o = e.target.ouverte.checked; S.saveSettings({ boutiqueOuverte: o, messageFermeture: e.target.message.value.trim() || 'Les commandes sont momentanément suspendues.' }, o ? 'Commandes ouvertes' : 'Commandes suspendues'); viewShop(); toast(o ? 'Commandes ouvertes.' : 'Commandes suspendues sur le site.'); });
  $('#bar-t').addEventListener('input', (e) => { $('.bar-preview .info-bar').textContent = e.target.value || 'Aperçu du bandeau'; });
  $('#shop-bar').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements, lien = f.lien.value.trim();
    if (lien && !/^(\/|https:\/\/)/.test(lien)) { toast('Le lien doit commencer par / ou https://'); return; }
    if (f.actif.checked && !f.texte.value.trim()) { toast('Indiquez le texte du bandeau.'); return; }
    S.saveSettings({ bandeau: { actif: f.actif.checked, texte: f.texte.value.trim(), lien } }, f.actif.checked ? 'Bandeau affiché' : 'Bandeau masqué');
    viewShop(); toast('Bandeau enregistré.');
  });
  $('#shop-stock').addEventListener('submit', (e) => { e.preventDefault(); S.saveSettings({ decompterStock: e.target.decompte.checked, seuilStock: Math.max(0, Number(e.target.seuil.value) || 0) }, 'Réglages de stock modifiés'); toast('Réglages de stock enregistrés.'); });
}

// ---------------------------------------------------------------- Historique
function viewHistory() {
  const list = S.db().activite || [];
  shell('historique', 'Historique', `<section class="panel">${list.length ? `<ul class="feed feed--log">${list.map((a) => `<li><time>${fmtDate(a.date, true)}</time><span class="fd">${esc(a.texte)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune action enregistrée.</p>'}</section>
    <p class="adm-note">Les 300 dernières actions faites dans l'administration (statuts, produits, codes, réglages).</p>`);
}

// ---------------------------------------------------------------- Recherche
function viewSearch() {
  const q = (new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '').toLowerCase().trim();
  const d = S.db();
  const has = (...v) => v.join(' ').toLowerCase().includes(q);
  const orders = d.orders.filter((o) => has(o.numero, o.client, o.email, o.telephone, o.code || '', o.suivi?.numero || '', o.lignes.map((l) => l.nom).join(' ')));
  const users = d.users.filter((u) => has(u.prenom, u.nom, u.email, u.telephone));
  const msgs = d.messages.filter((m) => has(m.nom, m.email, m.sujet, m.message));
  const codes = d.coupons.filter((c) => has(c.code, c.note || ''));
  shell('recherche', `Résultats pour « ${esc(q)} »`, `
    ${!orders.length && !users.length && !msgs.length && !codes.length ? '<section class="panel"><p class="muted">Aucun résultat.</p></section>' : ''}
    ${orders.length ? `<section class="panel"><h2>Commandes (${orders.length})</h2>${ordersTable(orders)}</section>` : ''}
    ${users.length ? `<section class="panel"><h2>Clients (${users.length})</h2><ul class="rank">${users.map((u) => `<li><a href="#client/${u.id}">${esc(u.prenom)} ${esc(u.nom)}</a><small>${esc(u.email)}</small></li>`).join('')}</ul></section>` : ''}
    ${msgs.length ? `<section class="panel"><h2>Messages (${msgs.length})</h2><ul class="rank">${msgs.map((m) => `<li><a href="#message/${m.id}">${esc(m.sujet)}</a><small>${esc(m.nom)}</small></li>`).join('')}</ul></section>` : ''}
    ${codes.length ? `<section class="panel"><h2>Codes promo (${codes.length})</h2><ul class="rank">${codes.map((c) => `<li><a href="#codes?modifier=${c.id}">${esc(c.code)}</a></li>`).join('')}</ul></section>` : ''}`);
}

// ---------------------------------------------------------------- Réglages
function viewSettings() {
  const s = S.settings();
  shell('reglages', 'Réglages', `<div class="adm-grid">
    <section class="panel"><h2>Paiement (Stripe)</h2><form id="set-stripe" class="form">
      <div class="field"><label for="set-mode">Mode</label><select id="set-mode" name="mode"><option value="test"${s.stripeMode === 'test' ? ' selected' : ''}>Test</option><option value="live"${s.stripeMode === 'live' ? ' selected' : ''}>Production</option></select></div>
      <div class="field"><label for="set-pk">Clé publique (pk_…)</label><input id="set-pk" name="pk" value="${esc(s.stripePublicKey)}" placeholder="pk_test_…" autocomplete="off"></div>
      <p class="hint">La clé secrète (sk_…) ne doit jamais être saisie ici : elle se configure uniquement sur le serveur. Le paiement reste désactivé tant que le serveur Stripe n'est pas en place.</p>
      <button class="btn" type="submit">Enregistrer</button></form></section>
    <section class="panel"><h2>Mot de passe administrateur</h2><form id="set-pass" class="form">
      <div class="field"><label for="set-p1">Nouveau mot de passe</label><input id="set-p1" type="password" autocomplete="new-password"></div>
      <button class="btn" type="submit">Modifier</button></form></section>
    <section class="panel"><h2>Données</h2>
      <p class="muted">Sauvegardez ou restaurez les comptes, commandes et réglages de démonstration.</p>
      <p style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn--ghost" type="button" data-export>Exporter (JSON)</button><label class="btn btn--ghost">Importer<input type="file" accept="application/json" data-import hidden></label></p>
      <p><button class="linklike danger" type="button" data-clear-customers>Vider les clients et les commandes</button> <span class="muted" style="font-size:.82rem">(comptes, commandes avec ou sans compte, e-mails et messages ; parfums, stocks, codes et réglages conservés)</span></p>
      <p><button class="linklike danger" type="button" data-reset-all>Réinitialiser les données de démonstration</button></p></section>
  </div>`);
  $('#set-stripe').addEventListener('submit', (e) => {
    e.preventDefault();
    const pk = e.target.pk.value.trim();
    if (pk && !/^pk_(test|live)_/.test(pk)) { toast('La clé publique Stripe commence par pk_test_ ou pk_live_.'); return; }
    if (/^sk_/.test(pk)) { toast('Ne saisissez jamais une clé secrète ici.'); return; }
    S.saveSettings({ stripeMode: e.target.mode.value, stripePublicKey: pk }, 'Réglages Stripe modifiés'); toast('Réglages Stripe enregistrés.');
  });
  $('#set-pass').addEventListener('submit', async (e) => { e.preventDefault(); const p = $('#set-p1').value; if (p.length < 8) { toast('8 caractères minimum.'); return; } await S.setAdminPassword(p); S.logAdmin('Mot de passe administrateur modifié'); $('#set-p1').value = ''; toast('Mot de passe modifié.'); });
  $('[data-export]').addEventListener('click', () => download('mercura-donnees.json', S.exportData(), 'application/json'));
  $('[data-import]').addEventListener('change', async (e) => { try { S.importData(await e.target.files[0].text()); toast('Données importées.'); } catch (err) { toast(err.message); } });
  $('[data-clear-customers]').addEventListener('click', () => {
    if (!confirm('Supprimer définitivement tous les comptes clients, toutes les commandes (avec ou sans compte) et tous les messages ? Les parfums, stocks, codes promo et réglages sont conservés.')) return;
    const n = S.clearCustomers(); toast(`Vidé : ${n.users} compte(s), ${n.orders} commande(s), ${n.messages} message(s).`);
  });
  $('[data-reset-all]').addEventListener('click', () => { if (confirm('Supprimer toutes les commandes, comptes clients et modifications de produits de démonstration ?')) { S.resetDemo(); toast('Données réinitialisées.'); } });
}

// ---------------------------------------------------------------- Outils
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toast(msg, href) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = href ? `<a href="${esc(href)}">${esc(msg)} →</a>` : esc(msg);
  t.classList.toggle('toast--link', !!href);
  t.classList.add('is-visible');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('is-visible'), href ? 8000 : 3000);
}

function render() {
  if (!S.adminLogged()) { renderLogin(); return; }
  const h = (location.hash || '#tableau').slice(1).split('?')[0];
  if (h.startsWith('commande/')) return viewOrder(h.split('/')[1]);
  if (h.startsWith('client/')) return viewClient(h.split('/')[1]);
  if (h.startsWith('message/')) return viewMessage(h.split('/')[1]);
  ({ tableau: viewDashboard, flux: viewFlux, commandes: viewOrders, produits: viewProducts, clients: viewClients, codes: viewCodes, messages: viewMessages, boutique: viewShop, reglages: viewSettings, historique: viewHistory, recherche: viewSearch }[h] || viewDashboard)();
  document.title = `${$('.adm-head h1')?.textContent || 'Administration'} | Mercura admin`;
}
addEventListener('hashchange', render);
// Mise à jour en direct : la boutique ouverte dans un autre onglet écrit dans le même stockage.
const currentView = () => (location.hash || '#tableau').slice(1).split('?')[0];
let known = { orders: S.db().orders.length, messages: S.db().messages.length };
addEventListener('storage', (e) => {
  if (!S.adminLogged()) return;
  if (e.key === 'mercura_db_v1') {
    // Notification des nouvelles commandes et des nouveaux messages arrivés depuis la boutique.
    const d = S.db();
    if (d.orders.length > known.orders) toast(`Nouvelle commande ${d.orders[0].numero} · ${fmtPrice(d.orders[0].total)}`, `#commande/${d.orders[0].id}`);
    else if (d.messages.length > known.messages) toast(`Nouveau message de ${d.messages[0].nom}`, `#message/${d.messages[0].id}`);
    known = { orders: d.orders.length, messages: d.messages.length };
  }
  if (document.activeElement?.closest('form')) return;
  if (e.key === 'mercura_journal_v1' && currentView() === 'flux') render();
  if (e.key === 'mercura_db_v1' && ['tableau', 'commandes', 'clients', 'messages', 'produits', 'codes'].includes(currentView())) render();
});
setInterval(() => { if (S.adminLogged() && currentView() === 'flux' && !document.hidden) viewFlux(); }, 30000);
document.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a, input, label, button, .chk')) location.hash = tr.dataset.href; });
render();
