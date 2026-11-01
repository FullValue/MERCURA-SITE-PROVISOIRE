// MERCURA — couche de données de démonstration (navigateur).
// Toutes les fonctions de ce module sont les « points de connexion » à remplacer par une
// vraie API serveur (comptes, commandes, produits) et Stripe (paiement) à la mise en ligne.
// Rien n'est envoyé sur Internet : les données restent dans le navigateur (localStorage).

const DB_KEY = 'mercura_db_v1';
const SESSION_KEY = 'mercura_session_v1';
const ADMIN_KEY = 'mercura_admin_session_v1';

export const ORDER_STATUSES = {
  test: 'Test (non payée)',
  attente: 'En attente de paiement',
  payee: 'Payée',
  preparation: 'En préparation',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée'
};

const DEFAULT_SETTINGS = {
  livraisonFranceOfferte: true, delaiFrance: '24/48 h', stripeMode: 'test', stripePublicKey: '',
  boutiqueOuverte: true, messageFermeture: 'Les commandes sont momentanément suspendues. Elles reprendront très prochainement.',
  bandeau: { actif: false, texte: '', lien: '' },
  seuilStock: 5, decompterStock: true
};
function empty() {
  return { version: 2, users: [], orders: [], products: {}, coupons: [], messages: [], activite: [], settings: structuredClone(DEFAULT_SETTINGS), adminHash: null, seq: 0 };
}
export function db() {
  try {
    const d = Object.assign(empty(), JSON.parse(localStorage.getItem(DB_KEY) || 'null') || {});
    d.settings = { ...structuredClone(DEFAULT_SETTINGS), ...d.settings };
    if ((d.version || 1) < 2) {
      // Mise à jour : les commandes non validées ne retiennent plus de stock (il était décompté à l'envoi).
      d.orders.forEach((o) => {
        if (o.stockDecompte && !['payee', 'preparation', 'expediee', 'livree'].includes(o.statut)) {
          o.lignes.forEach((l) => { const p = d.products[l.id]; if (p && p.stock != null) p.stock += l.qte; });
          o.stockDecompte = false;
        }
      });
      d.version = 2;
      try { localStorage.setItem(DB_KEY, JSON.stringify(d)); } catch { /* */ }
    }
    return d;
  } catch { return empty(); }
}
function save(d) {
  localStorage.setItem(DB_KEY, JSON.stringify(d));
  document.dispatchEvent(new CustomEvent('mercura:db'));
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mercura:' + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- Clients
export async function register({ prenom, nom, email, password }) {
  const d = db();
  email = email.trim().toLowerCase();
  if (d.users.some((u) => u.email === email)) throw new Error('Un compte existe déjà avec cette adresse e-mail.');
  const user = { id: uid(), prenom: prenom.trim(), nom: nom.trim(), email, pass: await hash(password), cree: new Date().toISOString(), adresse: null, telephone: '' };
  d.users.push(user);
  save(d);
  sessionStorage.setItem(SESSION_KEY, user.id);
  localStorage.setItem(SESSION_KEY, user.id);
  return user;
}
export async function login(email, password) {
  const d = db();
  const u = d.users.find((x) => x.email === email.trim().toLowerCase());
  if (!u || u.pass !== await hash(password)) throw new Error('E-mail ou mot de passe incorrect.');
  localStorage.setItem(SESSION_KEY, u.id);
  return u;
}
export function logout() { localStorage.removeItem(SESSION_KEY); }
export function currentUser() {
  const id = localStorage.getItem(SESSION_KEY);
  return id ? db().users.find((u) => u.id === id) || null : null;
}
export function updateUser(id, patch) {
  const d = db();
  const u = d.users.find((x) => x.id === id);
  if (!u) return null;
  Object.assign(u, patch);
  save(d);
  return u;
}
export async function changePassword(id, oldPass, newPass) {
  const d = db();
  const u = d.users.find((x) => x.id === id);
  if (!u || u.pass !== await hash(oldPass)) throw new Error('Mot de passe actuel incorrect.');
  u.pass = await hash(newPass);
  save(d);
}

// ---------------------------------------------------------------- Commandes
// `stocks` : stock actuel de chaque parfum commandé ({ id: quantité }), pour le décompte automatique.
export function createOrder(order, stocks = {}) {
  const d = db();
  d.seq = (d.seq || 0) + 1;
  // Commande WhatsApp : demande réelle « En attente » ; sinon commande test de démonstration.
  const statut = order.statut || 'test';
  const prefix = order.canal === 'whatsapp' ? 'MRC-' : 'MRC-TEST-';
  const o = { id: uid(), numero: prefix + String(d.seq).padStart(4, '0'), date: new Date().toISOString(), notes: [], suivi: null, ...order, statut, historique: [{ date: new Date().toISOString(), statut }] };
  // Le stock n'est pas touché ici : il est décompté quand Mercura valide la commande (voir setOrderStatus).
  o.stockDecompte = false;
  if (o.code) { o.code = normCode(o.code); const c = d.coupons.find((x) => x.code === o.code); if (c) c.usages = (c.usages || 0) + 1; }
  d.orders.unshift(o);
  save(d);
  return o;
}
export function ordersFor(user) {
  return db().orders.filter((o) => o.userId === user.id || o.email === user.email);
}
// Statuts d'une commande réellement validée par Mercura (paiement reçu) : le stock est alors décompté.
export const CONFIRMED = ['payee', 'preparation', 'expediee', 'livree'];
// `stocks` : { id: { cur: stock actuel, base: stock du catalogue } }, fourni par l'admin.
function moveStock(d, o, sign, stocks = {}) {
  o.lignes.forEach((l) => {
    const s = stocks[l.id];
    if (!s || s.cur == null) return;
    d.products[l.id] = { ...(d.products[l.id] || {}), stock: Math.max(0, Number(s.cur) + sign * l.qte), stockModifie: true, stockRef: s.base };
  });
}
// `stocks` : stock actuel de chaque parfum ({ id: quantité }), fourni par l'admin depuis le catalogue.
export function setOrderStatus(id, statut, d = db(), stocks = {}) {
  const o = d.orders.find((x) => x.id === id);
  if (!o || o.statut === statut) return;
  if (!o.stockDecompte && CONFIRMED.includes(statut) && d.settings.decompterStock) { moveStock(d, o, -1, stocks); o.stockDecompte = true; }
  else if (o.stockDecompte && !CONFIRMED.includes(statut)) { moveStock(d, o, 1, stocks); o.stockDecompte = false; }
  o.statut = statut;
  (o.historique = o.historique || []).push({ date: new Date().toISOString(), statut });
  logIn(d, `Commande ${o.numero} : statut « ${ORDER_STATUSES[statut]} »`);
  save(d);
}
// Transporteurs proposés pour le suivi des colis, avec la page de suivi publique de chacun.
export const CARRIERS = {
  'Colissimo': (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}`,
  'Chronopost': (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(n)}`,
  'Mondial Relay': () => 'https://www.mondialrelay.fr/suivi-de-colis/',
  'DHL': (n) => `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${encodeURIComponent(n)}`,
  'UPS': (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  'Autre': () => ''
};
export const trackUrl = (s) => s && s.numero && CARRIERS[s.transporteur] ? CARRIERS[s.transporteur](s.numero) : '';
export function setOrdersStatus(ids, statut, stocks = {}) {
  const d = db();
  ids.forEach((id) => setOrderStatus(id, statut, d, stocks));
  save(d);
}
export function updateOrder(id, patch, label) {
  const d = db();
  const o = d.orders.find((x) => x.id === id);
  if (!o) return;
  Object.assign(o, patch);
  if (label) logIn(d, `Commande ${o.numero} : ${label}`);
  save(d);
}
export function addOrderNote(id, texte) {
  const d = db();
  const o = d.orders.find((x) => x.id === id);
  if (!o) return;
  (o.notes = o.notes || []).push({ date: new Date().toISOString(), texte });
  save(d);
}
export function deleteOrder(id) {
  const d = db();
  const o = d.orders.find((x) => x.id === id);
  d.orders = d.orders.filter((x) => x.id !== id);
  if (o) logIn(d, `Commande ${o.numero} supprimée`);
  save(d);
}
export function deleteOrders(ids) {
  const d = db();
  const gone = d.orders.filter((x) => ids.includes(x.id));
  d.orders = d.orders.filter((x) => !ids.includes(x.id));
  if (gone.length) logIn(d, gone.length > 1 ? `${gone.length} commandes supprimées (${gone.map((o) => o.numero).join(', ')})` : `Commande ${gone[0].numero} supprimée`);
  save(d);
}
export function deleteUser(id) {
  const d = db();
  const u = d.users.find((x) => x.id === id);
  d.users = d.users.filter((x) => x.id !== id);
  d.orders.forEach((o) => { if (o.userId === id) o.userId = null; });
  if (u) logIn(d, `Compte client ${u.email} supprimé`);
  save(d);
}

// ---------------------------------------------------------------- Codes promo
export const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
export function coupons() { return db().coupons; }
export function saveCoupon(c) {
  const d = db();
  c.code = normCode(c.code);
  if (!/^[A-Z0-9_-]{3,20}$/.test(c.code)) throw new Error('Le code doit contenir 3 à 20 lettres, chiffres, tirets.');
  if (d.coupons.some((x) => x.code === c.code && x.id !== c.id)) throw new Error('Ce code existe déjà.');
  const i = d.coupons.findIndex((x) => x.id === c.id);
  if (i >= 0) d.coupons[i] = { ...d.coupons[i], ...c };
  else d.coupons.unshift({ id: uid(), usages: 0, cree: new Date().toISOString(), ...c });
  logIn(d, `Code promo ${c.code} ${i >= 0 ? 'modifié' : 'créé'}`);
  save(d);
}
export function deleteCoupon(id) {
  const d = db();
  const c = d.coupons.find((x) => x.id === id);
  d.coupons = d.coupons.filter((x) => x.id !== id);
  if (c) logIn(d, `Code promo ${c.code} supprimé`);
  save(d);
}
// Vérifie un code pour un sous-total donné et calcule la remise.
export function checkCoupon(code, subtotal) {
  const c = db().coupons.find((x) => x.code === normCode(code));
  const today = new Date().toISOString().slice(0, 10);
  if (!c || !c.actif) return { ok: false, msg: 'Ce code n\'est pas valable.' };
  if (c.debut && today < c.debut) return { ok: false, msg: 'Ce code n\'est pas encore valable.' };
  if (c.fin && today > c.fin) return { ok: false, msg: 'Ce code a expiré.' };
  if (c.usagesMax && (c.usages || 0) >= c.usagesMax) return { ok: false, msg: 'Ce code a atteint son nombre maximal d\'utilisations.' };
  if (c.minimum && subtotal < c.minimum) return { ok: false, msg: `Ce code est valable dès ${c.minimum} € d'achat.` };
  const remise = Math.min(subtotal, c.type === 'pct' ? Math.round(subtotal * c.valeur) / 100 : Number(c.valeur));
  return { ok: true, coupon: c, remise };
}

// ---------------------------------------------------------------- Messages (formulaire de contact)
export function addMessage(m) {
  const d = db();
  d.messages.unshift({ id: uid(), date: new Date().toISOString(), lu: false, archive: false, ...m });
  save(d);
}
export function updateMessage(id, patch) {
  const d = db();
  const m = d.messages.find((x) => x.id === id);
  if (m) Object.assign(m, patch);
  save(d);
}
export function deleteMessage(id) { const d = db(); d.messages = d.messages.filter((x) => x.id !== id); save(d); }

// ---------------------------------------------------------------- Historique des actions de l'administration
function logIn(d, texte) {
  d.activite = [{ date: new Date().toISOString(), texte }, ...(d.activite || [])].slice(0, 300);
}
export function logAdmin(texte) { const d = db(); logIn(d, texte); save(d); }

// ---------------------------------------------------------------- Produits (surcharges administrées)
export function productOverrides() { return db().products || {}; }
export function setProductOverride(id, patch, nom) {
  const d = db();
  d.products[id] = Object.assign({}, d.products[id], patch);
  if (nom) logIn(d, `Produit ${nom} modifié`);
  save(d);
}
export function resetProductOverride(id, nom) {
  const d = db();
  delete d.products[id];
  if (nom) logIn(d, `Produit ${nom} : valeurs d'origine rétablies`);
  save(d);
}
// Applique les surcharges de l'administration à un produit du catalogue.
export function applyOverrides(p) {
  const o = productOverrides()[p.id];
  if (!o) return p;
  if (o.prix != null) p.prix = Number(o.prix);
  if ('prixBarre' in o) p.prixBarre = o.prixBarre ? Number(o.prixBarre) : null;
  if (o.disponible != null) { p.enStock = !!o.disponible; p.achetable = !!o.disponible; }
  // Le stock de l'admin ne s'applique que s'il a été réellement modifié (les anciens enregistrements
  // automatiques du stock sont ignorés : le stock du catalogue fait foi).
  // stockRef = stock du catalogue au moment de la modification : si Mercura a depuis mis à jour le stock
  // du catalogue (data/editorial.json), c'est cette nouvelle valeur qui s'applique.
  if (o.stock != null && o.stockModifie && o.stockRef != null && Number(o.stockRef) === Number(p.stockMax)) {
    p.stockMax = Number(o.stock);
    if (o.stock === 0) { p.enStock = false; p.achetable = false; }
  }
  return p;
}

// ---------------------------------------------------------------- Réglages et administration
export function settings() { return db().settings; }
export function saveSettings(patch, label) { const d = db(); Object.assign(d.settings, patch); if (label) logIn(d, label); save(d); }
// Mot de passe de démonstration utilisé tant qu'aucun autre n'a été choisi (voir docs/ACCES-ADMIN.md).
// À supprimer à la mise en ligne : l'accès sera alors géré par le serveur.
const DEMO_ADMIN_PASSWORD = 'mercura2026';
// Comparaison souple pour le mot de passe de démonstration : majuscules, espaces, tirets et guillemets ignorés.
const loose = (s) => String(s || '').toLowerCase().replace(/[\s\-_'"`«»]/g, '');
export function adminConfigured() { return true; }
export function resetAdminPassword() { const d = db(); d.adminHash = null; logIn(d, 'Mot de passe administrateur réinitialisé'); save(d); }
export async function setAdminPassword(pass) { const d = db(); d.adminHash = await hash('admin:' + pass); save(d); sessionStorage.setItem(ADMIN_KEY, '1'); }
export async function adminLogin(pass) {
  // Le mot de passe de démonstration reste toujours accepté en prévisualisation.
  const demo = loose(pass) === loose(DEMO_ADMIN_PASSWORD);
  let custom = false;
  try { custom = !!db().adminHash && db().adminHash === await hash('admin:' + pass); } catch { /* chiffrement indisponible */ }
  if (!demo && !custom) throw new Error('Mot de passe incorrect.');
  sessionStorage.setItem(ADMIN_KEY, '1');
}
export function adminLogged() { return sessionStorage.getItem(ADMIN_KEY) === '1'; }
export function adminLogout() { sessionStorage.removeItem(ADMIN_KEY); }
export function exportData() { return JSON.stringify(db(), null, 2); }
export function importData(json) { const d = JSON.parse(json); if (!d || !Array.isArray(d.orders)) throw new Error('Fichier invalide.'); save(Object.assign(empty(), d)); }
// Vide les comptes clients, toutes les commandes (avec ou sans compte) et les messages reçus ;
// conserve produits, stocks, codes promo, réglages et mot de passe administrateur.
export function clearCustomers() {
  const d = db();
  const n = { users: d.users.length, orders: d.orders.length, messages: d.messages.length };
  d.users = []; d.orders = []; d.messages = [];
  logIn(d, `Clients et commandes vidés (${n.users} compte(s), ${n.orders} commande(s), ${n.messages} message(s))`);
  save(d);
  try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
  return n;
}
export function resetDemo() { const keep = db().adminHash; const d = empty(); d.adminHash = keep; save(d); }
