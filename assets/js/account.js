// MERCURA — espace client (démonstration, données dans le navigateur).
import { esc, fmtPrice, ICONS } from './shared.js';
import { register, login, logout, currentUser, updateUser, changePassword, ordersFor, db, ORDER_STATUSES, trackUrl } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const COUNTRIES = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return { of: (c) => c }; } })();
const statusBadge = (s) => `<span class="st st--${s}">${esc(ORDER_STATUSES[s] || s)}</span>`;

function fieldErr(form, name, msg) {
  const el = form.elements[name];
  const err = form.querySelector(`[data-err="${name}"]`);
  el.setAttribute('aria-invalid', !!msg);
  if (err) { err.hidden = !msg; err.textContent = msg || ''; }
  return !msg;
}
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// ---------------------------------------------------------------- Connexion / inscription
function initConnexion() {
  const root = $('#auth-root');
  if (!root) return;
  const back = new URLSearchParams(location.search).get('retour');
  const dest = back && back.startsWith('/') ? back : '/compte/';
  if (currentUser()) { location.replace(dest); return; }

  const lf = $('#login-form'), rf = $('#register-form');
  lf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = [fieldErr(lf, 'email', validEmail(lf.elements.email.value) ? '' : 'Indiquez une adresse e-mail valide.'), fieldErr(lf, 'password', lf.elements.password.value ? '' : 'Indiquez votre mot de passe.')].every(Boolean);
    const msg = $('[data-msg]', lf);
    if (!ok) { msg.className = 'form-msg err'; msg.textContent = 'Vérifiez les champs indiqués.'; return; }
    try { await login(lf.elements.email.value, lf.elements.password.value); location.href = dest; }
    catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  });
  rf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = rf.elements;
    const ok = [
      fieldErr(rf, 'prenom', f.prenom.value.trim() ? '' : 'Indiquez votre prénom.'),
      fieldErr(rf, 'nom', f.nom.value.trim() ? '' : 'Indiquez votre nom.'),
      fieldErr(rf, 'email', validEmail(f.email.value) ? '' : 'Indiquez une adresse e-mail valide.'),
      fieldErr(rf, 'password', f.password.value.length >= 8 ? '' : 'Le mot de passe doit contenir au moins 8 caractères.')
    ].every(Boolean);
    const msg = $('[data-msg]', rf);
    if (!ok) { msg.className = 'form-msg err'; msg.textContent = 'Vérifiez les champs indiqués.'; return; }
    try { await register({ prenom: f.prenom.value, nom: f.nom.value, email: f.email.value, password: f.password.value }); location.href = dest; }
    catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  });
}

// ---------------------------------------------------------------- Espace client
function orderRows(orders) {
  if (!orders.length) return `<div class="acc-empty"><p>Vous n'avez pas encore passé de commande.</p><a class="btn" href="/parfums/">Voir les parfums</a></div>`;
  return `<ul class="order-list">${orders.map((o) => `<li><a href="#commande/${o.id}">
    <span class="ol-num">${esc(o.numero)}</span>
    <span class="ol-date">${fmtDate(o.date)}</span>
    <span class="ol-items">${o.lignes.reduce((t, l) => t + l.qte, 0)} article${o.lignes.reduce((t, l) => t + l.qte, 0) > 1 ? 's' : ''}</span>
    ${statusBadge(o.statut)}
    <span class="ol-total">${fmtPrice(o.total)}</span>
  </a></li>`).join('')}</ul>`;
}
function orderDetail(o) {
  if (!o) return '<p>Commande introuvable.</p>';
  const a = o.adresse || {};
  return `<p><a class="h-more" href="#commandes">← Toutes mes commandes</a></p>
  <div class="od-head"><h2 class="h3">Commande ${esc(o.numero)}</h2>${statusBadge(o.statut)}</div>
  <p class="muted">Passée le ${fmtDate(o.date)}</p>
  <table class="od-table"><thead><tr><th>Parfum</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>
  ${o.lignes.map((l) => `<tr><td>${esc(l.nom)}</td><td>${l.qte}</td><td>${fmtPrice(l.prix)}</td><td>${fmtPrice(l.total)}</td></tr>`).join('')}
  </tbody><tfoot>${o.remise ? `<tr><td colspan="3">Dont réduction</td><td>−${fmtPrice(o.remise)}</td></tr>` : ''}${o.remiseCode ? `<tr><td colspan="3">Code ${esc(o.code)}</td><td>−${fmtPrice(o.remiseCode)}</td></tr>` : ''}<tr><td colspan="3">Livraison</td><td>${esc(o.livraison)}</td></tr><tr class="od-total"><td colspan="3">Total</td><td>${fmtPrice(o.total)}</td></tr></tfoot></table>
  <div class="od-grid"><div><h3 class="od-h">Livraison</h3><p>${esc(a.prenom)} ${esc(a.nom)}<br>${esc(a.ligne1)}${a.ligne2 ? '<br>' + esc(a.ligne2) : ''}<br>${esc(a.cp)} ${esc(a.ville)}<br>${esc(COUNTRIES.of(a.pays || 'FR'))}</p></div>
  <div><h3 class="od-h">Paiement</h3><p>${esc(o.paiement)}</p></div>
  ${o.suivi && o.suivi.numero ? `<div><h3 class="od-h">Suivi du colis</h3><p>${esc(o.suivi.transporteur)} · ${esc(o.suivi.numero)}${trackUrl(o.suivi) ? `<br><a class="h-more" href="${esc(trackUrl(o.suivi))}" target="_blank" rel="noopener">Suivre mon colis</a>` : ''}</p></div>` : ''}</div>`;
}

