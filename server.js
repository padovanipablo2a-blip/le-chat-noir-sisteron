// Le Chat Noir — Sisteron
// Serveur du site + API de réservation. Aucune dépendance hormis `pg` (Postgres).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { creerStockage } = require('./stockage');

// ---------------------------------------------------------------------------
// Configuration (modifiable via les variables d'environnement Render)
// ---------------------------------------------------------------------------
const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  // Jours d'ouverture : 0 = dimanche … 6 = samedi. Fermé mercredi (3) et jeudi (4).
  joursOuverts: (process.env.JOURS_OUVERTS || '0,1,2,5,6').split(',').map(Number),
  premierCreneau: process.env.PREMIER_CRENEAU || '18:30',
  dernierCreneau: process.env.DERNIER_CRENEAU || '21:00',
  pasMinutes: Number(process.env.PAS_MINUTES) || 15,
  couvertsParCreneau: Number(process.env.COUVERTS_PAR_CRENEAU) || 12,
  couvertsParSoiree: Number(process.env.COUVERTS_PAR_SOIREE) || 45,
  couvertsMaxEnLigne: Number(process.env.COUVERTS_MAX_EN_LIGNE) || 8,
  joursAvanceMax: Number(process.env.JOURS_AVANCE_MAX) || 60,
  delaiMinMinutes: Number(process.env.DELAI_MIN_MINUTES) || 60,
  delaiAnnulationMinutes: Number(process.env.DELAI_ANNULATION_MINUTES) || 120,
  // Durée de conservation des données après la date du repas (RGPD)
  conservationJours: Number(process.env.CONSERVATION_JOURS) || 90,
  // Fermetures exceptionnelles : "2026-12-24,2026-12-25"
  fermetures: (process.env.FERMETURES || '').split(',').map((s) => s.trim()).filter(Boolean),
  motDePasseAdmin: process.env.ADMIN_PASSWORD || '',
};

const DOSSIER_PUBLIC = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Dates et créneaux (toujours à l'heure de Paris)
// ---------------------------------------------------------------------------
function maintenantParis() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const enMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const enHeure = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const jourSemaine = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const ecartJours = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const ajouterJours = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function tousLesCreneaux() {
  const liste = [];
  for (let m = enMinutes(CONFIG.premierCreneau); m <= enMinutes(CONFIG.dernierCreneau); m += CONFIG.pasMinutes) {
    liste.push(enHeure(m));
  }
  return liste;
}

function dateValide(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`));
}

// Raison pour laquelle une date n'est pas réservable en ligne, ou null.
function raisonFermeture(date) {
  const now = maintenantParis();
  const ecart = ecartJours(now.date, date);
  if (ecart < 0) return 'Cette date est passée.';
  if (ecart > CONFIG.joursAvanceMax) return `Les réservations en ligne ouvrent ${CONFIG.joursAvanceMax} jours à l'avance.`;
  if (CONFIG.fermetures.includes(date)) return 'Le restaurant est exceptionnellement fermé ce soir-là.';
  if (!CONFIG.joursOuverts.includes(jourSemaine(date))) return 'Le restaurant est fermé le mercredi et le jeudi.';
  return null;
}

function creneauEncoreOuvert(date, heure) {
  const now = maintenantParis();
  if (date !== now.date) return true;
  return enMinutes(heure) - now.minutes >= CONFIG.delaiMinMinutes;
}

async function disponibilites(stockage, date, couverts) {
  const fermeture = raisonFermeture(date);
  if (fermeture) return { ouvert: false, message: fermeture, creneaux: [] };
  const resas = await stockage.reservationsDuJour(date);
  const totalSoiree = resas.reduce((s, r) => s + r.couverts, 0);
  const creneaux = tousLesCreneaux().map((heure) => {
    const surCreneau = resas.filter((r) => r.heure === heure).reduce((s, r) => s + r.couverts, 0);
    const dispo = creneauEncoreOuvert(date, heure)
      && surCreneau + couverts <= CONFIG.couvertsParCreneau
      && totalSoiree + couverts <= CONFIG.couvertsParSoiree;
    return { heure, dispo };
  });
  const aucun = creneaux.every((c) => !c.dispo);
  return {
    ouvert: true,
    message: aucun ? 'Plus de table disponible en ligne ce soir-là pour ce nombre de personnes. Appelez-nous, on fera notre possible.' : null,
    creneaux,
  };
}

// ---------------------------------------------------------------------------
// Validation et sécurité
// ---------------------------------------------------------------------------
const ALPHABET_REF = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function nouvelleReference() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET_REF[crypto.randomInt(ALPHABET_REF.length)];
  return `CN-${s}`;
}

