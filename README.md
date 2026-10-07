# Le Chat Noir, Sisteron

Site du restaurant Le Chat Noir (217 rue Droite, 04200 Sisteron) avec réservation de table en ligne.

- `public/` : le site (accueil, carte, réservation, pages légales, espace restaurant `/admin`)
- `server.js` : serveur Node sans framework + API de réservation
- `stockage.js` : Postgres (variable `DATABASE_URL`) ou fichier JSON local en développement

## Lancer en local

```
npm install
ADMIN_PASSWORD=secret npm start
```
Puis ouvrir http://localhost:3000.

## Réglages (variables d'environnement Render)

| Variable | Défaut | Rôle |
|---|---|---|
| `ADMIN_PASSWORD` | (aucun) | Mot de passe de l'espace restaurant `/admin` |
| `DATABASE_URL` | (aucun) | Base Postgres |
| `JOURS_OUVERTS` | `0,1,2,5,6` | Jours d'ouverture (0 = dimanche) |
| `PREMIER_CRENEAU` / `DERNIER_CRENEAU` | `18:30` / `21:00` | Heures d'arrivée proposées |
| `COUVERTS_PAR_CRENEAU` | `12` | Couverts max par quart d'heure |
| `COUVERTS_PAR_SOIREE` | `45` | Couverts max réservables en ligne par soir |
| `COUVERTS_MAX_EN_LIGNE` | `8` | Taille max d'une table réservée en ligne |
| `FERMETURES` | (vide) | Fermetures exceptionnelles, ex. `2026-12-24,2026-12-25` |
| `CONSERVATION_JOURS` | `90` | Effacement automatique des réservations (RGPD) |

## À compléter avant d'ouvrir au public

Les champs surlignés en jaune dans `mentions-legales.html`, `conditions.html` et `confidentialite.html` (SIRET, raison sociale, e-mail, médiateur), et les plats/prix de la carte dans `index.html`.