function renderAccount() {
  const root = $('#account-root');
  if (!root) return;
  const u = currentUser();
  if (!u) { location.replace('/compte/connexion/?retour=' + encodeURIComponent('/compte/')); return; }
  const route = (location.hash || '#tableau').slice(1);
  const orders = ordersFor(u);
  const tabs = [['tableau', 'Tableau de bord'], ['commandes', 'Mes commandes'], ['adresse', 'Mon adresse'], ['profil', 'Mon profil']];
  const active = route.startsWith('commande/') ? 'commandes' : route;
  let content = '';
  if (route === 'tableau') {
    content = `<h2 class="h3">Bonjour ${esc(u.prenom)}</h2>
    <p class="muted">Depuis votre espace, suivez vos commandes et gérez vos informations.</p>
    <div class="acc-cards">
      <a class="acc-card" href="#commandes"><strong>${orders.length}</strong><span>commande${orders.length > 1 ? 's' : ''}</span></a>
      <a class="acc-card" href="#adresse"><strong>${u.adresse ? '✓' : '—'}</strong><span>${u.adresse ? 'adresse enregistrée' : 'aucune adresse'}</span></a>
      <a class="acc-card" href="#profil"><strong>${esc(u.prenom.charAt(0))}${esc(u.nom.charAt(0))}</strong><span>${esc(u.email)}</span></a>
    </div>
    <h3 class="od-h" style="margin-top:36px">Dernières commandes</h3>${orderRows(orders.slice(0, 3))}`;
  } else if (route === 'commandes') {
    content = `<h2 class="h3">Mes commandes</h2>${orderRows(orders)}`;
  } else if (route.startsWith('commande/')) {
    content = orderDetail(orders.find((o) => o.id === route.split('/')[1]));
  } else if (route === 'adresse') {
    const a = u.adresse || {};
    content = `<h2 class="h3">Mon adresse de livraison</h2>
    <form class="form acc-form" id="addr-form" novalidate>
      <div class="form-row"><div class="field"><label for="a-prenom">Prénom</label><input id="a-prenom" name="prenom" value="${esc(a.prenom || u.prenom)}" autocomplete="given-name"></div><div class="field"><label for="a-nom">Nom</label><input id="a-nom" name="nom" value="${esc(a.nom || u.nom)}" autocomplete="family-name"></div></div>
      <div class="field"><label for="a-l1">Adresse</label><input id="a-l1" name="ligne1" value="${esc(a.ligne1 || '')}" autocomplete="address-line1"></div>
      <div class="field"><label for="a-l2">Complément <span class="opt">(facultatif)</span></label><input id="a-l2" name="ligne2" value="${esc(a.ligne2 || '')}" autocomplete="address-line2"></div>
      <div class="form-row"><div class="field"><label for="a-cp">Code postal</label><input id="a-cp" name="cp" value="${esc(a.cp || '')}" autocomplete="postal-code"></div><div class="field"><label for="a-ville">Ville</label><input id="a-ville" name="ville" value="${esc(a.ville || '')}" autocomplete="address-level2"></div></div>
      <div class="field"><label for="a-tel">Téléphone</label><input id="a-tel" name="telephone" type="tel" value="${esc(u.telephone || '')}" autocomplete="tel"></div>
      <div><button class="btn" type="submit">Enregistrer</button></div><p class="form-msg" data-msg role="status"></p>
    </form>`;
  } else if (route === 'profil') {
    content = `<h2 class="h3">Mon profil</h2>
    <form class="form acc-form" id="profile-form" novalidate>
      <div class="form-row"><div class="field"><label for="p-prenom">Prénom</label><input id="p-prenom" name="prenom" value="${esc(u.prenom)}"></div><div class="field"><label for="p-nom">Nom</label><input id="p-nom" name="nom" value="${esc(u.nom)}"></div></div>
      <div class="field"><label for="p-email">E-mail</label><input id="p-email" value="${esc(u.email)}" disabled></div>
      <div><button class="btn" type="submit">Enregistrer</button></div><p class="form-msg" data-msg role="status"></p>
    </form>
    <h3 class="od-h" style="margin-top:40px">Changer de mot de passe</h3>
    <form class="form acc-form" id="pass-form" novalidate>
      <div class="form-row"><div class="field"><label for="p-old">Mot de passe actuel</label><input id="p-old" name="old" type="password" autocomplete="current-password"></div><div class="field"><label for="p-new">Nouveau mot de passe</label><input id="p-new" name="neu" type="password" autocomplete="new-password"></div></div>
      <div><button class="btn btn--ghost" type="submit">Modifier le mot de passe</button></div><p class="form-msg" data-msg role="status"></p>
    </form>`;
  }
  root.innerHTML = `<div class="acc-layout">
    <nav class="acc-nav" aria-label="Espace client">${tabs.map(([k, l]) => `<a href="#${k}"${k === active ? ' aria-current="page"' : ''}>${l}</a>`).join('')}<button type="button" class="linklike" data-logout>Se déconnecter</button></nav>
    <div class="acc-main">${content}</div>
  </div>`;

  const ok = (form, text) => { const m = $('[data-msg]', form); m.className = 'form-msg ok'; m.textContent = text; };
  const ko = (form, text) => { const m = $('[data-msg]', form); m.className = 'form-msg err'; m.textContent = text; };
  $('#addr-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (!f.ligne1.value.trim() || !f.cp.value.trim() || !f.ville.value.trim()) return ko(e.target, 'Adresse, code postal et ville sont nécessaires.');
    updateUser(u.id, { telephone: f.telephone.value.trim(), adresse: { prenom: f.prenom.value.trim(), nom: f.nom.value.trim(), ligne1: f.ligne1.value.trim(), ligne2: f.ligne2.value.trim(), cp: f.cp.value.trim(), ville: f.ville.value.trim(), pays: (u.adresse && u.adresse.pays) || 'FR' } });
    ok(e.target, 'Adresse enregistrée. Elle sera proposée lors de votre prochaine commande.');
  });
  $('#profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (!f.prenom.value.trim() || !f.nom.value.trim()) return ko(e.target, 'Prénom et nom sont nécessaires.');
    updateUser(u.id, { prenom: f.prenom.value.trim(), nom: f.nom.value.trim() });
    ok(e.target, 'Profil mis à jour.');
  });
  $('#pass-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.neu.value.length < 8) return ko(e.target, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
    try { await changePassword(u.id, f.old.value, f.neu.value); f.old.value = f.neu.value = ''; ok(e.target, 'Mot de passe modifié.'); }
    catch (err) { ko(e.target, err.message); }
  });
  $('[data-logout]', root).addEventListener('click', () => { logout(); location.href = '/'; });
}

