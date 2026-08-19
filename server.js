// server.js
// Portail captif : sert la page statique (public/) et expose l'API utilisée
// par le formulaire (recherche visiteur, inscription, retour) qui déclenche
// l'autorisation réseau côté contrôleur UniFi.

require('dotenv').config();

const path = require('path');
const express = require('express');
const db = require('./db');
const unifi = require('./unifi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^\+?[0-9]{6,15}$/.test(db.normalizePhone(phone));

// --- Diagnostic simple, utile en phase d'installation ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/health/unifi', async (req, res) => {
  const result = await unifi.healthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});

// --- 1) L'utilisateur entre son numéro : a-t-on déjà sa fiche ? ---
app.post('/api/lookup', async (req, res) => {
  const { phone } = req.body || {};

  if (!isValidPhone(phone || '')) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  const guest = await db.findByPhone(phone);
  if (guest) {
    return res.json({ found: true, firstName: guest.name.split(' ')[0] });
  }
  return res.json({ found: false });
});

// --- 2a) Nouveau visiteur : formulaire complet (nom, email, tél) ---
app.post('/api/register', async (req, res) => {
  const { name, email, phone, clientMac, apMac } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis.' });
  }
  if (!isValidEmail(email || '')) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (!isValidPhone(phone || '')) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  let guest;
  try {
    const existing = await db.findByPhone(phone);
    guest = existing ? await db.touchGuest(phone, clientMac) : await db.createGuest({ name, email, phone, mac: clientMac });
  } catch (err) {
    console.error('Erreur base de données (register):', err);
    return res.status(500).json({ error: "Impossible d'enregistrer vos informations." });
  }

  let authorized = false;
  let authError = null;
  try {
    await unifi.authorizeGuestByMac(clientMac, { apMac });
    authorized = true;
  } catch (err) {
    authError = err.message;
    console.error('Erreur autorisation UniFi (register):', err.message);
  }

  res.json({
    success: true,
    authorized,
    authError: authorized ? undefined : authError,
    firstName: guest.name.split(' ')[0],
  });
});

// --- 2b) Visiteur connu : juste le téléphone -> "bon retour" ---
app.post('/api/checkin', async (req, res) => {
  const { phone, clientMac, apMac } = req.body || {};

  if (!isValidPhone(phone || '')) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  const existing = await db.findByPhone(phone);
  if (!existing) {
    // Cas limite (ex: fiche supprimée entre-temps) : le front doit basculer
    // sur le formulaire complet plutôt que d'afficher une erreur sèche.
    return res.status(404).json({ error: 'Aucune fiche trouvée pour ce numéro.' });
  }

  const guest = await db.touchGuest(phone, clientMac);

  let authorized = false;
  let authError = null;
  try {
    await unifi.authorizeGuestByMac(clientMac, { apMac });
    authorized = true;
  } catch (err) {
    authError = err.message;
    console.error('Erreur autorisation UniFi (checkin):', err.message);
  }

  res.json({
    success: true,
    authorized,
    authError: authorized ? undefined : authError,
    firstName: guest.name.split(' ')[0],
  });
});

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Portail captif démarré sur le port ${PORT}`);
    if (!unifi.isConfigured()) {
      console.warn('⚠️  Variables UNIFI_* non configurées : les visiteurs seront enregistrés mais pas autorisés automatiquement.');
    }
  });
}).catch((err) => {
  console.error('Erreur initialisation base de données:', err);
  process.exit(1);
});
