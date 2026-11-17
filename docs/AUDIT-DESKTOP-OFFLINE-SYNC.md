# AUDIT TECHNIQUE COMPLET — Desktop Windows hors-ligne + synchronisation bidirectionnelle

> Date : 2026-11-13 · Périmètre : application de bureau Electron, installateur NSIS,
> moteur de synchronisation offline-first, stabilité, sécurité.
> Méthode : inspection intégrale du code + exécution réelle des suites de tests
> (`npm run test`, `npm run typecheck`, `npm run lint`) + lecture des journaux
> d'exécution packagée réels. Aucune écriture production.

---

## 0. Baseline de régression mesurée au moment de l'audit

| Contrôle | Résultat mesuré |
|---|---|
| `npm run test` | **19 fichiers passés, 4 ignorés (sans `TEST_DATABASE_URL`) — 200 tests passés, 44 ignorés** |
| `npm run typecheck` | exit 0, aucune erreur |
| `npm run lint` | exit 0, 0 avertissement (`--max-warnings=0`) |
| Installateur existant | `desktop/dist/Clinique-Sahed-Setup-1.0.0.exe` (269 Mo) — build réussi |
| Démarrage packagé réel | Journal `%APPDATA%\Clinique Sahed\startup.log` du 2026-11-02 : boot complet réussi sur un dossier d'installation vierge (`C:\Users\pc\TestFresh\...`) : ports → PG embarqué → 8 migrations → seed → Next standalone prêt en 354 ms → fenêtre ouverte |

Les 44 tests ignorés sont les suites d'intégration PostgreSQL
(`tests/integration/*`, `tests/sync/*`) : elles s'exécutent uniquement quand
`TEST_DATABASE_URL` désigne une base jetable. Elles ne sont **pas simulées**
(convention stricte du dépôt, voir `docs/TESTS.md`).

---

## 1. Ce qui EXISTE et fonctionne (ne pas reconstruire)

### 1.1 Application de bureau 100 % hors-ligne — **conforme**

Vérifié dans `desktop/main.mjs` (655 lignes) et prouvé par le journal packagé :

1. **PostgreSQL embarqué** (`embedded-postgres` 18.4.0-beta.17, binaires
   `@embedded-postgres/windows-x64`) dans `desktop/runtime`, données dans
   `%APPDATA%\Clinique Sahed\clinique\pg` — hors dossier d'installation, donc
   survit à la désinstallation et aux mises à jour
   (`deleteAppDataOnUninstall: false`).
2. **Aucune dépendance externe** : node.exe embarqué (`runtime/node.exe`),
   serveur Next.js standalone embarqué, aucune police/CDN/API distante.
3. **Démarrage ordonné robuste** : vérification amont des ports (détection de
   sockets fantômes par réponse réelle au protocole PostgreSQL SSLRequest —
   panne réelle du cabinet corrigée), nettoyage ciblé des orphelins postgres
   (filtre par chemin exact du dossier de données, jamais « tout postgres.exe »),
   suppression de `postmaster.pid` périmé, choix d'un port de repli
   (54329/54330/54331), migration idempotente à CHAQUE démarrage, seed unique au
   premier lancement, attente HTTP réelle avant ouverture de la fenêtre.
4. **Instance unique** : `app.requestSingleInstanceLock()` — un second
   lancement ramène la fenêtre au premier plan au lieu d'entrer en conflit.
5. **Journalisation persistante** : `%APPDATA%\Clinique Sahed\startup.log`,
   sortie pipée de tous les enfants (migration, seed, Next) — diagnostic
   possible sans console.
6. **Sécurité du renderer** : `contextIsolation: true`,
   `nodeIntegration: false`. Aucun secret production embarqué (le pepper et le
   `SESSION_SECRET` locaux sont dédiés au poste, documentés comme tels).
7. **Authentification locale** : comptes dans la base embarquée, Argon2id +
   pepper local, sentinelle de changement de mot de passe forcé à la première
   connexion (`passwordChangedAt` = epoch). Aucun service d'auth distant.
8. **Installeur NSIS** : oneClick false, choix du répertoire, raccourcis
   (bureau + menu démarrer), désinstallation sans effacement des données
   cliniques.

### 1.2 Backend de synchronisation (côté serveur web) — **conforme et testé**

