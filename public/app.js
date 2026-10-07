// Réservation en ligne — Le Chat Noir
'use strict';

const $ = (id) => document.getElementById(id);
const TEL = '04 92 62 21 28';

const etat = { date: null, heure: null, couverts: 2, infos: null, requete: 0 };

const versDate = (iso) => new Date(`${iso}T12:00:00Z`);
const ajouterJours = (iso, n) => new Date(versDate(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
const fmt = (iso, options) => versDate(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options });
const dateLongue = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const heureFr = (h) => h.replace(':', ' h ');
const personnes = (n) => `${n} personne${n > 1 ? 's' : ''}`;

function aujourdhuiParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function estOuvert(iso) {
  const { joursOuverts, fermetures } = etat.infos;
  return joursOuverts.includes(versDate(iso).getUTCDay()) && !fermetures.includes(iso);
}

async function api(chemin, options = {}) {
  const rep = await fetch(chemin, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let donnees = {};
  try { donnees = await rep.json(); } catch { /* réponse vide */ }
  return { ok: rep.ok, statut: rep.status, donnees };
}

// ---------- Étape 1 : les soirs ----------
function dessinerJours() {
  const conteneur = $('jours');
  conteneur.innerHTML = '';
  const debut = etat.infos.aujourdhui;
  for (let i = 0; i < 21; i++) {
    const iso = ajouterJours(debut, i);
    const ouvert = estOuvert(iso);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jour';
    b.style.setProperty('--i', i);
    b.dataset.date = iso;
    b.disabled = !ouvert;
    b.setAttribute('aria-pressed', String(iso === etat.date));
    b.setAttribute('aria-label', `${dateLongue(iso)}${ouvert ? '' : ', fermé'}`);
    const libelle = i === 0 ? 'ce soir' : i === 1 ? 'demain' : fmt(iso, { weekday: 'short' });
    b.innerHTML = `<span>${libelle}</span><b>${fmt(iso, { day: 'numeric' })}</b><span>${ouvert ? fmt(iso, { month: 'short' }) : 'fermé'}</span>`;
    b.addEventListener('click', () => choisirDate(iso));
    conteneur.append(b);
  }
  const libre = $('date-libre');
  libre.min = debut;
  libre.max = ajouterJours(debut, etat.infos.joursAvanceMax);
}

function choisirDate(iso) {
  etat.date = iso;
  document.querySelectorAll('.jour').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === iso)));
  if ($('date-libre').value !== iso && !document.querySelector(`.jour[data-date="${iso}"]`)) $('date-libre').value = iso;
  $('err-date').textContent = '';
  majRecap();
  chargerCreneaux();
}

$('date-libre').addEventListener('change', (e) => {
  const iso = e.target.value;
  if (!iso) return;
  if (!estOuvert(iso)) {
    $('err-date').textContent = 'Le restaurant est fermé ce soir-là (fermeture le mercredi et le jeudi).';
    return;
  }
  choisirDate(iso);
});

// ---------- Étape 2 : nombre de personnes ----------
function majCompteur() {
  const max = etat.infos ? etat.infos.couvertsMaxEnLigne : 8;
  $('couverts').textContent = personnes(etat.couverts);
  $('moins').disabled = etat.couverts <= 1;
  $('plus').disabled = etat.couverts >= max;
  majRecap();
}
$('moins').addEventListener('click', () => { etat.couverts = Math.max(1, etat.couverts - 1); majCompteur(); chargerCreneaux(); });
$('plus').addEventListener('click', () => { etat.couverts += 1; majCompteur(); chargerCreneaux(); });