const nettoyer = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function validerReservation(corps) {
  const erreurs = {};
  const r = {
    date: nettoyer(corps.date, 10),
    heure: nettoyer(corps.heure, 5),
    couverts: Number(corps.couverts),
    nom: nettoyer(corps.nom, 80),
    telephone: nettoyer(corps.telephone, 20),
    email: nettoyer(corps.email, 120).toLowerCase(),
    commentaire: typeof corps.commentaire === 'string' ? corps.commentaire.trim().slice(0, 300) : '',
  };
  if (!dateValide(r.date)) erreurs.date = 'Choisissez une date.';
  if (!tousLesCreneaux().includes(r.heure)) erreurs.heure = 'Choisissez une heure d’arrivée.';
  if (!Number.isInteger(r.couverts) || r.couverts < 1) erreurs.couverts = 'Indiquez le nombre de personnes.';
  else if (r.couverts > CONFIG.couvertsMaxEnLigne) erreurs.couverts = `Au-delà de ${CONFIG.couvertsMaxEnLigne} personnes, réservez par téléphone.`;
  if (r.nom.length < 2) erreurs.nom = 'Indiquez votre nom.';
  if (!/^[+0-9 .()-]{8,20}$/.test(r.telephone)) erreurs.telephone = 'Indiquez un numéro de téléphone valide.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) erreurs.email = 'Indiquez une adresse e-mail valide.';
  if (corps.conditions !== true) erreurs.conditions = 'Acceptez les conditions de réservation pour continuer.';
  return { r, erreurs };
}

function motDePasseCorrect(fourni) {
  if (!CONFIG.motDePasseAdmin || typeof fourni !== 'string') return false;
  const a = crypto.createHash('sha256').update(fourni).digest();
  const b = crypto.createHash('sha256').update(CONFIG.motDePasseAdmin).digest();
  return crypto.timingSafeEqual(a, b);
}

// Limite simple : N requêtes par fenêtre et par adresse IP.
const compteurs = new Map();
function tropDeRequetes(ip, cle, max, fenetreMs) {
  const k = `${cle}:${ip}`;
  const maintenant = Date.now();
  const liste = (compteurs.get(k) || []).filter((t) => maintenant - t < fenetreMs);
  liste.push(maintenant);
  compteurs.set(k, liste);
  return liste.length > max;
}
setInterval(() => compteurs.clear(), 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const ENTETES_SECURITE = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-Frame-Options': 'DENY',
};

function envoyerJson(res, statut, donnees) {
  res.writeHead(statut, { ...ENTETES_SECURITE, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(donnees));
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > 10_000) { reject(new Error('trop gros')); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => {
      try { resolve(morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString('utf8')) : {}); }
      catch { reject(new Error('json')); }
    });
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