// ---------------------------------------------------------------- Confirmation de commande
function renderConfirmation() {
  const root = $('#confirm-root');
  if (!root) return;
  const n = new URLSearchParams(location.search).get('n');
  const o = db().orders.find((x) => x.numero === n);
  if (!o) { root.innerHTML = '<p>Aucune commande à afficher.</p><p><a class="btn" href="/parfums/">Voir les parfums</a></p>'; return; }
  const u = currentUser();
  root.innerHTML = o.canal === 'whatsapp'
    ? `<div class="wa-confirm">
    <p class="lead">Merci ${esc(o.adresse.prenom)}. Votre commande <strong>${esc(o.numero)}</strong> est prête dans WhatsApp.</p>
    <p><strong>Dernière étape : envoyez le message</strong> dans WhatsApp pour nous la transmettre. Nous vous répondons pour confirmer la disponibilité et les modalités de règlement, puis nous expédions votre colis.</p>
    <p><a class="btn btn--wa" href="${esc(o.whatsappUrl || '#')}" target="_blank" rel="noopener">${ICONS.whatsapp} Ouvrir WhatsApp</a></p>
    <p class="hint">WhatsApp ne s'est pas ouvert ? Utilisez le bouton ci-dessus. Aucun paiement n'a été demandé sur le site.</p>
  </div>`
    : `<div class="notice" role="note" style="margin-bottom:28px"><p><strong>Commande test enregistrée.</strong> Le paiement n'est pas encore relié : aucune somme n'a été débitée.</p></div>
  <p class="lead" style="margin-bottom:28px">Merci ${esc(o.adresse.prenom)}. Votre commande <strong>${esc(o.numero)}</strong> a bien été enregistrée.</p>`;
  root.innerHTML += `
  ${orderDetail(o).replace(/<p><a class="h-more" href="#commandes">.*?<\/p>/, '')}
  <p class="h-actions" style="margin-top:32px;display:flex;gap:14px 24px;flex-wrap:wrap;align-items:center">${u ? '<a class="btn" href="/compte/#commandes">Suivre ma commande</a>' : '<a class="btn" href="/compte/connexion/">Créer un compte pour suivre mes commandes</a>'}<a class="h-more" href="/parfums/">Continuer mes achats</a></p>`;
}

initConnexion();
renderAccount();
renderConfirmation();
addEventListener('hashchange', renderAccount);
document.addEventListener('mercura:db', () => { if (!document.activeElement || !document.activeElement.closest('form')) renderAccount(); });
