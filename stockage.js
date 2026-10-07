// Stockage des réservations : Postgres si DATABASE_URL est défini, sinon un fichier JSON local (développement).
'use strict';

const fs = require('fs');
const path = require('path');

const ACTIVES = "statut <> 'annulee'";

async function stockagePostgres(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|render\.com/.test(url) ? { rejectUnauthorized: false } : false,
    max: 5,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      reference   TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      heure       TEXT NOT NULL,
      couverts    INTEGER NOT NULL,
      nom         TEXT NOT NULL,
      telephone   TEXT NOT NULL,
      email       TEXT NOT NULL,
      commentaire TEXT NOT NULL DEFAULT '',
      statut      TEXT NOT NULL DEFAULT 'confirmee',
      cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS reservations_date ON reservations (date);
  `);

  return {
    async reservationsDuJour(date, toutes = false) {
      const { rows } = await pool.query(
        `SELECT * FROM reservations WHERE date = $1 ${toutes ? '' : `AND ${ACTIVES}`} ORDER BY heure, cree_le`, [date]);
      return rows;
    },
    async creerSiPlace(r, maxCreneau, maxSoiree) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Verrou par date : deux réservations simultanées ne peuvent pas dépasser la capacité.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [r.date]);
        const { rows } = await client.query(
          `SELECT COALESCE(SUM(couverts),0)::int AS soiree,
                  COALESCE(SUM(couverts) FILTER (WHERE heure = $2),0)::int AS creneau
             FROM reservations WHERE date = $1 AND ${ACTIVES}`, [r.date, r.heure]);
        if (rows[0].creneau + r.couverts > maxCreneau || rows[0].soiree + r.couverts > maxSoiree) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query(
          `INSERT INTO reservations (reference, date, heure, couverts, nom, telephone, email, commentaire)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [r.reference, r.date, r.heure, r.couverts, r.nom, r.telephone, r.email, r.commentaire]);
        await client.query('COMMIT');
        return true;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async lire(reference) {
      const { rows } = await pool.query('SELECT * FROM reservations WHERE reference = $1', [reference]);
      return rows[0] || null;
    },
    async changerStatut(reference, statut) {
      const { rowCount } = await pool.query('UPDATE reservations SET statut = $2 WHERE reference = $1', [reference, statut]);
      return rowCount > 0;
    },
    async supprimer(reference) {
      const { rowCount } = await pool.query('DELETE FROM reservations WHERE reference = $1', [reference]);
      return rowCount > 0;
    },
    async purgerAvant(date) {
      const { rowCount } = await pool.query('DELETE FROM reservations WHERE date < $1', [date]);
      return rowCount;
    },
    async resumeProchainsJours(depuis, nbJours) {
      const { rows } = await pool.query(
        `SELECT date, COUNT(*)::int AS tables, SUM(couverts)::int AS couverts
           FROM reservations WHERE date >= $1 AND ${ACTIVES}
          GROUP BY date ORDER BY date LIMIT $2`, [depuis, nbJours]);
      return rows;
    },
  };
}

function stockageFichier() {
  const fichier = path.join(__dirname, 'reservations.local.json');
  let liste = [];
  try { liste = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { /* premier lancement */ }
  const sauver = () => fs.writeFileSync(fichier, JSON.stringify(liste, null, 2));
  const actives = (r) => r.statut !== 'annulee';
  console.warn('DATABASE_URL absent : réservations stockées dans reservations.local.json (développement uniquement).');

  return {
    async reservationsDuJour(date, toutes = false) {
      return liste.filter((r) => r.date === date && (toutes || actives(r))).sort((a, b) => a.heure.localeCompare(b.heure));
    },
    async creerSiPlace(r, maxCreneau, maxSoiree) {
      const jour = liste.filter((x) => x.date === r.date && actives(x));
      const soiree = jour.reduce((s, x) => s + x.couverts, 0);
      const creneau = jour.filter((x) => x.heure === r.heure).reduce((s, x) => s + x.couverts, 0);
      if (creneau + r.couverts > maxCreneau || soiree + r.couverts > maxSoiree) return false;
      liste.push({ ...r, statut: 'confirmee', cree_le: new Date().toISOString() });
      sauver();
      return true;
    },
    async lire(reference) { return liste.find((r) => r.reference === reference) || null; },
    async changerStatut(reference, statut) {
      const r = liste.find((x) => x.reference === reference);
      if (!r) return false;
      r.statut = statut; sauver(); return true;
    },
    async supprimer(reference) {
      const avant = liste.length;
      liste = liste.filter((r) => r.reference !== reference); sauver();
      return liste.length < avant;
    },
    async purgerAvant(date) {
      const avant = liste.length;
      liste = liste.filter((r) => r.date >= date); sauver();
      return avant - liste.length;
    },
    async resumeProchainsJours(depuis, nbJours) {
      const parJour = {};
      for (const r of liste) {
        if (r.date < depuis || !actives(r)) continue;
        parJour[r.date] ??= { date: r.date, tables: 0, couverts: 0 };
        parJour[r.date].tables += 1;
        parJour[r.date].couverts += r.couverts;
      }
      return Object.values(parJour).sort((a, b) => a.date.localeCompare(b.date)).slice(0, nbJours);
    },
  };
}

async function creerStockage() {
  return process.env.DATABASE_URL ? stockagePostgres(process.env.DATABASE_URL) : stockageFichier();
}

module.exports = { creerStockage };
