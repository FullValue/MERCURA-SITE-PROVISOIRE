// Fonctions partagées entre la génération des pages et le site.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPrice = (n) => (Number.isInteger(n) ? nf0 : nf2).format(n);

// Prix de vente, ancien prix barré et pourcentage de réduction.
export const discountPct = (p) => p.prixBarre && p.prixBarre > p.prix ? Math.round((1 - p.prix / p.prixBarre) * 100) : 0;
export function priceHTML(p, cls = 'price') {
  const pct = discountPct(p);
  return `<span class="${cls}" data-live-price="${p.id}">${fmtPrice(p.prix)}</span>${pct ? `<s class="price-old" data-live-old="${p.id}"><span class="visually-hidden">au lieu de </span>${fmtPrice(p.prixBarre)}</s><span class="price-off">−${pct} %</span>` : ''}`;
}

// Stock limité : quantité réelle de 3 flacons ou moins (renseignée par Mercura).
export const LOW_STOCK = 3;
export const lowStock = (p) => (p.enStock && p.stockMax > 0 && p.stockMax <= LOW_STOCK ? p.stockMax : 0);
const lowText = (n) => (n === 1 ? 'Dernier flacon disponible' : `Plus que ${n} flacons disponibles`);
export function stockLabel(p) {
  if (!p.enStock) return 'Plus disponible à la commande';
  const n = lowStock(p);
  return n ? `En stock<span class="stock-low">${lowText(n)}</span>` : 'En stock';
}
export const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export const productUrl = (p) => `/parfums/${p.slug}/`;
export const cardImage = (p) => (p.photos || []).find((i) => i.role === 'campagne') || (p.photos || []).find((i) => i.role === 'flacon') || (p.photos || [])[0] || null;
export const altFor = (p, role) => ({
  flacon: `Flacon de ${p.nom}, eau de parfum Mercura ${p.volumeMl} ml`,
  etui: `${p.nom} : flacon et étui, eau de parfum Mercura ${p.volumeMl} ml`,
  ambiance: `${p.nom}, flacon Mercura photographié sur fond coloré`,
  campagne: `${p.nom}, eau de parfum Mercura : mise en scène du flacon parmi ses notes`,
  dessus: `${p.nom}, flacon Mercura vu de dessus`
}[role] || p.nom);

export function picture(img, o = {}) {
  if (!img) return '';
  const srcset = img.widths.map((w) => `${img.base}-${w}.webp ${w}w`).join(', ');
  const h = Math.round(img.jpg / img.ratio);
  return `<picture${o.cls ? ` class="${o.cls}"` : ''}><source type="image/webp" srcset="${srcset}" sizes="${o.sizes || '100vw'}"><img src="${img.base}-${img.jpg}.jpg" width="${img.jpg}" height="${h}" alt="${esc(o.alt || '')}" loading="${o.loading || 'lazy'}" decoding="async"${o.priority ? ' fetchpriority="high"' : ''}></picture>`;
}

const svg = (body, vb = '0 0 24 24') => `<svg class="icon" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
export const ICONS = {
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
  bag: svg('<path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  menu: svg('<path d="M3 7h18M3 12h18M3 17h12"/>'),
  close: svg('<path d="M5 5l14 14M19 5 5 19"/>'),
  arrow: '<svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:18px;height:18px"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="1"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  mail: svg('<rect x="3" y="5.5" width="18" height="13" rx="1"/><path d="m3.5 6.5 8.5 7 8.5-7"/>'),
  phone: svg('<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5C10.6 18.4 5.6 13.4 5 5.1A1.5 1.5 0 0 1 6.5 3.5Z"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="9.5" ry="5.5" transform="rotate(-18 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="5.5" transform="rotate(18 12 12)"/>'),
  drop: svg('<path d="M12 3.5c3.5 4.4 5.5 7.6 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 11.1 8.5 7.9 12 3.5Z"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  whatsapp: '<svg class="icon icon--fill" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="none" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.91 9.91 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 8.23 8.24c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23a7.5 7.5 0 0 1-1.38-1.72c-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.12.16 1.75 2.67 4.24 3.75.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/></svg>',
  instagram: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6" fill="currentColor"/>'),
  tiktok: '<svg class="icon icon--fill" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="none" d="M16.6 3c.3 2.2 1.6 3.6 3.9 3.8v2.6a7 7 0 0 1-3.8-1.2v6.1a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1V11.5a2.9 2.9 0 1 0 2 2.8V3h2.6Z"/></svg>',
  user: svg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>')
};
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8 12.5 7l5.7.6-4.3 3.9 1.2 5.6L10 14.3l-5.1 2.8 1.2-5.6L1.8 7.6 7.5 7Z"/></svg>';
export function stars(n) {
  const r = Math.round(n);
  return `<span class="stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => STAR.replace('<svg', `<svg class="${i <= r ? 'on' : 'off'}"`)).join('')}</span>`;
}
export const fmtRating = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function notesLine(p, max = 4) {
  const all = [...p.notes.tete, ...p.notes.coeur, ...p.notes.fond];
  return all.slice(0, max).map(cap).join(' · ');
}

