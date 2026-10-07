// Espace restaurant — liste des réservations par soir
'use strict';

const $ = (id) => document.getElementById(id);
const STATUTS = { confirmee: 'Confirmée', arrivee: 'Arrivée', absente: 'Absente', annulee: 'Annulée' };
let motDePasse = '';
try { motDePasse = sessionStorage.getItem('cn-admin') || ''; } catch { /* stockage indisponible */ }

const aujourdhui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const dateLongue = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

async function api(chemin, options = {}) {
  const rep = await fetch(chemin, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${motDePasse}` } });
  const donnees = await rep.json().catch(() => ({}));
  if (rep.status === 401) { deconnecter('Mot de passe incorrect.'); throw new Error('401'); }
  return { ok: rep.ok, donnees };
}

function deconnecter(message = '') {
  motDePasse = '';
  try { sessionStorage.removeItem('cn-admin'); } catch { /* rien */ }
  $('tableau').hidden = true;
  $('form-connexion').hidden = false;
  $('alerte-connexion').textContent = message;
}

function cellule(texte) { const td = document.createElement('td'); td.textContent = texte; return td; }

async function charger() {
  const date = $('jour').value || aujourdhui();
  const [{ donnees }, prochains] = await Promise.all([
    api(`/api/admin/reservations?date=${date}`),
    api('/api/admin/prochains'),
  ]);
  $('form-connexion').hidden = true;
  $('tableau').hidden = false;
  $('titre-jour').textContent = dateLongue(date);

  const p = $('prochains');
  p.innerHTML = '';
  for (const j of prochains.donnees.jours) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${new Date(`${j.date}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} : ${j.couverts} couv.`;
    b.addEventListener('click', () => { $('jour').value = j.date; charger(); });
    p.append(b);
  }
  if (!prochains.donnees.jours.length) p.textContent = 'Aucune réservation à venir.';

  const actives = donnees.reservations.filter((r) => r.statut !== 'annulee');
  $('totaux').textContent = `${actives.length} table${actives.length > 1 ? 's' : ''}, ${actives.reduce((s, r) => s + r.couverts, 0)} couverts`;

  const corps = $('lignes');
  corps.innerHTML = '';
  if (!donnees.reservations.length) {
    const tr = document.createElement('tr');
    const td = cellule('Aucune réservation ce soir-là.');
    td.colSpan = 7;
    tr.append(td);
    corps.append(tr);
  }
  for (const r of donnees.reservations) {
    const tr = document.createElement('tr');
    if (r.statut === 'annulee') tr.className = 'annulee';
    const tel = document.createElement('td');
    const a = document.createElement('a');
    a.href = `tel:${r.telephone.replace(/[^+0-9]/g, '')}`;
    a.textContent = r.telephone;
    tel.append(a);
    const nom = cellule(r.nom);
    nom.title = `${r.email} · ${r.reference}`;
    const st = document.createElement('td');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `Statut de ${r.nom}`);
    for (const [v, l] of Object.entries(STATUTS)) sel.add(new Option(l, v, false, v === r.statut));
    sel.addEventListener('change', async () => {
      await api(`/api/admin/reservations/${r.reference}`, { method: 'PATCH', body: JSON.stringify({ statut: sel.value }) });
      charger();
    });
    st.append(sel);
    const sup = document.createElement('td');
    const bs = document.createElement('button');
    bs.className = 'bouton-texte';
    bs.textContent = 'Supprimer';
    bs.addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement la réservation de ${r.nom} ?`)) return;
      await api(`/api/admin/reservations/${r.reference}`, { method: 'DELETE' });
      charger();
    });
    sup.append(bs);
    tr.append(cellule(r.heure.replace(':', ' h ')), cellule(r.couverts), nom, tel, cellule(r.commentaire || ''), st, sup);
    corps.append(tr);
  }
}

$('form-connexion').addEventListener('submit', (e) => {
  e.preventDefault();
  motDePasse = $('mdp').value;
  try { sessionStorage.setItem('cn-admin', motDePasse); } catch { /* rien */ }
  $('alerte-connexion').textContent = '';
  charger().catch(() => {});
});
$('jour').addEventListener('change', () => charger().catch(() => {}));
$('actualiser').addEventListener('click', () => charger().catch(() => {}));
$('imprimer').addEventListener('click', () => window.print());
$('deconnexion').addEventListener('click', () => deconnecter());

$('jour').value = aujourdhui();
if (motDePasse) charger().catch(() => {});
setInterval(() => { if (motDePasse && !document.hidden) charger().catch(() => {}); }, 60_000);
