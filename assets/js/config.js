/*
 * MERCURA — configuration du site.
 * Ce fichier est lu par toutes les pages : modifiez-le sans reconstruire le site.
 * Voir docs/MESURE-ET-ANNONCES.md et docs/MISE-EN-LIGNE.md.
 */
window.MERCURA_CONFIG = {
  // Adresse publique définitive (URL canoniques, sitemap, flux Merchant Center).
  siteUrl: 'https://mercuraparfums.com',

  // 'preview' : pages non indexables, paiement désactivé.
  // 'production' : à activer uniquement à la mise en ligne.
  environment: 'production',

  commerce: {
    // 'preview'     : le panier fonctionne, mais aucune commande ni aucun paiement n'est possible.
    // 'woocommerce' : le bouton « Commander » transmet le panier au paiement WooCommerce
    //                 (nécessite l'extension wordpress/mercura-bridge installée et testée).
    mode: 'preview',
    // false : visualisation seule, aucune lecture des prix et stocks WooCommerce
    // (les prix, réductions et disponibilités viennent de data/editorial.json).
    liveData: false,
    // API publique WooCommerce (lecture des prix et des stocks en temps réel).
    // En local, le serveur de prévisualisation relaie l'API (/__woo) en lecture seule.
    storeApi: location.hostname === 'localhost' ? '/__woo' : 'https://mercuraparfums.com/wp-json/wc/store/v1',
    // Adresse du WordPress qui accueille le paiement (ex. https://commande.mercuraparfums.com).
    checkoutBase: 'https://mercuraparfums.com',
    // Paramètre lu par l'extension mercura-bridge.
    handoffParam: 'mercura_cart'
  },

  tracking: {
    // Laisser vide tant que les comptes ne sont pas connectés : aucune balise n'est alors chargée.
    ga4Id: '',               // ex. 'G-XXXXXXXXXX'
    adsId: '',               // ex. 'AW-123456789'
    adsPurchaseLabel: '',    // libellé de la conversion « Achat » Google Ads
    adsAddToCartLabel: '',   // facultatif
    // 'basic'    : les balises Google ne sont chargées qu'après consentement (recommandé en France).
    // 'advanced' : balises chargées dès l'arrivée avec consentement refusé par défaut (pings sans cookies).
    consentMode: 'basic',
    consentVersion: 1,       // incrémenter pour redemander le consentement
    consentDays: 180
  },

  contact: {
    email: 'contact@mercuraparfums.com',
    phone: '+33 7 77 00 58 08',
    phoneHref: '+33777005808',
    address: '34 avenue de la Constellation, Cergy'
  },

  // Mentions légales : chaque information n'apparaît sur le site que si elle est renseignée. Régénérer le site après modification.
  legal: {
    denomination: '',   // ex. 'Mercura Parfums SAS' (vide : « Mercura Parfums »)
    forme: '',          // ex. 'SAS', 'SASU', 'entreprise individuelle'
    capital: '',        // ex. '1 000 €' (sociétés uniquement)
    codePostal: '',     // ex. '95000'
    rcs: '',            // ex. 'RCS Pontoise 123 456 789'
    siret: '',          // ex. '123 456 789 00012'
    tva: '',            // ex. 'FR12 123456789' ; ou laisser vide
    directeur: ''       // directeur de la publication (prénom et nom)
  },

  // Formulaire de contact : envoi automatique des messages à contact.email via Web3Forms (gratuit).
  // Créer la clé sur https://web3forms.com avec l'adresse contact@mercuraparfums.com, la coller ici, puis régénérer le site.
  // Vide : le formulaire ouvre la messagerie du visiteur (ancien fonctionnement).
  contactForm: {
    web3formsKey: ''
  },

  // Réseaux sociaux : adresse complète du compte (ex. 'https://www.instagram.com/nomducompte/').
  // Une icône n'apparaît sur le site que si son adresse est renseignée. Régénérer le site après modification.
  social: {
    instagram: 'https://www.instagram.com/mercura_parfums/',
    tiktok: 'https://www.tiktok.com/@mercuraparfums'
  },

  // Commande par WhatsApp : le bouton « Commander » ouvre WhatsApp avec le récapitulatif du panier.
  // Numéro au format international, chiffres uniquement (33 = France, sans le 0 initial).
  whatsapp: {
    number: '33777005808',
    display: '+33 7 77 00 58 08'
  }
};