- `backend/services/sync.service.ts` (580 lignes) : push idempotent
  (`sync_seen_operations`), revocation atomique d'appareil (`SELECT FOR SHARE`
  dans la transaction d'application), conflits conservés en DOUBLE version
  (`sync_conflicts`, `resolution: PENDING`) — **jamais de last-write-wins** pour
  paiements/traitements (statut `A_ARBITRER`, exclu des revenus, vérifié par le
  test 4), TRASH/RESTORE réversibles via `trash_entries`, chevauchement de RDV
  rejeté par double contrôle applicatif + contrainte `EXCLUDE USING gist`
  (`appointments_no_overlap`), journal `sync_events`.
- Routes `/api/sync/push`, `/api/sync/pull`, `/api/sync/appareils` avec double
  authentification (session web + jeton d'appareil haché SHA-256, jamais
  journalisé) et validation Zod stricte (`.strict()`, bornes 500 opérations).
- Migration `20261101000000_sync_offline_first` (32 instructions, non
  destructive) appliquée avec succès sur la base embarquée (journal du 02-11).
- **Tests d'intégration réels** `tests/sync/sync-offline-first.test.ts` (9
  scénarios : idempotence, lot non bloquant, conflit créneau, paiement
  A_ARBITRER exclu des revenus, revocation sans écriture partielle,
  TRASH/RESTORE, contrainte NULL, créneau réutilisable après annulation, export
  chiffré AES-256-GCM).

### 1.3 Modules desktop de synchronisation — **écrits mais non activés** (voir §2)

`desktop/sync/{queue,client,net-watcher,log,export}.mjs` existent :
file persistante en base (table `sync_queue`, statuts PENDING/SYNCING/
SYNCHRONIZED/CONFLICT/REJECTED), backoff exponentiel 0,5 s→60 s, journal sans
données sensibles, export chiffré de la file.

---

## 2. Lacunes réelles identifiées (classées par gravité)

### 🔴 G1 — Le moteur de synchronisation n'est JAMAIS démarré
`desktop/main.mjs` ne référence ni `demarrerWatcher` ni le module
`desktop/sync/*` (vérifié par recherche exhaustive). Le moteur de sync est du
code mort dans l'application livrée : rien ne synchronise.

### 🔴 G2 — Aucun producteur d'opérations dans la file
Aucune écriture métier (patient, RDV, paiement…) n'appelle `queue.enqueue`.
Les modifications réalisées hors ligne ne rentrent JAMAIS dans `sync_queue`.
Sans G1+G2, la « synchronisation bidirectionnelle » n'existe pas à l'exécution.

### 🔴 G3 — L'URL de synchronisation cible le serveur LOCAL, pas la production
`desktop/sync/client.mjs` : `DESKTOP_SYNC_URL ?? 'http://127.0.0.1:43177'` —
c'est le serveur Next du poste lui-même. La sync doit cibler le déploiement
en ligne (HTTPS) avec une session web **de la production** : le cookie
`sahed_session` émis localement n'est pas reconnu par Vercel. Il manque :
la configuration de l'URL en ligne, une procédure de connexion/appairage
contre la production (une fois, quand internet est disponible), et un
transport HTTPS explicite.

### 🔴 G4 — Détection de réseau incorrecte
`desktop/sync/net-watcher.mjs` teste un TCP vers `127.0.0.1:43177` (le serveur
local) : il répondra « en ligne » même sans internet. La détection doit tester
l'Internet réel (HTTPS vers l'URL de production).

### 🔴 G5 — Le pull applique les données distantes en upsert aveugle
`appliquerLotsLocalement` fait `update: patient` / `update: rdv` : écrasement
pur et simple (last-write-wins) des enregistrements modifiés localement —
**viol direct** de la règle « pas de LWW pour les données médicales et
financières ». Le pull doit : (a) ne jamais écraser un enregistrement local
non encore synchronisé (PENDING dans la file) sans produire un conflit local,
(b) appliquer la même politique par entité que le push
(paiements → `A_ARBITRER` local, patients → fusion champ par champ, etc.).

### 🟠 G6 — Les tombstones du pull ne sont pas gérées
Le push a TRASH/RESTORE, mais le pull ne transporte aucun événement de
suppression : un enregistrement supprimé en ligne réapparaît localement à la
prochaine pull (ressucitation), et inversement côté distant. Il faut des
opérations de suppression explicites dans le flux pull (ex. `sync_events`
filtrées, ou tombstones `trash_entries` synchronisés).

