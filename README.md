# Portail captif — Nom / Email / Téléphone

Portail captif Wi-Fi minimaliste (HTML/CSS/JS vanilla + Node.js + SQLite) qui :

- demande **nom, email, téléphone** à un nouveau visiteur avant de l'autoriser sur internet ;
- ne redemande que le **téléphone** à un visiteur déjà connu, et affiche un message de bienvenue ;
- s'intègre au contrôleur **UniFi Network** auto-hébergé du client pour autoriser réellement l'accès (portail "External Portal").

## Pourquoi pas Vercel

Le contrôleur UniFi du client est **auto-hébergé sur son réseau local** (IP privée). L'application doit pouvoir l'appeler directement pour autoriser chaque appareil — ce qui est impossible depuis une fonction serverless dans le cloud. Cette app est donc pensée pour tourner **sur une machine du réseau du client** (mini-PC, NAS, Raspberry Pi...), dans Docker.

## 1. Déployer l'app

```bash
cp .env.example .env
# éditez .env avec les vraies valeurs (voir section 2 ci-dessous)

docker compose up -d --build
```

L'app écoute sur le port `3000`. Vérifiez qu'elle tourne :

```bash
curl http://localhost:3000/api/health
# -> {"ok":true}
```

## 2. Configurer l'accès au contrôleur UniFi

Le contrôleur étant auto-hébergé (pas un boîtier UDM/Cloud Gateway), il **ne supporte pas** les clés API modernes — seule l'authentification classique (compte local + mot de passe) fonctionne.

1. Dans l'interface du contrôleur UniFi, créez un **compte administrateur local dédié** (évitez un compte cloud Ubiquiti : le 2FA cloud casse ce type d'intégration).
2. Renseignez `UNIFI_CONTROLLER_URL`, `UNIFI_USERNAME`, `UNIFI_PASSWORD`, `UNIFI_SITE` dans `.env`.
3. Testez la connexion :

```bash
curl http://localhost:3000/api/health/unifi
```

Si ça échoue, vérifiez en particulier :
- que la machine qui héberge Docker peut bien joindre le contrôleur (`ping`, `curl -k https://IP_CONTROLEUR:8443` depuis la même machine) ;
- le port (8443 par défaut pour une install auto-hébergée classique) ;
- que `UNIFI_SITE` correspond bien au nom du site (visible dans l'URL de l'interface UniFi, ex: `.../manage/site/default/...` → `default`).

## 3. Configurer le portail externe dans UniFi

Dans l'interface du contrôleur :

1. **Réseaux invités > Hotspot Portal** (ou *Settings > Hotspot* selon la version).
2. Activez **External Portal Server** et indiquez l'URL de cette app, par exemple :
   `http://IP_DU_SERVEUR:3000/`
3. Dans les **Pre-Authorization Allowances** (walled garden), ajoutez l'IP ou le nom d'hôte de cette app — sinon les visiteurs non authentifiés ne pourront pas charger la page du portail elle-même.
4. Assignez ce portail au SSID invité concerné.

UniFi redirigera alors chaque nouvel appareil vers `http://IP_DU_SERVEUR:3000/?ap=...&id=...&ssid=...&url=...`. L'app lit automatiquement ces paramètres (adresse MAC du client, SSID, page d'origine) pour autoriser le bon appareil et rediriger vers la bonne destination après connexion.

## 4. Fonctionnement du flux

1. Le visiteur arrive sur la page → on lui demande **uniquement le téléphone**.
2. Le serveur vérifie en base :
   - **numéro connu** → message "Bon retour parmi nous" + autorisation automatique ;
   - **numéro inconnu** → on affiche les champs **nom + email** pour compléter l'inscription, puis on autorise.
3. Dans les deux cas, le serveur appelle le contrôleur UniFi (`authorize-guest`) pour débloquer l'adresse MAC de l'appareil, puis redirige le visiteur vers la page qu'il essayait de visiter à l'origine.

Note : les smartphones récents randomisent leur adresse MAC par réseau, donc on ne s'appuie jamais sur le MAC pour *reconnaître* un visiteur — seulement pour l'autoriser une fois identifié par téléphone.

## 5. Données stockées

Table SQLite unique `guests` (fichier `data/guests.db`, persisté via le volume Docker) :

| Colonne | Description |
|---|---|
| `name`, `email`, `phone` | saisis à la première visite |
| `visit_count` | nombre de connexions |
| `first_seen_at` / `last_seen_at` | horodatage première/dernière visite |
| `last_mac` | dernière adresse MAC vue (indicatif seulement) |

## 6. Si le client migre un jour vers un boîtier UniFi OS

(UDM Pro, Cloud Gateway...) : ces appareils supportent l'API officielle moderne par clé API (`X-API-KEY`). Il faudra alors remplacer `unifi.js` par un client utilisant l'API v1 documentée par Ubiquiti :
`https://help.ui.com/hc/en-us/articles/31228198640023`

## Structure du projet

```
.
├── server.js        # routes API (lookup, register, checkin)
├── unifi.js          # intégration contrôleur UniFi (login + authorize-guest)
├── db.js              # accès SQLite (better-sqlite3)
├── public/            # front vanilla HTML/CSS/JS
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