// ---------- Étape 3 : heures ----------
async function chargerCreneaux() {
  if (!etat.date) return;
  const n = ++etat.requete;
  const message = $('message-creneaux');
  message.textContent = 'Recherche des tables libres…';
  const { ok, donnees } = await api(`/api/disponibilites?date=${etat.date}&couverts=${etat.couverts}`).catch(() => ({ ok: false, donnees: {} }));
  if (n !== etat.requete) return; // une réponse plus récente est déjà arrivée
  const conteneur = $('creneaux');
  conteneur.innerHTML = '';
  if (!ok) {
    message.textContent = `Les disponibilités ne se chargent pas. Réessayez ou appelez le ${TEL}.`;
    return;
  }
  if (!donnees.ouvert) {
    message.textContent = donnees.message;
    etat.heure = null;
    majRecap();
    return;
  }
  const libres = donnees.creneaux.filter((c) => c.dispo).map((c) => c.heure);
  if (!libres.includes(etat.heure)) etat.heure = null;
  for (const [i, c] of donnees.creneaux.entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'creneau';
    b.style.setProperty('--i', i);
    b.textContent = c.heure.replace(':', ' h ');
    b.disabled = !c.dispo;
    b.setAttribute('aria-pressed', String(c.heure === etat.heure));
    if (!c.dispo) b.setAttribute('aria-label', `${heureFr(c.heure)}, complet`);
    b.addEventListener('click', () => {
      etat.heure = c.heure;
      conteneur.querySelectorAll('.creneau').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('err-heure').textContent = '';
      majRecap();
    });
    conteneur.append(b);
  }
  message.textContent = donnees.message || '';
  majRecap();
}

function ecrireRecap(id, valeur) {
  const el = $(id);
  if (el.textContent === String(valeur)) return;
  el.textContent = valeur;
  el.classList.remove('maj');
  void el.offsetWidth; // relance l'animation
  el.classList.add('maj');
}

function coordonneesRemplies() {
  return $('nom').value.trim().length >= 2 && $('telephone').value.trim().length >= 8
    && $('email').value.includes('@') && $('conditions').checked;
}

function majProgression() {
  const faits = { 1: Boolean(etat.date), 2: Boolean(etat.date), 3: Boolean(etat.heure), 4: coordonneesRemplies() };
  document.querySelectorAll('[data-progression] li').forEach((li) => li.classList.toggle('fait', faits[li.dataset.etape]));
}

function majRecap() {
  ecrireRecap('recap-date', etat.date ? dateLongue(etat.date) : 'À choisir');
  ecrireRecap('recap-heure', etat.heure ? heureFr(etat.heure) : 'À choisir');
  ecrireRecap('recap-couverts', etat.couverts);
  majProgression();
}
['nom', 'telephone', 'email', 'conditions'].forEach((id) => $(id).addEventListener('input', majProgression));
$('conditions').addEventListener('change', majProgression);

// ---------- Étape 4 : envoi ----------
const CHAMPS = ['nom', 'telephone', 'email', 'conditions'];

function afficherErreurs(erreurs) {
  for (const champ of ['date', 'heure', ...CHAMPS]) {
    const el = $(`err-${champ}`);
    if (el) el.textContent = erreurs[champ] || '';
    const entree = $(champ);
    if (entree && entree.tagName === 'INPUT') entree.setAttribute('aria-invalid', String(Boolean(erreurs[champ])));
  }
  if (erreurs.couverts) $('alerte').textContent = erreurs.couverts;
  const premier = ['date', 'heure', ...CHAMPS].find((c) => erreurs[c]);
  if (premier) ($(premier) || $(`err-${premier}`)).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function verifier(d) {
  const e = {};
  if (!d.date) e.date = 'Choisissez un soir.';
  if (!d.heure) e.heure = 'Choisissez une heure d’arrivée.';
  if (d.nom.length < 2) e.nom = 'Indiquez votre nom.';
  if (!/^[+0-9 .()-]{8,20}$/.test(d.telephone)) e.telephone = 'Indiquez un numéro de téléphone valide.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Indiquez une adresse e-mail valide.';
  if (!d.conditions) e.conditions = 'Acceptez les conditions de réservation pour continuer.';
  return e;
}

$('form-resa').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('alerte').textContent = '';
  const d = {
    date: etat.date, heure: etat.heure, couverts: etat.couverts,
    nom: $('nom').value.trim(), telephone: $('telephone').value.trim(), email: $('email').value.trim(),
    commentaire: $('commentaire').value.trim(), conditions: $('conditions').checked, site: $('site').value,
  };
  const erreurs = verifier(d);
  afficherErreurs(erreurs);
  if (Object.keys(erreurs).length) return;

  const bouton = $('valider');
  bouton.disabled = true;
  bouton.innerHTML = '<span>Réservation en cours…</span>';
  const { ok, statut, donnees } = await api('/api/reservations', { method: 'POST', body: JSON.stringify(d) })
    .catch(() => ({ ok: false, statut: 0, donnees: {} }));
  bouton.disabled = false;
  bouton.innerHTML = '<span>Réserver la table</span>';

  if (ok) return confirmer(donnees, d.email);
  if (donnees.champs) afficherErreurs(donnees.champs);
  $('alerte').textContent = donnees.erreur || `La réservation n’a pas abouti. Réessayez ou appelez le ${TEL}.`;
  if (statut === 409) chargerCreneaux();
});

