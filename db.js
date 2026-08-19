// db.js
// Accès à la base de données via @libsql/client.
// En local : fichier SQLite (TURSO_DATABASE_URL=file:./data/guests.db)
// En production Vercel : base Turso cloud (libsql://....turso.io)

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const dbUrl = process.env.TURSO_DATABASE_URL || 'file:./data/guests.db';

// En mode fichier local, s'assure que le dossier existe.
if (dbUrl.startsWith('file:')) {
  const filePath = dbUrl.slice('file:'.length);
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

const client = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function init() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS guests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL,
      phone         TEXT NOT NULL UNIQUE,
      last_mac      TEXT,
      visit_count   INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// Normalise un numéro de téléphone pour la comparaison / le stockage :
// on retire espaces, points, tirets et parenthèses, mais on garde le "+".
function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s().-]/g, '');
}

async function findByPhone(phone) {
  const result = await client.execute({
    sql: 'SELECT * FROM guests WHERE phone = ?',
    args: [normalizePhone(phone)],
  });
  return result.rows[0] || null;
}

// Crée un nouveau visiteur. Retourne la fiche créée.
async function createGuest({ name, email, phone, mac }) {
  const cleanPhone = normalizePhone(phone);
  await client.execute({
    sql: `INSERT INTO guests (name, email, phone, last_mac, visit_count, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    args: [name.trim(), email.trim(), cleanPhone, mac || null],
  });
  return findByPhone(cleanPhone);
}

// Met à jour un visiteur existant (nouvelle visite). Retourne la fiche à jour.
async function touchGuest(phone, mac) {
  const cleanPhone = normalizePhone(phone);
  await client.execute({
    sql: `UPDATE guests
          SET visit_count = visit_count + 1,
              last_seen_at = datetime('now'),
              last_mac = COALESCE(?, last_mac)
          WHERE phone = ?`,
    args: [mac || null, cleanPhone],
  });
  return findByPhone(cleanPhone);
}

module.exports = { normalizePhone, findByPhone, createGuest, touchGuest, init };