export function cardHTML(p, o = {}) {
  const main = cardImage(p);
  const alt = (p.photos || []).find((i) => i.role === 'texture' && i !== main)
    || (p.photos || []).find((i) => i.role === 'campagne' && i !== main)
    || (p.photos || []).find((i) => i.role === 'etui' && i !== main);
  const short = (arr) => arr.slice(0, 3).map(cap).join(', ');
  const sizes = '(min-width: 1000px) 23vw, (min-width: 700px) 30vw, 46vw';
  const heading = o.heading || 'h3';
  return `<li class="card" data-product-card data-id="${p.id}" data-name="${esc(p.nom)}" data-price="${p.prix}" data-order="${p.ordre}" data-stock="${p.achetable ? 1 : 0}" data-families="${p.familles.join(' ')}" data-search="${esc([p.nom, p.accroche, ...p.notes.tete, ...p.notes.coeur, ...p.notes.fond].join(' ').toLowerCase())}" style="--tint:${p.teinte}">
  <a class="card-link" href="${productUrl(p)}" data-select-item="${p.id}">
    <div class="card-media">
      ${picture(main, { cls: 'main', sizes, alt: altFor(p, main?.role), loading: o.eager ? 'eager' : 'lazy' })}
      ${alt ? picture(alt, { cls: `alt${alt.role !== 'etui' ? ' alt--cover' : ''}`, sizes, alt: '' }) : ''}
      ${alt && alt.role === 'texture' ? `<span class="card-reveal" aria-hidden="true">
        <span class="cr-name">${esc(p.nom)}</span>
        <span class="cr-notes"><span><i>Tête</i>${esc(short(p.notes.tete))}</span><span><i>Cœur</i>${esc(short(p.notes.coeur))}</span><span><i>Fond</i>${esc(short(p.notes.fond))}</span></span>
        <span class="cr-cta">Découvrir</span>
      </span>` : ''}
      <span class="badge" data-live-badge="${p.id}"${p.enStock ? ' hidden' : ''}>Indisponible</span>
      ${p.enStock && discountPct(p) ? `<span class="badge badge--offer">−${discountPct(p)} %</span>` : ''}
    </div>
    <div class="card-body">
      <${heading} class="card-title">${esc(p.nom)}</${heading}>
      <p class="card-notes">${esc(p.accroche)}</p>
      <p class="card-meta">${priceHTML(p)}<span class="volume">${p.volumeMl} ml</span></p>
      ${lowStock(p) ? `<p class="card-stock" data-live-low="${p.id}">${lowStock(p) === 1 ? 'Dernier flacon' : `Plus que ${lowStock(p)} flacons`}</p>` : ''}
    </div>
  </a>
  <button type="button" class="card-add" data-add-to-cart="${p.id}" data-list="${o.list || ''}"${p.achetable ? '' : ' disabled'}>${p.achetable ? `Ajouter au panier<span class="visually-hidden"> : ${esc(p.nom)}</span>` : `Indisponible<span class="visually-hidden"> : ${esc(p.nom)}</span>`}</button>
</li>`;
}