function confirmer(r, email) {
  const zone = $('zone-formulaire');
  zone.innerHTML = `
    <div class="confirmation" tabindex="-1" id="confirmation">
      <svg class="coche" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
      <div>
        <h3>C’est réservé</h3>
        <p>Une table pour <strong>${personnes(r.couverts)}</strong>, <strong>${dateLongue(r.date)}</strong> à <strong>${heureFr(r.heure)}</strong>, au nom de <strong data-nom></strong>.</p>
        <p>Votre référence :</p>
        <p class="reference">${r.reference}</p>
        <p>Notez-la : avec votre e-mail (<span data-email></span>), elle vous permet d’annuler en ligne jusqu’à 2 heures avant. Passé 15 minutes de retard sans nouvelles, la table peut être proposée à d’autres clients.</p>
        <p>À bientôt rue Droite.</p>
      </div>
    </div>`;
  // textes saisis : jamais injectés en HTML
  zone.querySelector('[data-nom]').textContent = r.nom;
  zone.querySelector('[data-email]').textContent = email;
  document.querySelectorAll('[data-progression] li').forEach((li) => li.classList.add('fait'));
  $('confirmation').focus();
  $('confirmation').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- Gérer une réservation ----------
function afficherResaGeree(r, email) {
  const zone = $('resultat-gerer');
  zone.innerHTML = '';
  const p = document.createElement('p');
  if (r.statut === 'annulee') {
    p.textContent = `La réservation ${r.reference} du ${dateLongue(r.date)} est annulée.`;
    zone.append(p);
    return;
  }
  p.textContent = `${r.reference} : ${personnes(r.couverts)}, ${dateLongue(r.date)} à ${heureFr(r.heure)}, au nom de ${r.nom}. Pour changer l’heure ou le nombre de personnes, annulez puis réservez à nouveau, ou appelez le ${TEL}.`;
  const b = document.createElement('button');
  b.className = 'bouton bouton-clair';
  b.type = 'button';
  b.textContent = 'Annuler cette réservation';
  b.addEventListener('click', async () => {
    if (!confirm(`Annuler la réservation du ${dateLongue(r.date)} à ${heureFr(r.heure)} ?`)) return;
    b.disabled = true;
    const rep = await api(`/api/reservations/${r.reference}/annuler`, { method: 'POST', body: JSON.stringify({ email }) });
    if (rep.ok) {
      afficherResaGeree(rep.donnees, email);
      if (etat.date === r.date) chargerCreneaux();
    } else {
      b.disabled = false;
      const err = document.createElement('p');
      err.className = 'alerte';
      err.textContent = rep.donnees.erreur || 'L’annulation n’a pas abouti.';
      zone.append(err);
    }
  });
  zone.append(p, b);
}

$('form-gerer').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ref = $('ref').value.trim().toUpperCase();
  const email = $('email-gerer').value.trim();
  const zone = $('resultat-gerer');
  if (!/^CN-[A-Z0-9]{6}$/.test(ref) || !email) {
    zone.innerHTML = '<p class="alerte">Indiquez la référence (CN- suivi de 6 caractères) et l’e-mail utilisé.</p>';
    return;
  }
  const rep = await api(`/api/reservations/${ref}`, { method: 'POST', body: JSON.stringify({ email }) })
    .catch(() => ({ ok: false, donnees: {} }));
  if (rep.ok) afficherResaGeree(rep.donnees, email);
  else {
    zone.innerHTML = '<p class="alerte"></p>';
    zone.firstChild.textContent = rep.donnees.erreur || `Recherche impossible pour le moment. Appelez le ${TEL}.`;
  }
});

// ---------- Démarrage ----------
(async function demarrer() {
  const rep = await api('/api/infos').catch(() => ({ ok: false }));
  etat.infos = rep.ok ? rep.donnees : {
    aujourdhui: aujourdhuiParis(), joursOuverts: [0, 1, 2, 5, 6], fermetures: [], couvertsMaxEnLigne: 8, joursAvanceMax: 60,
  };
  dessinerJours();
  majCompteur();
  if (!rep.ok) $('message-creneaux').textContent = `La réservation en ligne est momentanément indisponible. Appelez le ${TEL}.`;
})();
