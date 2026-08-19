// unifi.js
// Intégration avec le contrôleur UniFi Network (logiciel auto-hébergé, non-UniFi OS).
//
// IMPORTANT : un contrôleur UniFi Network auto-hébergé (installé sur un serveur/PC,
// pas un boîtier UDM/Cloud Gateway) ne supporte PAS les clés API modernes (X-API-KEY).
// Seule l'authentification "classique" (login/mot de passe -> cookie de session)
// fonctionne sur ce type d'installation. C'est ce que ce module utilise.
//
// Si un jour le client migre vers un boîtier UniFi OS (UDM Pro, Cloud Gateway...),
// il faudra remplacer ce module par un client utilisant l'API officielle v1
// (header X-API-KEY, endpoints /v1/sites/{siteId}/clients/{clientId}/actions).
// La doc officielle : https://help.ui.com/hc/en-us/articles/31228198640023

// Node utilise "undici" en interne pour son fetch natif. L'API standard fetch
// n'a pas d'option "agent" façon node-fetch : pour accepter un certificat
// auto-signé (quasi systématique sur un contrôleur UniFi local), il faut
// passer par un dispatcher undici dédié.
const { Agent, setGlobalDispatcher } = require('undici');

const {
  UNIFI_CONTROLLER_URL,   // ex: https://192.168.1.10:8443
  UNIFI_USERNAME,
  UNIFI_PASSWORD,
  UNIFI_SITE = 'default',
  UNIFI_API_PREFIX = '',  // laisser vide pour un contrôleur auto-hébergé classique
  UNIFI_ALLOW_INSECURE_TLS = 'true', // "true" par défaut : certificat auto-signé typique en local
  UNIFI_AUTHORIZE_MINUTES = '480',   // durée d'accès accordée (480 min = 8h)
} = process.env;

if (UNIFI_ALLOW_INSECURE_TLS === 'true') {
  // N'affecte que les appels sortants de ce service (uniquement vers le
  // contrôleur UniFi local) : acceptable pour un certificat auto-signé sur LAN.
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
}

let sessionCookie = null;
let csrfToken = null;

function isConfigured() {
  return Boolean(UNIFI_CONTROLLER_URL && UNIFI_USERNAME && UNIFI_PASSWORD);
}

function baseUrl(pathSuffix) {
  const prefix = UNIFI_API_PREFIX || '';
  return `${UNIFI_CONTROLLER_URL}${prefix}${pathSuffix}`;
}

async function rawFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sessionCookie) headers.Cookie = sessionCookie;
  if (csrfToken) headers['X-Csrf-Token'] = csrfToken;

  const res = await fetch(url, { ...options, headers });
  return res;
}

// Authentifie un compte admin local sur le contrôleur et conserve le cookie de session.
async function login() {
  if (!isConfigured()) {
    throw new Error('UniFi non configuré (UNIFI_CONTROLLER_URL / UNIFI_USERNAME / UNIFI_PASSWORD manquants).');
  }

  const res = await rawFetch(baseUrl('/api/login'), {
    method: 'POST',
    body: JSON.stringify({
      username: UNIFI_USERNAME,
      password: UNIFI_PASSWORD,
      remember: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Échec de connexion au contrôleur UniFi (HTTP ${res.status}).`);
  }

  // Récupère le(s) cookie(s) de session renvoyés (ex: unifises=...).
  // getSetCookie() est la méthode standard pour lire plusieurs en-têtes
  // Set-Cookie distincts (headers.get('set-cookie') ne renverrait qu'une valeur fusionnée).
  const cookieArray = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (cookieArray.length > 0) {
    sessionCookie = cookieArray.map((c) => c.split(';')[0]).join('; ');
  }

  const csrf = res.headers.get('x-csrf-token');
  if (csrf) csrfToken = csrf;

  if (!sessionCookie) {
    throw new Error('Connexion au contrôleur UniFi acceptée mais aucun cookie de session reçu.');
  }
}

async function ensureLoggedIn() {
  if (!sessionCookie) {
    await login();
  }
}

// Autorise un client (par adresse MAC) à accéder à internet via le contrôleur UniFi.
// Réessaie une fois après un nouveau login si la session a expiré (401/403).
async function authorizeGuestByMac(mac, { apMac, minutes } = {}) {
  if (!mac) {
    throw new Error("Adresse MAC du client manquante : impossible d'autoriser l'accès.");
  }
  if (!isConfigured()) {
    throw new Error('UniFi non configuré côté serveur.');
  }

  await ensureLoggedIn();

  const doAuthorize = async () => {
    return rawFetch(baseUrl(`/api/s/${encodeURIComponent(UNIFI_SITE)}/cmd/stamgr`), {
      method: 'POST',
      body: JSON.stringify({
        cmd: 'authorize-guest',
        mac: mac.toLowerCase(),
        minutes: Number(minutes || UNIFI_AUTHORIZE_MINUTES),
        ...(apMac ? { ap_mac: apMac.toLowerCase() } : {}),
      }),
    });
  };

  let res = await doAuthorize();

  if (res.status === 401 || res.status === 403) {
    // Session expirée : on se reconnecte une fois puis on réessaie.
    sessionCookie = null;
    await login();
    res = await doAuthorize();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Échec de l'autorisation UniFi (HTTP ${res.status}) ${body}`.trim());
  }

  const json = await res.json().catch(() => ({}));
  if (json.meta && json.meta.rc && json.meta.rc !== 'ok') {
    throw new Error(`Le contrôleur UniFi a refusé la demande : ${json.meta.msg || 'raison inconnue'}`);
  }

  return true;
}

// Petit diagnostic utilisable pendant la mise en place (voir README).
async function healthCheck() {
  if (!isConfigured()) {
    return { configured: false, ok: false, message: 'Variables UNIFI_* manquantes.' };
  }
  try {
    await login();
    return { configured: true, ok: true, message: 'Connexion au contrôleur UniFi réussie.' };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

module.exports = {
  isConfigured,
  authorizeGuestByMac,
  healthCheck,
};