### 🟠 G7 — Le périmètre de sync omet prescriptions / dossiers médicaux / odontogramme
`TABLES_SYNC = patients, appointments, treatments, payments, documents`.
Les prescriptions, dossiers médicaux et entrées d'odontogramme ne sont
synchronisés dans aucun sens. La demande les liste explicitement. À traiter
comme extension de périmètre (nouveaux types d'entités dans push/pull + tests).

### 🟠 G8 — La fermeture de la fenêtre arrête le backend et PostgreSQL
`window-all-closed → shutdown()` tue Next et la base. La demande exige le
contraire : la fermeture de la fenêtre ne doit PAS arrêter le backend (le
backend doit survivre / redémarrer). Or il n'y a ni surveillant de santé du
backend, ni relance automatique en cas de crash du serveur local (aujourd'hui :
simple boîte de dialogue), ni service Windows.
Décision d'architecture proposée : backend/PG supervisés par le processus main
(restart avec backoff + limite), fenêtre fermée → backend continue (tray) ;
pas de service Windows séparé (le lock d'instance unique + supervision dans
main couvrent le besoin et évitent un nouveau composant système).

### 🟠 G9 — Aucun indicateur de statut de synchronisation dans l'UI
Prévu par le plan (§2.1 `preload.ts`) mais inexistant : pas de preload, pas
d'IPC, aucun affichage hors-ligne/en-ligne/synchronisation/conflits/pending.

### 🟡 G10 — Divergences de nommage/chemin des livrables
L'installateur est `desktop/dist/Clinique-Sahed-Setup-1.0.0.exe` ; la demande
exige `dist/installer/Sahed-Dental-Clinic-Setup-x64.exe` + procédure USB +
rapport de diagnostic portable. Trivial à aligner (config + scripts de
livraison).

### 🟡 G11 — Installateur non signé
Aucun certificat de signature : avertissement SmartScreen documenté
(`electron-builder.config.cjs`). Bloquant pour une distribution « pro » sans
certificat fourni — blocker externe (cf. §5).

### 🟡 G12 — Version application figée à 1.0.0 dans `prepare.mjs`
`versionApplication = '1.0.0'` codé en dur : les mises à jour USB produiraient
le même numéro. À brancher sur `package.json`.

### 🟡 G13 — Les tests d'intégration de sync ne tournent pas dans la CI locale
Sans `TEST_DATABASE_URL` la suite est ignorée. Pour « prouver » la sync
(exigence §10), il faut fournir une base jetable automatique. La machine de dev
dispose d'`embedded-postgres` : un harnais peut démarrer un PG jetable
éphémère pour la suite `tests/sync` (jamais `sahed_clinic`).

---

## 3. Ce qui est déjà PRUVÉ par exécution (à ne pas re-tester inutilement)

| Preuve | Source |
|---|---|
| Installation + boot complet sans dev tools (node.exe embarqué, PG embarqué, 8 migrations, seed, serveur prêt en 354 ms) | journal `startup.log` du 2026-11-02 sur dossier vierge `TestFresh` |
| Persistance locale après arrêt/relance de PG | `desktop/test-fullstack.mjs` (rapporté), base en AppData |
| Idempotence / conflits / revocation / trash | tests réels `tests/sync` (exécution enregistrée le 01-11, base jetable) |
| Build installateur autonome 269 Mo | `desktop/dist/Clinique-Sahed-Setup-1.0.0.exe` + `rebuild-installer.log` |
| Lint / typecheck / tests unitaires | exécutés à l'instant (§0) |

---

## 4. Points NÉCESSAIREMENT hors de portée de cette machine (déclarés NOT TESTED)

1. **Windows 10 / 11 « fresh install » réels, sans internet** — la machine de
   développement est un Windows 11 64-bit avec outils dev. Le boot packagé a
   été prouvé sur dossier d'installation vierge de CETTE machine ; un test sur
   un PC propre (ou une VM Windows 10 sans outils) n'a pas pu être exécuté ici
   → **NOT TESTED** (procédure de test fournie avec les livrables).
2. **Comportement SmartScreen / AV tiers** sur un installateur non signé →
   **NOT TESTED** (dépend de la réputation du binaire).
3. **Vraie sync contre la production Vercel/Neon** — nécessite les identifiants
   d'appairage autorisés et une fenêtre de test encadrée ; la politique du
   dépôt interdit d'écrire en production sans approbation. Les tests de sync
   tourneront contre une instance de test, puis une vérification encadrée en
   production sera proposée.
4. **Clé de signature de code** — non fournie.

---

## 5. Blockers externes à signaler honnêtement

| # | Blocker | Impact | Contournement |
|---|---|---|---|
| B1 | Pas de certificat de signature de code | Avertissement SmartScreen à la 1ʳᵉ exécution | Documenté ; non bloquant techniquement (l'utilisateur clique « Exécuter quand même ») |
| B2 | Appairage production : il faut un compte autorisé + fenêtre de test encadrée | La vérification de sync « bout en bout » contre Neon reste à encadrer | Sync testée sur instance de test ; production après validation |
| B3 | PC propre / Win10 | Exigence §10.A non prouvable sur cette machine | Procédure USB + checklist fournie ; à exécuter sur le poste cible |

---

## 6. Plan d'implémentation en étapes contrôlées (après audit)

Chaque étape se termine par une validation exécutée (tests/lint/typecheck) avant
de passer à la suivante. Aucune étape ne modifie la production.

**Étape 1 — Câblage du moteur de sync (G1, G3, G4)**
- `main.mjs` démarre le watcher après le serveur local (thread main, jamais
  bloquant pour l'usage).
- Configuration : `DESKTOP_SYNC_URL` (URL de production HTTPS, saisie/configurée
  au premier appairage, stockée dans la base locale), détection d'internet
  réelle (HTTPS vers l'URL de production, timeout court).
- Procédure d'appairage : le desktop ouvre la page de connexion de production
  dans une fenêtre dédiée → l'utilisateur se connecte → appairage de l'appareil
  → jeton stocké chiffré localement (DPAPI). Jamais de secret dans l'installateur.

**Étape 2 — Producteurs d'opérations (G2)**
- Instrumentation des écritures métier du serveur local (patients, RDV,
  traitements, paiements, documents, prescriptions) : chaque CREATE/UPDATE/
  TRASH/RESTORE local effectué « hors ligne » est journalisé dans `sync_queue`
  (opérations effectuées pendant qu'un pull/push distant n'est pas appliqué).
  Idempotence : `operationId` UUID généré une fois, jamais réutilisé.

**Étape 3 — Pull sûr + tombstones (G5, G6)**
- Pull par table avec curseur ; application avec politiques par entité :
  paiements/traitements → conflit local `A_ARBITRER` (jamais d'écrasement) ;
  patients → fusion champ par champ avec signalement ; RDV → respect de la
  contrainte locale ; tombstones → suppression locale réversible.

**Étape 4 — Statut visible dans l'UI (G9)**
- `desktop/preload.js` (contextIsolation conservée) exposant un état de sync
  en lecture seule via IPC ; bandeau discret dans l'interface existante :
  Hors-ligne / En ligne / Synchronisation / À jour / Erreur / N en attente /
  conflits. Aucune modification des fonctionnalités existantes.

**Étape 5 — Stabilité du cycle de vie (G8)**
- Fermer la fenêtre ≠ arrêter le backend : icône tray « Clinique Sahed »,
  le backend continue ; quitter via menu contextuel du tray.
- Surveillant de santé du backend (poll `/api/health`) + relance automatique
  avec backoff et plafond ; diagnostics clairs en cas d'échec de récupération.
- Aucune boucle de restart infinie (plafond, puis message explicite).

**Étape 6 — Livrables installateur + USB (G10, G12)**
- `dist/installer/Sahed-Dental-Clinic-Setup-x64.exe`, version branchée sur
  `package.json`, `docs/INSTALLATION-USB.md` (procédure pas à pas) et script
  de rapport de diagnostic portable (zip des journaux, sans données patient).

**Étape 7 — Harnais de tests d'intégration automatique (G13) + tests E2E sync**
- Démarrage d'un PG jetable via `embedded-postgres` pour `TEST_DATABASE_URL`
  automatiquement lors de `npm run test` (aucune base d'exploitation, garde-fou
  existant conservé).
- Tests d'intégration des nouveaux flux (G2/G3/G5/G6) + scénarios
  interruption/duplication.

**Étape 8 — Rapports finaux**
- Rapport Windows compatibilité, rapport offline/sync, rapport sécurité &
  régression, documentation d'installation/mise à jour.

**Périmètre délibérément différé (avec accord)** : extension de périmètre de
sync aux prescriptions/odontogramme (G7) si la priorité est la mise en service
des 5 tables existantes — décision demandée au livrable.