function servirFichier(req, res, chemin) {
  let relatif = decodeURIComponent(chemin);
  if (relatif.endsWith('/')) relatif += 'index.html';
  if (!path.extname(relatif)) relatif += '.html';
  const absolu = path.normalize(path.join(DOSSIER_PUBLIC, relatif));
  if (!absolu.startsWith(DOSSIER_PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(absolu, (err, contenu) => {
    if (err) {
      fs.readFile(path.join(DOSSIER_PUBLIC, '404.html'), (e2, page) => {
        res.writeHead(404, { ...ENTETES_SECURITE, 'Content-Type': TYPES['.html'] });
        res.end(e2 ? 'Page introuvable' : page);
      });
      return;
    }
    const ext = path.extname(absolu);
    const cache = ext === '.woff2' ? 'public, max-age=31536000, immutable'
      : ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { ...ENTETES_SECURITE, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : contenu);
  });
}

function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

async function routeur(stockage, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const ip = ipDe(req);

  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    servirFichier(req, res, p);
    return;
  }

  if (tropDeRequetes(ip, 'api', 120, 60_000)) return envoyerJson(res, 429, { erreur: 'Trop de requêtes. Réessayez dans une minute.' });

  // Infos publiques (horaires, règles) pour le formulaire
  if (req.method === 'GET' && p === '/api/infos') {
    return envoyerJson(res, 200, {
      aujourdhui: maintenantParis().date,
      joursOuverts: CONFIG.joursOuverts,
      fermetures: CONFIG.fermetures,
      couvertsMaxEnLigne: CONFIG.couvertsMaxEnLigne,
      joursAvanceMax: CONFIG.joursAvanceMax,
      delaiAnnulationMinutes: CONFIG.delaiAnnulationMinutes,
    });
  }

  if (req.method === 'GET' && p === '/api/disponibilites') {
    const date = url.searchParams.get('date');
    const couverts = Number(url.searchParams.get('couverts')) || 2;
    if (!dateValide(date)) return envoyerJson(res, 400, { erreur: 'Date invalide.' });
    if (couverts < 1 || couverts > CONFIG.couvertsMaxEnLigne) return envoyerJson(res, 400, { erreur: 'Nombre de personnes invalide.' });
    return envoyerJson(res, 200, await disponibilites(stockage, date, couverts));
  }

  if (req.method === 'POST' && p === '/api/reservations') {
    if (tropDeRequetes(ip, 'resa', 6, 10 * 60_000)) return envoyerJson(res, 429, { erreur: 'Trop de tentatives. Appelez-nous au 04 92 62 21 28.' });
    const corps = await lireCorps(req);
    if (corps.site) return envoyerJson(res, 201, { reference: nouvelleReference() }); // champ piège anti-robots
    const { r, erreurs } = validerReservation(corps);
    if (Object.keys(erreurs).length) return envoyerJson(res, 422, { erreur: 'Vérifiez les champs signalés.', champs: erreurs });
    const fermeture = raisonFermeture(r.date);
    if (fermeture) return envoyerJson(res, 422, { erreur: fermeture, champs: { date: fermeture } });
    if (!creneauEncoreOuvert(r.date, r.heure)) {
      return envoyerJson(res, 409, { erreur: 'Ce créneau est trop proche pour réserver en ligne. Appelez-nous.' });
    }
    const resa = { ...r, reference: nouvelleReference() };
    const ok = await stockage.creerSiPlace(resa, CONFIG.couvertsParCreneau, CONFIG.couvertsParSoiree);
    if (!ok) return envoyerJson(res, 409, { erreur: 'Ce créneau vient d’être complet. Choisissez une autre heure.' });
    console.log(`Réservation ${resa.reference} : ${resa.date} ${resa.heure}, ${resa.couverts} pers.`);
    return envoyerJson(res, 201, { reference: resa.reference, date: resa.date, heure: resa.heure, couverts: resa.couverts, nom: resa.nom });
  }

  // Gérer sa réservation : référence + e-mail
  const mGerer = p.match(/^\/api\/reservations\/(CN-[A-Z0-9]{6})(\/annuler)?$/);
  if (mGerer && req.method === 'POST') {
    if (tropDeRequetes(ip, 'gerer', 10, 10 * 60_000)) return envoyerJson(res, 429, { erreur: 'Trop de tentatives. Réessayez plus tard.' });
    const corps = await lireCorps(req);
    const resa = await stockage.lire(mGerer[1]);
    const email = nettoyer(corps.email, 120).toLowerCase();
    if (!resa || resa.email !== email) return envoyerJson(res, 404, { erreur: 'Aucune réservation ne correspond à cette référence et cet e-mail.' });
    const publique = { reference: resa.reference, date: resa.date, heure: resa.heure, couverts: resa.couverts, nom: resa.nom, statut: resa.statut };
    if (!mGerer[2]) return envoyerJson(res, 200, publique);
    if (resa.statut === 'annulee') return envoyerJson(res, 200, publique);
    const now = maintenantParis();
    const minutesAvant = ecartJours(now.date, resa.date) * 1440 + enMinutes(resa.heure) - now.minutes;
    if (minutesAvant < CONFIG.delaiAnnulationMinutes) {
      return envoyerJson(res, 409, { erreur: 'Moins de 2 heures avant votre arrivée : prévenez-nous par téléphone au 04 92 62 21 28.' });
    }
    await stockage.changerStatut(resa.reference, 'annulee');
    return envoyerJson(res, 200, { ...publique, statut: 'annulee' });
  }

  // Espace restaurant
  if (p.startsWith('/api/admin/')) {
    const jeton = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (tropDeRequetes(ip, 'admin', 60, 60_000) || !motDePasseCorrect(jeton)) {
      return envoyerJson(res, 401, { erreur: 'Mot de passe incorrect.' });
    }
    if (req.method === 'GET' && p === '/api/admin/reservations') {
      const date = url.searchParams.get('date') || maintenantParis().date;
      if (!dateValide(date)) return envoyerJson(res, 400, { erreur: 'Date invalide.' });
      return envoyerJson(res, 200, { date, reservations: await stockage.reservationsDuJour(date, true) });
    }
    if (req.method === 'GET' && p === '/api/admin/prochains') {
      return envoyerJson(res, 200, { jours: await stockage.resumeProchainsJours(maintenantParis().date, 14) });
    }
    const mStatut = p.match(/^\/api\/admin\/reservations\/(CN-[A-Z0-9]{6})$/);
    if (mStatut && req.method === 'PATCH') {
      const { statut } = await lireCorps(req);
      if (!['confirmee', 'arrivee', 'absente', 'annulee'].includes(statut)) return envoyerJson(res, 400, { erreur: 'Statut inconnu.' });
      const ok = await stockage.changerStatut(mStatut[1], statut);
      return envoyerJson(res, ok ? 200 : 404, ok ? { reference: mStatut[1], statut } : { erreur: 'Réservation introuvable.' });
    }
    if (mStatut && req.method === 'DELETE') {
      const ok = await stockage.supprimer(mStatut[1]);
      return envoyerJson(res, ok ? 200 : 404, ok ? { supprimee: mStatut[1] } : { erreur: 'Réservation introuvable.' });
    }
  }

  return envoyerJson(res, 404, { erreur: 'Adresse inconnue.' });
}

async function demarrer() {
  const stockage = await creerStockage();

  // Effacement automatique des données anciennes (RGPD)
  const purger = async () => {
    const limite = ajouterJours(maintenantParis().date, -CONFIG.conservationJours);
    const n = await stockage.purgerAvant(limite);
    if (n) console.log(`RGPD : ${n} réservation(s) antérieure(s) au ${limite} effacée(s).`);
  };
  await purger();
  setInterval(() => purger().catch(console.error), 12 * 60 * 60 * 1000).unref();

  if (!CONFIG.motDePasseAdmin) console.warn('ADMIN_PASSWORD non défini : l’espace restaurant est désactivé.');

  http.createServer((req, res) => {
    routeur(stockage, req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) envoyerJson(res, err.message === 'json' || err.message === 'trop gros' ? 400 : 500, { erreur: 'Une erreur est survenue. Réessayez ou appelez-nous au 04 92 62 21 28.' });
    });
  }).listen(CONFIG.port, () => console.log(`Le Chat Noir en ligne sur le port ${CONFIG.port}`));
}

demarrer().catch((err) => { console.error(err); process.exit(1); });
