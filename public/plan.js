// Plan Google Maps : chargé seulement si le visiteur le demande (Google dépose des cookies).
'use strict';

const CLE_PLAN = 'chatnoir-plan-google';
const memoire = {
  lire() { try { return localStorage.getItem(CLE_PLAN); } catch { return null; } },
  ecrire() { try { localStorage.setItem(CLE_PLAN, 'oui'); } catch { /* stockage indisponible */ } },
  effacer() { try { localStorage.removeItem(CLE_PLAN); } catch { /* stockage indisponible */ } },
};

const boite = document.querySelector('[data-plan]');
if (boite) {
  const afficher = () => {
    const iframe = document.createElement('iframe');
    iframe.title = 'Plan d’accès au Chat Noir, 217 rue Droite, Sisteron';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.src = boite.dataset.planSrc;
    boite.replaceChildren(iframe);
    boite.classList.add('plan-charge');
  };
  boite.querySelector('[data-plan-afficher]').addEventListener('click', () => { memoire.ecrire(); afficher(); });
  if (memoire.lire() === 'oui') afficher();
}

// Page confidentialité : retirer son accord
const retirer = document.querySelector('[data-plan-retirer]');
if (retirer) {
  const etat = document.querySelector('[data-plan-etat]');
  const maj = () => {
    const accord = memoire.lire() === 'oui';
    etat.textContent = accord ? 'Le plan s’affiche automatiquement sur ce navigateur.' : 'Le plan ne s’affichera que si vous le demandez.';
    retirer.disabled = !accord;
  };
  retirer.addEventListener('click', () => { memoire.effacer(); maj(); });
  maj();
}
