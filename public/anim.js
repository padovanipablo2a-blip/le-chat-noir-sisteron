// Animations et interactions de la page — Le Chat Noir
// Chargé dans <head> sans « defer » : la classe .js est posée avant le premier affichage,
// ce qui évite que les éléments animés apparaissent puis disparaissent.
'use strict';

document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- En-tête : fond au défilement ----------
  const entete = document.querySelector('[data-entete]');
  const majEntete = () => entete && entete.classList.toggle('defile', window.scrollY > 30);
  majEntete();
  window.addEventListener('scroll', majEntete, { passive: true });

  // ---------- Menu mobile ----------
  const burger = document.querySelector('.burger');
  if (burger) {
    const fermer = () => {
      document.body.classList.remove('menu-ouvert');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Ouvrir le menu');
    };
    burger.addEventListener('click', () => {
      const ouvert = document.body.classList.toggle('menu-ouvert');
      burger.setAttribute('aria-expanded', String(ouvert));
      burger.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
    });
    document.querySelectorAll('#menu a').forEach((a) => a.addEventListener('click', fermer));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });
  }

  // ---------- Apparitions au défilement ----------
  const aReveler = document.querySelectorAll('[data-reveal]');
  if (reduit || !('IntersectionObserver' in window)) {
    aReveler.forEach((el) => el.classList.add('vu'));
  } else {
    const obs = new IntersectionObserver((entrees) => {
      for (const e of entrees) {
        if (!e.isIntersecting) continue;
        // léger décalage entre les éléments voisins qui entrent ensemble
        const freres = [...e.target.parentElement.querySelectorAll(':scope > [data-reveal]')];
        e.target.style.transitionDelay = `${Math.max(0, freres.indexOf(e.target)) * 90}ms`;
        e.target.classList.add('vu');
        obs.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    aReveler.forEach((el) => obs.observe(el));
  }

  // ---------- Onglets de la carte ----------
  const onglets = [...document.querySelectorAll('[role="tab"]')];
  const curseur = document.querySelector('.onglets-curseur');
  const placerCurseur = (b) => {
    if (!curseur || !b) return;
    curseur.style.width = `${b.offsetWidth}px`;
    curseur.style.transform = `translateX(${b.offsetLeft}px)`;
  };
  const choisirOnglet = (b, focus) => {
    onglets.forEach((o) => {
      const actif = o === b;
      o.setAttribute('aria-selected', String(actif));
      o.tabIndex = actif ? 0 : -1;
      const panneau = document.getElementById(o.getAttribute('aria-controls'));
      panneau.hidden = !actif;
      if (actif) {
        panneau.classList.remove('entree');
        void panneau.offsetWidth; // relance l'animation
        panneau.classList.add('entree');
      }
    });
    placerCurseur(b);
    if (focus) b.focus();
  };
  onglets.forEach((b, i) => {
    b.addEventListener('click', () => choisirOnglet(b));
    b.addEventListener('keydown', (e) => {
      const pas = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!pas) return;
      e.preventDefault();
      choisirOnglet(onglets[(i + pas + onglets.length) % onglets.length], true);
    });
  });
  if (onglets.length) {
    placerCurseur(onglets.find((o) => o.getAttribute('aria-selected') === 'true'));
    window.addEventListener('resize', () => placerCurseur(onglets.find((o) => o.getAttribute('aria-selected') === 'true')));
    document.fonts && document.fonts.ready.then(() => placerCurseur(onglets.find((o) => o.getAttribute('aria-selected') === 'true')));
  }

  // ---------- Ouvert ou fermé, à l'heure de Sisteron ----------
  const OUVERTS = [0, 1, 2, 5, 6];
  const NOMS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const parties = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const jour = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parties.weekday);
  const minutes = Number(parties.hour) * 60 + Number(parties.minute);

  const statut = document.querySelector('[data-statut]');
  if (statut && jour >= 0) {
    const texte = statut.querySelector('[data-statut-texte]');
    const prochain = () => {
      for (let i = 1; i <= 7; i++) {
        const j = (jour + i) % 7;
        if (OUVERTS.includes(j)) return i === 1 ? 'demain' : NOMS[j];
      }
      return '';
    };
    if (OUVERTS.includes(jour) && minutes < 18 * 60 + 30) {
      statut.dataset.ouvert = 'bientot';
      texte.textContent = 'Ouvert ce soir, de 18 h 30 à 21 h 30';
    } else if (OUVERTS.includes(jour) && minutes < 21 * 60 + 30) {
      statut.dataset.ouvert = 'oui';
      texte.textContent = 'Ouvert en ce moment, jusqu’à 21 h 30';
    } else {
      statut.dataset.ouvert = 'non';
      texte.textContent = `Fermé ce soir, on vous retrouve ${prochain()} dès 18 h 30`;
    }
  }
  const ligneDuJour = document.querySelector(`.horaires tr[data-jour="${jour}"]`);
  if (ligneDuJour) ligneDuJour.classList.add('aujourdhui');

  // ---------- Bouton « Réserver » fixe sur mobile ----------
  const cta = document.querySelector('[data-cta-mobile]');
  const hero = document.querySelector('.hero');
  const zoneResa = document.getElementById('reserver');
  if (cta && hero && zoneResa && 'IntersectionObserver' in window) {
    const visibles = new Set();
    const obsCta = new IntersectionObserver((entrees) => {
      entrees.forEach((e) => (e.isIntersecting ? visibles.add(e.target) : visibles.delete(e.target)));
      cta.classList.toggle('visible', visibles.size === 0);
    }, { threshold: 0.05 });
    obsCta.observe(hero);
    obsCta.observe(zoneResa);
  }

  const annee = document.querySelector('[data-annee]');
  if (annee) annee.textContent = new Date().getFullYear();
});
