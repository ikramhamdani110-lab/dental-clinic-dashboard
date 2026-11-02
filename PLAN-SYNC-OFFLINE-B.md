# PLAN TECHNIQUE — OPTION B OFFLINE-FIRST (v4, 2026-11-01)

> **v3** : précisions apportées sur (1) double réservation de rendez-vous,
(2) conflits de champs patients, (3) sort de la corbeille après 24 h,
(4) impact des statuts `A_ARBITRER` sur les soldes/rapports, (5) scénarios
de panne/redémarrage/reconnexion/répétition/révocation, avec les tests
qui démontrent chaque garantie (§4). Aucune écriture production.

> **v4** : dernière vérification technique — détail SQL de la contrainte
anti-chevauchement (`&&`, `btree_gist`, NULL/annulés/chevauchements pré‑existants,
présence sur Neon ET en local), rôle d'autorité de Neon pour les créneaux,
conversions de violations en `CONFLIT_A_ARBITRER` sans bloquer la file,
course critique révocation/push, récupération de l'export chiffré après
réinstallation. Tests correspondants ajoutés en §4. Aucune écriture production.

**Statut : plan soumis à approbation. AUCUNE écriture production effectuée.**Ce plan remplace la partie « Option A/B/C » de
`PLAN-MISE-EN-SERVICE-DEFINITIF.md`. Les sections comptes, sécurité, migration
et risques y restent valables.

---

## 1. ARCHITECTURE OFFLINE-FIRST (décision : Option B)

### 1.1 Principe

- **Application Windows (Electron)** : garde sa base PostgreSQL embarquée
  (`embedded-postgres`, port 54329, base `sahed_clinic`) comme **réplique
  locale**. Utilisable 100 % hors ligne.
- **Site secrétaire (Vercel)** et **site financier `/finances`** : pointent
  vers **Neon** (`sahed-dental-clinic` / `main` / `neondb`), **autorité
  centrale**.
- **Synchronisation bidirectionnelle** : locale ⇄ Neon, déclenchée à la
  reconnexion réseau + toutes les 60 s tant que la connexion est active.

### 1.2 Composants à créer

| Composant | Fichier (nouveau) | Rôle |
|---|---|---|
| File d'attente locale persistante | `desktop/sync/queue.ts` | Journalise chaque opération métier hors ligne (création/modification/suppression) avec `operationId` UUID v4 et horodatage |
| Client de synchronisation | `desktop/sync/client.ts` | Pousse la file locale vers l'API de sync, tire les changements distants |
| API de synchronisation (serveur web) | `src/app/api/sync/push/route.ts`, `src/app/api/sync/pull/route.ts` | Reçoit/envoie les delta (auth obligatoire, session secrétaire OU médecin) |
| Table de suivi des versions | migration Prisma `sync_state` | Un compteur monotonique par table métier (patients, appointments, treatments documents, odontogram_entries) |
| Journal de synchronisation | `desktop/sync/log.ts` + table `sync_events` (locale) | Trace horodatée de chaque push/pull/conflit/rate |
| Détection réseau + reprise auto | `desktop/sync/net-watcher.ts` | Écoute `navigator.onLine` + test TCP Neon ; relance auto la synchro à la reconnexion |

### 1.3 Flux de synchronisation

```
Desktop hors ligne ──► opérations locales écrites dans la base embarquée
                    └─ ET dans la file (queue) avec operationId UUID

Desktop en ligne  ──► 1. PULL : récupère les changements distants (delta)
                         depuis le dernier `lastPulledAt` (table sync_state)
                      2. PUSH : envoie la file locale dans l'ordre
                         chronologique, une opération = une requête
                         idempotente (operationId en clé d'idempotence)
                      3. CONFLIT : si le serveur détecte un changement
                         concurrent (updatedAt > lastPulledAt ET champ
                         incompatible) → CONSERVATION DES DEUX VERSIONS +
                         résolution manuelle via une file « conflits »
                      4. COMMIT local : marque les opérations comme
                         synchronisées, purge la file
```

### 1.4 Idempotence et anti-doublons

- Chaque opération porte un **`operationId` UUID v4** généré une seule fois
  côté desktop, jamais réutilisé.
- L'API de sync maintient une table `sync_seen_operations(operationId,
  receivedAt)` : rejouer la même opération est **sans effet** (réponse 200
  avec `alreadyApplied: true`).
- Les IDs métier (patients, rendez‑vous, traitements, paiements) sont des
  **UUID générés côté client** au moment de la création hors ligne, jamais
  par la base → pas de collision à la synchro.
- Détection de doublon « métier » : un patient créé hors ligne avec le même
  `nom + prenom + dateNaissance + telephone` qu'un patient déjà connu
  provoque une **alerte manuelle** dans le journal de sync (pas de fusion
  automatique).

### 1.5 Conflits — règles métier explicites

**Aucune règle « dernière modification gagnante » pour les données
médicales ou financières.**

| Donnée | Règle de résolution |
|---|---|
| `payments` | **Jamais auto‑résolu.** Les deux versions sont conservées, une alerte est créée pour le médecin ; le paiement en conflit est mis en statut `A_ARBITRER` tant que le médecin n'a pas choisi. Aucune écriture silencieuse. Voir §1.5quater pour l'impact sur les soldes. |
| `treatments` | Idem — conflit ⇒ verrou en lecture seule + alerte, choix manuel par le médecin. Impact sur le « reste à payer » : §1.5quater. |
| `medical_records`, `prescriptions` | Idem — verrou en lecture + alerte. |
| `patients` (fiche administrative) | Fusion **champ par champ** : les champs non modifiés côté desktop prennent la valeur distante ; les champs modifiés des deux côtés sont signalés dans le journal et laissés à la valeur distante (jamais écrasés silencieusement, toujours journalisés). |
| `appointments` | **Double réservation impossible** — voir §1.5bis. |
| `documents` | Jamais écrasés ; version locale conservée sous `documents/<uuid>-local`, version distante sous `documents/<uuid>-remote`, arbitrage manuel. |
| `patients` — champ modifié des DEUX côtés | **Conserver les DEUX versions et arbitrer** (aucun écrasement silencieux) — voir §1.5ter. |

### 1.5bis Double réservation de rendez-vous (desktop + site simultanés)

**Problème** : deux utilisateurs (desktop hors ligne, secrétaire en ligne)
peuvent réserver le même créneau pour le même praticien en même temps.

#### 1.5bis-a Détail SQL de la contrainte anti-chevauchement

**Extension requise** : `btree_gist` (fournie par PostgreSQL standard,
package `postgresql-contrib`, incluse dans `embedded-postgres` et
disponible sur Neon). Vérifiée au démarrage de la migration :

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

La contrainte utilise des **intervalles horaires réels** (type `tstzrange`)
avec l'**opérateur de chevauchement `&&`** :

```sql
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
EXCLUDE USING gist (
  praticien_id WITH =,
  creneau WITH &&          -- chevauchement d'intervalles tstzrange
) WHERE (statut IS DISTINCT FROM 'ANNULE' AND statut IS NOT NULL);
```

Choix techniques :
- **`tstzrange`** (timestamp with time zone range), et non deux colonnes
  début/fin : `&&` gère nativement le chevauchement, y compris les cas
  limites (bornes incluses/exclusives `'[a,b)'` — demi‑ouvert par défaut,
  évitant qu'un RDV 10h00–10h30 et un RDV 10h30–11h00 soient considérés
  comme chevauchants, ce qui est le comportement attendu).
- **`WHERE statut IS DISTINCT FROM 'ANNULE'`** : les RDV annulés ne
  participent plus à la contrainte (un annulé peut être remplacé par un
  nouveau RDV sur le même créneau).
- **`statut IS NOT NULL` inclus via `IS DISTINCT FROM`** : un statut NULL
  est traité comme « non annulé » et participe donc à la contrainte — pas
  de trou de sécurité via un statut non renseigné.

#### 1.5bis-b Chevauchements déjà présents avant la migration

Si des RDV qui se chevauchent existent déjà en base au moment de la
migration, `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE` échouera avec une
erreur PostgreSQL explicite (`could not create constraint`). Le plan :

1. La migration **commence par un diagnostic en lecture seule** :
   ```sql
   SELECT a.id, a.creneau, b.id, b.creneau
   FROM appointments a JOIN appointments b
     ON a.praticien_id = b.praticien_id
    AND a.id < b.id
    AND a.creneau && b.creneau
    AND a.statut IS DISTINCT FROM 'ANNULE'
    AND b.statut IS DISTINCT FROM 'ANNULE';
   ```
2. Si le résultat est **non vide**, la migration **s'arrête sans rien
   modifier** et retourne la liste des paires en conflit à l'opérateur,
   qui arbitre manuellement (annulation d'un des deux, décalage, etc.).
3. La migration est **relancée** uniquement après correction — toujours
   sur approbation explicite.
4. Si le résultat est vide, la contrainte est créée directement, sans
   risque.

(Inventaire préliminaire : l'inventaire des RDV de production du
2026‑11‑01 montre des créneaux espacés d'au moins une journée — aucun
chevauchement prévisible à ce stade. Ce diagnostic sera rejoué au moment
de la migration pour confirmation sur données réelles.)

#### 1.5bis-c Présence de la contrainte sur Neon ET en local

La contrainte fait partie de la migration Prisma
`add_appointments_overlap_constraint`, appliquée :
- sur **Neon** via `prisma migrate deploy` (Phase 1),
- sur **la base locale embarquée** via le même chemin de migration, joué
  automatiquement au démarrage de l'app desktop (`migrate.mjs` exécute
  `prisma migrate deploy` sur la base locale à chaque lancement).

La base locale reçoit donc la **même contrainte** que Neon, garantissant
que le comportement de double réservation est identique hors ligne et en
ligne. Un test dédié vérifie que la contrainte existe bien sur les deux
bases (§4, `sync-appointment-overlap-db.test.ts`).

#### 1.5bis-d Neon reste l'autorité finale

**Oui — Neon est l'autorité** pour les conflits de créneaux :

- Le site secrétaire et le site financier écrivent **directement** dans
  Neon : la contrainte s'applique immédiatement.
- Le desktop pousse ses RDV vers Neon via l'API de sync : c'est Neon qui
  accepte ou rejette (contrainte EXCLUDE + vérification métier).
- La base locale embarquée a aussi la contrainte, mais elle n'a qu'un
  pouvoir **local** : elle empêche les chevauchements visibles localement.
  Un RDV créé hors ligne peut tout à fait entrer en conflit avec un RDV
  créé en ligne pendant la coupure — seul le push sur Neon tranche.

#### 1.5bis-e Conversion d'une violation en `CONFLIT_A_ARBITRER` sans bloquer la file

Au moment du push d'un RDV, si Neon renvoie l'erreur PostgreSQL
`exclusion_violation` (code SQLSTATE `23P01`) :

1. L'API de sync **n'interrompt pas** le traitement de la file : cette
   opération est marquée `CONFLIT_A_ARBITRER` (statut de l'opération,
   table `sync_queue` locale), avec le détail du RDV en conflit.
2. Les opérations **suivantes** de la file (patients, traitements,
   documents…) continuent d'être poussées normalement — la violation
   n'est pas fatale, elle est **isolée par opération**.
3. L'opération en conflit est **retirée du flux actif** mais **pas
   supprimée** : elle reste dans la file, visible dans l'UI desktop et le
   site secrétaire comme « à arbitrer ».
4. Un médecin ou un secrétaire arbitre (choisir un créneau, décaler,
   annuler). L'arbitrage est journalisé. Après arbitrage, une nouvelle
   opération est générée (nouvel `operationId`) et repoussée.
5. L'opération originale n'est jamais rejetée silencieusement ni perdue :
   son `operationId` reste en `sync_seen_operations` pour idempotence.

### 1.5ter Patient — champ modifié des deux côtés hors ligne

Quand un même champ (ex. téléphone) est modifié sur le desktop ET sur le site
pendant que les deux étaient hors ligne :

- **Les deux valeurs sont conservées** (table `sync_conflicts` :
  `entity_id`, `field`, `local_value`, `remote_value`, `localUpdatedAt`,
  `remoteUpdatedAt`, `deviceId`).
- La fiche patient affiche un **bandeau de conflit** listant chaque champ en
  désaccord, avec les deux valeurs et leur date.
- Le **secrétaire ou le médecin choisit** la valeur à conserver (ou saisit
  une troisième valeur). Tant que l'arbitrage n'est pas fait, la valeur
  **distante** est affichée (jamais la locale, jamais un mélange
  automatique), et le champ est marqué visuellement « en conflit ».
- Aucune écriture automatique n'écrase l'une des deux valeurs : la décision
  est journalisée (`activity_logs`) avec l'auteur et l'horodatage.

### 1.5quater Paiements et traitements « A_ARBITRER » — impact sur les soldes

**Garantie : aucun élément en conflit ne fausse les chiffres.**

- Un paiement en statut `A_ARBITRER` est **exclu** de tous les calculs
  financiers : « Revenus du jour », « Chiffre d'affaires », rapports,
  synthèses, reste à payer. La fonction de cumul filtrée est centralisée
  dans `backend/domain/finance.ts` (une seule source).
- Un traitement en conflit (verrouillé) : son « reste à payer » est calculé
  **uniquement à partir des paiements non en conflit** — jamais avec une
  valeur provisoire ni une moyenne des deux versions.
- L'interface affiche clairement : badge « en arbitrage » sur la ligne, et
  un compteur global « N éléments en attente d'arbitrage » sur le tableau de
  bord médecin. Aucun chiffre n'est présenté comme définitif tant qu'un
  arbitrage est en cours sur la période concernée.
- Après résolution du conflit (choix de la version à conserver), le statut
  repasse à `VALIDE`, les cumuls et rapports sont recalculés, et
  l'arbitrage est journalisé (auteur, date, version choisie, version
  écartée conservée en archive `sync_conflicts.archivedPayload`).
- **Aucun automatisme ne résout un conflit financier** : uniquement un
  médecin authentifié sur `/finances` ou sur l'app desktop.

### 1.6 Suppressions et restaurations

- Les suppressions passent **uniquement par la corbeille applicative**
  (`trash_entries`) — jamais un `DELETE` direct dans la file de sync.
- Une suppression hors ligne devient une opération `TRASH(entity, id,
  deletedById, deletedAt)` ; le serveur la rejoue de façon idempotente.
- La restauration depuis la corbeille (dans la fenêtre 24 h) est également
  une opération de sync (type `RESTORE`), réversible.
- Une suppression locale ET distante du même objet ne crée pas de conflit :
  c'est le même acte, journalisé deux fois, idempotent.

### 1.6bis Que se passe‑t‑il après les 24 heures de corbeille ?

- À l'expiration des 24 h, l'entrée `trash_entries` **n'est PAS supprimée** :
  elle passe en statut `EXPIREE` (colonne `expiredAt` renseignée).
- Un enregistrement expiré **reste lisible** dans la corbeille (onglet
  « Expirées »), mais **n'est plus restaurable depuis l'interface** : c'est
  une garde‑fémeture volontaire pour éviter des résurrections surprises
  après un mois d'utilisation.
- **Aucune suppression définitive automatique** n'existe dans le code : la
  purge physique (DELETE des lignes) n'est faite QUE par un script
  d'administration explicite, lancé manuellement, avec :
  - une liste d'IDs exacte passée en argument (jamais « tout ce qui est
    expiré »),
  - un affichage préalable du décompte et des IDs concernés,
  - une confirmation interactive (`--oui-je-confirme` obligatoire),
  - un backup fraîche effectué **juste avant** (requis, sinon le script
    refuse de s'exécuter),
  - une écriture dans `activity_logs` avec l'auteur, la date et la liste.
- En pratique, une purge définitive ne peut donc se produire qu'avec
  **validation explicite** de l'opérateur, sur une liste précise, avec backup
  préalable — jamais automatiquement, jamais en masse, jamais silencieusement.

### 1.7 Protection contre les pertes de données

- La file locale est **persistée dans la base embarquée** (table
  `sync_queue`), pas en mémoire — elle survit à un crash, à un redémarrage
  et à une coupure secteur.
- `fsync` WAL activé sur le cluster embarqué (déjà le cas via
  `embedded-postgres`).
- Avant chaque push, un **snapshot local chiffré** de la file est écrit sur
  disque (dossier `AppData/clinique/sync-backup/`), supprimé après ack
  serveur.
- Aucune purge de la file tant que le serveur n'a pas confirmé
  `alreadyApplied` ou `applied`.

### 1.8 Authentification des appareils + chiffrement

- Chaque installation desktop reçoit un **`deviceId`** stable (UUID persisté
  dans `AppData`) et un **jeton d'appareil** (`device_token`), dérivé d'un
  échange signé à la première association avec un compte utilisateur valide
  (session secrétaire ou médecin).
- Le jeton d'appareil est stocké chiffré via `safeStorage` Electron
  (chiffré par le DPAPI Windows, jamais en clair sur disque).
- Toutes les communications desktop ⇄ Neon passent par **HTTPS/TLS 1.3**
  (`sslmode=verify-full` pour Postgres, HTTPS pour l'API de sync).
- La clé de session Neon **n'est jamais embarquée dans le bundle desktop** :
  elle réside dans un petit serveur de sync (ou dans les fonctions Vercel
  existantes) et le desktop ne parle qu'à l'API de sync, jamais directement
  à Postgres Neon. **Aucune chaîne de connexion dans le code source.**
- Les jetons sont révocables côté serveur (table `device_sessions`).

### 1.9 Scénarios de panne, redémarrage, reconnexion, répétition, révocation

| Scénario | Comportement garanti |
|---|---|
| **Panne réseau en cours de push** | Chaque opération est poussée **une par une** avec ack serveur. Une opération envoyée mais dont l'ack est perdu est rejouée : grâce à `sync_seen_operations`, le serveur répond `alreadyApplied` sans dupliquer. Aucune perte, aucun doublon. |
| **Redémarrage brutal du poste (coupure secteur) pendant une écriture locale** | La file est en base embarquée (WAL + fsync) : au redémarrage, PostgreSQL rejoue son WAL et la file est intacte. Les opérations non commit‐ées localement sont perdues **avant** d'avoir été visibles à l'utilisateur — jamais après. |
| **Redémarrage propre de l'application** | Au démarrage, le watcher de sync relit la file restante et reprend exactement où il s'était arrêté (curseur `lastPulledAt` persisté dans `sync_state`). |
| **Reconnexion après une longue coupure** | Le watcher détecte le retour réseau (test TCP + `navigator.onLine`), attend 5 s de stabilité, puis lance un cycle PULL puis PUSH. Les opérations distantes accumulées pendant la coupure sont d'abord tirées (pour détecter les conflits **avant** d'écraser quoi que ce soit), puis la file locale est poussée. |
| **Répétition d'une même opération (double‑clic, retry applicatif, crash entre ack et commit local)** | L'`operationId` fait foi : le serveur répond `alreadyApplied`, aucun effet de bord. Testé explicitement (§4, `sync-idempotence.test.ts`). |
| **Révocation d'un appareil (perte, vol, remplacement)** | L'opérateur révoque le `deviceId` depuis `/parametres` (liste des appareils) : le jeton est marqué révoqué en base (`device_sessions.revokedAt`). Le desktop concerné reçoit un `403 DEVICE_REVOKED` à la prochaine sync et **affiche un message clair** : il bascule en mode « hors ligne définitif » (il peut continuer à lire sa base locale mais ne peut plus pousser ni tirer). Les données non synchronisées restent sur le poste, exportables en JSON chiffré pour réimport manuel sur le nouvel appareil. Détail du point critique révocation/push : §1.8bis. |
| **Export après réinstallation de Windows** | Procédure décrite en §1.8ter : la clé de déchiffrement n'est pas sur le poste — elle est re‑dérivée à partir d'une phrase de récupération détenue par l'utilisateur, jamais stockée sur disque. |

#### 1.8bis Course critique : révocation exactement pendant un push

Problème : le desktop a déjà envoyé une opération, le serveur la
authentifie, puis la révocation est committée avant que le serveur n'ait
fini d'appliquer. Deux protections :

1. **Vérification au commit, pas seulement à l'entrée** : la révocation est
   lue (SELECT `revokedAt IS NULL`) **dans la même transaction** que
   l'application de l'opération (`SELECT ... FOR SHARE` sur la ligne
   `device_sessions`). Si la révocation a été committée entre‑temps,
   PostgreSQL bloque l'application (attente de verrou) et rejoue la
   lecture : le serveur voit `revokedAt != NULL` et rejette l'opération
   **sans l'appliquer**.
2. **Ordre de commit garanti** : soit l'opération est appliquée
   complètement (et la révocation arrive après, visible à la prochaine
   sync), soit elle est rejetée complètement. **Jamais partiellement** :
   un push est une transaction unique (opération + mise à jour
   `sync_seen_operations` + incrément `sync_state`).
3. Test dédié : `sync-device-revocation-race.test.ts` — simule une
   révocation **exactement entre** l'authentification du push et son
   commit, et vérifie qu'aucune écriture partielle ne survient.

#### 1.8ter Export chiffré — récupération après réinstallation

**Contenu de l'export** : la file d'opérations non synchronisées, chiffrée
en **AES‑256‑GCM**, écrite dans `AppData/clinique/sync-backup/<horodatage>.
syncbak`.

**Où vit la clé de déchiffrement ? Pas sur le poste.**

- À l'appairage initial de l'appareil, le serveur de sync génère une
  **phrase de récupération** de 12 mots (BIP39, ~128 bits d'entropie),
  affichée **une seule fois** à l'utilisateur (écran « Sauvez votre phrase
  de récupération ») et hachée côté serveur (Argon2id).
- La clé AES‑256 de chiffrement des exports est **dérivée** de cette
  phrase via PBKDF2 (600 000 itérations, sel aléatoire par appareil,
  jamais stockée). Le poste ne conserve que le **sel** et les paramètres,
  jamais la clé ni la phrase.
- **Après réinstallation de Windows ou changement de poste** :
  1. L'utilisateur installe l'app sur le nouveau poste.
  2. Il saisit la **phrase de récupération** (qu'il a conservée sur papier
     ou dans un gestionnaire de mots de passe personnel).
  3. L'app re‑dérive la clé PBKDF2 à partir de cette phrase et du sel
     (récupéré du fichier `.syncbak` lui‑même), déchiffre l'export, et
     rejoue les opérations dans la file locale.
- **Sécurité** : la phrase n'est jamais envoyée au serveur (le haché côté
  serveur sert uniquement à vérifier la phrase lors d'un ré‑appairage).
  Sans la phrase, l'export est inexploitable même si le disque est volé.
  La perte de la phrase rend l'export irrécupérable — c'est assumé, et
  l'utilisateur est averti explicitement à l'appairage (case à cocher «
  j'ai sauvegardé ma phrase »).
- Le fichier exporté reste également utilisable **sans réinstallation** :
  l'opérateur peut le copier sur une clé USB chiffrée (BitLocker To Go)
  comme sauvegarde additionnelle.
| **Conflit de révocation** (opération en vol au moment de la révocation) | Le serveur accepte une opération **déjà authentifiée** avant la révocation, puis refuse les suivantes. Aucune opération n'est partiellement appliquée : chaque push est transactionnel. |
| **Base locale corrompue** (disque défaillant) | Le journal de sync + le snapshot chiffré de la file permettent de rejouer les opérations non acquittées sur une base fraîche restaurée depuis Neon. Aucune donnée acquittée par le serveur ne peut être perdue. |

---

## 2. MODIFICATIONS NÉCESSAIRES (fichiers concernés)

### 2.1 Desktop (Electron, offline)

| Fichier | Changement |
|---|---|
| `desktop/sync/queue.ts` | **Nouveau** — file persistante d'opérations |
| `desktop/sync/client.ts` | **Nouveau** — client push/pull |
| `desktop/sync/net-watcher.ts` | **Nouveau** — détection réseau |
| `desktop/sync/log.ts` | **Nouveau** — journal de sync |
| `desktop/main.mjs` | Démarrage du watcher de sync au lancement ; maintien de la base embarquée |
| `desktop/preload.ts` (s'il existe) ou équivalent | Exposer à l'UI l'état de sync (dernière synchro, file en attente, conflits) |

### 2.2 Backend (Next.js + API de sync)

| Fichier | Changement |
|---|---|
| `src/app/api/sync/push/route.ts` | **Nouveau** — réception des opérations desktop, idempotence, arbitrage des conflits |
| `src/app/api/sync/pull/route.ts` | **Nouveau** — envoi des deltas distants |
| `backend/services/sync.service.ts` | **Nouveau** — logique métier (deltas, idempotence, détection de conflits) |
| `backend/auth/authorization.ts` | `UTILISATEURS_ACTIFS = ['MEDECIN', 'ASSISTANT']` (une ligne) |
| `backend/services/finances.service.ts` | Aucun changement — l'isolation MEDECIN-only existe déjà (`connexionFinanciere`) |
| `backend/domain/finance.ts` | Exclusion explicite des statuts `A_ARBITRER` des cumuls (revenus, rapports, reste à payer) — **un seul endroit**, testé |
| `backend/validation/schemas.ts` | Schemas de validation des payloads de sync |

### 2.3 Base de données (migrations Prisma, **toutes non destructives**)

| Migration | Contenu |
|---|---|
| `add_sync_tables` | Tables `sync_state`, `sync_seen_operations`, `sync_events`, `device_sessions`, `sync_conflicts`, colonne `statut` sur `payments`/`treatments` (valeur par défaut `VALIDE`, aucune donnée modifiée) — **aucun DROP** |
| `add_btree_gist_and_overlap_constraint` | 1) `CREATE EXTENSION IF NOT EXISTS btree_gist` (disponible sur Neon et dans `embedded-postgres`) ; 2) diagnostic en lecture seule des chevauchements pré‑existants (arrêt si non vide) ; 3) `ALTER TABLE appointments ADD CONSTRAINT ... EXCLUDE USING gist (praticien_id WITH =, creneau WITH &&) WHERE (statut IS DISTINCT FROM 'ANNULE')` — **création uniquement, aucune suppression/modification de données** |
| (déjà écrites) | `finance_sessions`, index partiels et contraintes PostgreSQL — appliquées via `prisma migrate deploy` |

**Aucune migration destructive** n'est prévue.

### 2.4 Comptes (créés au moment de l'approbation, jamais dans le code)

| App | Email | Rôle | MDP temporaire fort (généré aléatoirement par script, jamais commité) | Changement forcé |
|---|---|---|---|---|
| Secrétaire web + desktop | `clinic@gmail.dz` | ASSISTANT | (mot de passe aléatoire 20+ caractères, fourni par canal sécurisé) | ✅ sentinelle |
| Médecin | `sahed@gmail.dz` | MEDECIN | (mot de passe aléatoire 20+ caractères, fourni par canal sécurisé) | ✅ sentinelle |

- **Le compte secrétaire est UNIQUE** : le même `clinic@gmail.dz` servira au
  site secrétaire et à l'app desktop (même base de comptes après sync).
- `demo@cabinet.dz` : **désactivation** (`isActive=false`), pas de suppression.
- Aucun mot de passe partagé en chat n'est réutilisé comme mot de passe
  définitif.

---

## 3. INVENTAIRE DES 6 PATIENTS DE TEST (lecture seule, vérifié en prod)

IDs exacts relevés sur Neon le 2026‑11‑01 (aucune écriture) :

| # | Nom | Prénom | ID | Tél | RDV | Trait. | Paiem. | Dossiers | Ord. | Docs | Odonto |
|---|---|---|---|---|---|---|---|
| 1 | Age18909757 | Test | `fdc2f158-88ec-4935-b677-d7ea42c6783e` | 0544567890 | 2 | 2 | 2 | 0 | 0 | 0 | 0 |
| 2 | dfghjk | dfghjkl | `6327fa6e-d8e8-4f4d-bf69-987d67c2f014` | 1234567890 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| 3 | asdhl;' | sdfghjk | `fd9d2f33-ac86-495a-b070-a37f00d1c09e` | 234567890 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4 | wsdfj | sdfgh | `b6647c06-d14a-40d0-9001-0a081893dba0` | 234567 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 5 | asddsdff | sahed | `8b14707f-6cc3-49fb-9a27-2cdd2b4a52f9` | 234567890‑ | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 6 | hamdani | ikram | `a09bf27d-c8f1-4670-aa24-e23eeca1fb49` | 0542546077 | 3 | 3 | 1 | 0 | 0 | 0 | 0 |

**Totaux concernés si suppression des 6 :**
- 7 rendez‑vous
- 7 traitements
- 3 paiements
- 0 dossiers médicaux / ordonnances / documents / odontogrammes

**Méthode de suppression (réversible)** : passage par la **corbeille
applicative** (`trash_entries`), avec 24 h de fenêtre de restauration, et
journal d'activité. Un script de purge pré‑existe (`desktop/…/purge-t1.mjs`
mentionné dans l'état précédent) — il sera réutilisé, avec cette liste d'IDs
exacte et **aucune autre**.

**Restauration** : en cas d'erreur, les enregistrements sont restaurés depuis
`trash_entries` (même séance), et en dernier recours depuis le backup
vérifié `backups/prod-verifiee-2026-11-01T20-23-25.dump`.

---

## 4. TESTS À PRÉPARER (avant écriture en prod)

### 4.1 Tests de synchronisation (nouveau dossier `tests/sync/`)

| Test | Scénario | Critère de réussite |
|---|---|---|
| `sync-patient-offline.test.ts` | Créer un patient hors ligne, puis sync | Patient visible sur le site web secrétaire, même UUID |
| `sync-appointment-web.test.ts` | Créer un RDV côté web, puis sync desktop | RDV visible sur le planning desktop |
| `sync-payment-conflict.test.ts` | Modifier le même paiement des deux côtés | **Aucune écriture silencieuse** : statut `A_ARBITRER`, deux versions conservées, alerte au médecin |
| `sync-payment-arbitrage-exclusion.test.ts` | Créer un paiement en conflit, puis lire les revenus du jour / rapports / reste à payer | Le paiement `A_ARBITRER` n'apparaît **ni** dans les revenus, **ni** dans les rapports, **ni** dans le calcul du reste à payer. Badge « en arbitrage » visible. |
| `sync-payment-arbitrage-resolution.test.ts` | Résoudre un conflit de paiement (choix d'une version) | Le statut repasse à `VALIDE`, les cumuls/rapports recalculés incluent la version retenue, l'arbitrage est journalisé (auteur, date, version écartée conservée). |
| `sync-appointment-double-reservation.test.ts` | Deux réservations simultanées du même créneau (desktop hors ligne + site en ligne) | Une seule réservation créée ; la seconde reçoit `CONFLIT_CRENEAU`, reste en file avec statut `CONFLIT_A_ARBITRER`, alerte sur les deux interfaces, aucune résolution automatique. |
| `sync-appointment-overlap-db.test.ts` | Tenter d'insérer directement deux RDV qui se chevauchent pour le même praticien | La contrainte `EXCLUDE` (btree_gist + `&&` sur `tstzrange`) rejette la seconde insertion (SQLSTATE `23P01`), y compris hors du chemin de sync. Vérifie aussi que `btree_gist` est présente sur Neon **et** sur la base locale embarquée. |
| `sync-appointment-overlap-preexisting.test.ts` | Pré‑insérer deux RDV chevauchants (via désactivation temporaire de la contrainte sur un cluster de test), puis lancer la migration | La migration détecte le chevauchement pré‑existant, **s'arrête sans rien modifier** et retourne la liste des paires en conflit. |
| `sync-appointment-null-status.test.ts` | Insérer deux RDV chevauchants dont l'un a un statut NULL | La contrainte rejette le second : un statut NULL est traité comme « non annulé » et participe à la contrainte. |
| `sync-appointment-cancelled-reuse.test.ts` | Annuler un RDV puis créer un nouveau RDV sur le même créneau | Le nouveau RDV est accepté : les RDV `ANNULE` sont exclus de la contrainte. |
| `sync-appointment-exclusion-violation.test.ts` | Pousser depuis la file un RDV en conflit avec un RDV créé en ligne sur le site secrétaire pendant la coupure | Le serveur répond avec SQLSTATE `23P01`, convertit en statut `CONFLIT_A_ARBITRER` sur CETTE opération uniquement, **et continue** à pousser les opérations suivantes de la file (patients, traitements…) sans blocage. L'opération en conflit reste dans la file, visible dans l'UI, non perdue. |
| `sync-patient-field-conflict.test.ts` | Modifier le même champ patient (ex. téléphone) des deux côtés hors ligne | Les **deux valeurs sont conservées** dans `sync_conflicts` ; bandeau de conflit affiché ; aucune écriture automatique ; l'arbitrage est journalisé avec l'auteur. |
| `sync-trash-expiry.test.ts` | Laisser expirer une entrée de corbeille (> 24 h) | L'entrée passe en `EXPIREE`, n'est plus restaurable depuis l'UI, mais **reste en base** ; aucune suppression physique automatique. |
| `sync-trash-purge-requires-confirmation.test.ts` | Lancer le script de purge définitive sans `--oui-je-confirme`, ou sans backup fraîche | Le script **refuse** de s'exécuter dans les deux cas. |
| `sync-device-revocation.test.ts` | Révoquer un `deviceId` puis tenter une sync depuis cet appareil | Réponse `403 DEVICE_REVOKED` ; le desktop bascule en hors‑ligne définitif ; les données non synchronisées restent exportables localement. |
| `sync-device-revocation-race.test.ts` | Révoquer l'appareil **exactement entre** l'authentification d'un push et son commit (verrou simulé sur `device_sessions`) | Aucune écriture partielle : l'opération est appliquée **entièrement** (si la lecture de révocation passe avant) ou **rejetée entièrement** (`403 DEVICE_REVOKED`). Jamais les deux moitiés. |
| `sync-export-decryption-after-reinstall.test.ts` | Générer un export chiffré sur un appareil, puis le déchiffrer sur un « nouveau poste » (nouveau `deviceId`, nouvelle installation) avec la phrase de récupération | Les opérations non synchronisées sont restaurées intégralement dans la file locale du nouveau poste ; aucune donnée lisible sans la phrase (test aussi sans la phrase → échec attendu). |
| `sync-idempotence.test.ts` | Rejouer la même file 2× | Aucun doublon créé (`sync_seen_operations`) |
| `sync-offline-then-online.test.ts` | Simuler une coupure réseau pendant 5 opérations | Toutes rejouées à la reconnexion, ordre préservé |
| `sync-delete-restore.test.ts` | Supprimer hors ligne, restaurer depuis corbeille | État cohérent des deux côtés |
| `sync-role-isolation.test.ts` | Session secrétaire tente `/api/finances/*` | **403/401**, jamais 200 |

### 4.2 Tests d'authentification (existant à réexécuter)

- `tests/business/config-production.test.ts`
- Tests de rôles (secrétaire ≠ médecin) — à étendre si nécessaire.
- `npm run lint` + `npm run test` + `npm run typecheck` + `npm run build`
  après chaque phase.

---

## 5. RISQUES & MITIGATIONS

| Risque | Mitigation |
|---|---|
| Perte d'une opération hors ligne (crash poste) | File persistée en base + snapshot chiffré avant push + journal sync |
| Doublons patients | UUID générés côté client + contrôle métier manuel (`nom + prenom + dateNaissance + telephone`) |
| Double réservation de créneau | Contrainte `EXCLUDE` PostgreSQL (btree_gist, `tstzrange &&`, NULL = non annulé) + vérification métier + arbitrage humain obligatoire. Diagnostic pré‑migration des chevauchements existants. Contrainte présente sur Neon **et** en local (§1.5bis). |
| Paiement/traitement écrasé en conflit | **Jamais auto‑résolu** : statut `A_ARBITRER` + deux versions conservées + alerte médecin. Les éléments `A_ARBITRER` sont exclus des soldes/rapports (§1.5quater). |
| Session/desktop compromise | `device_token` chiffré DPAPI, révocable côté serveur, HTTPS obligatoire. Course révocation/push protégée (SELECT FOR SHARE dans la transaction de push, §1.8bis). |
| Export chiffré irrécupérable (phrase perdue) | Assumé et annoncé explicitement à l'appairage (case à cocher). La clé est dérivée de la phrase (PBKDF2 600k), jamais stockée — §1.8ter. |
| Divergence financière non détectée | Journal de sync + réconciliation périodique (totaux paiements desktop vs Neon, alerte si écart) |
| Complexité de maintenance | Option B est **le chantier le plus lourd** de la liste : comptez plusieurs semaines, pas quelques jours |

---

## 6. PHASES DE DÉPLOIEMENT (après votre approbation explicite)

### Phase 0 — Aucune écriture, préparation locale
- Écriture des tests `tests/sync/*` et du squelette `desktop/sync/*`.
- Validation sur un cluster local 18 (port 5433), jamais sur Neon.
- Critère : tous les tests de sync passent en local, lint/typecheck/test/build verts.

### Phase 1 — Migration non destructive sur Neon
- `prisma migrate deploy` (tables de sync + finance_sessions déjà écrites).
- Critère : `prisma migrate status` à jour, aucune suppression de table.

### Phase 2 — Comptes
- Activation du rôle ASSISTANT (`authorization.ts`).
- Création de `clinic@gmail.dz` (ASSISTANT) et `sahed@gmail.dz` (MEDECIN)
  avec mots de passe aléatoires forts + sentinelles 1ʳᵉ connexion.
- Désactivation `demo@cabinet.dz` (`isActive=false`).
- Critère : login web secrétaire ✔, login médecin ✔, **refus finances pour la
  secrétaire** (401/403), changement forcé de mot de passe au 1ᵉʳ login.

### Phase 3 — Purge des 6 patients de test
- Passage par la corbeille applicative, liste d'IDs exacte ci‑dessus.
- Vérification après coup : 40 patients restants, totaux financiers
  cohérents, journal d'activité à jour.
- Critère : aucun patient légitime touché, restauration possible 24 h.

### Phase 4 — Synchronisation desktop
- Déploiement de la couche `desktop/sync/*` + serveur `/api/sync/*`.
- Appairage `device_token` chiffré via `safeStorage`.
- Critère : les 7 tests de sync passent sur un cluster de test **et** sur un
  desktop réel ; Internet requis pour la sync, jamais pour l'usage hors
  ligne.

### Phase 5 — Recette complète
- Tests croisés des 3 applications (créer un patient desktop → visible web,
  créer un RDV web → visible desktop, modifier un paiement → conflit
  `A_ARBITRER` visible par le médecin, double réservation → `CONFLIT_CRENEAU`,
  révocation pendant un push → aucune écriture partielle).
- Isolation des rôles revérifiée côté API.
- `npm run lint` + `npm run test` + `npm run typecheck` + `npm run build`.
- Rapport final chiffré.

---

## 7. ESTIMATION DE CHARGE (honnête)

| Phase | Charge |
|---|---|
| Phase 0 (tests + squelette sync, local) | ~6‑7 jours (les nouveaux tests §4 ajoutent ~2 j de plus qu'en v3) |
| Phase 1 (migration non destructive) | ~0,5 jour |
| Phase 2 (comptes + rôles + tests) | ~0,5 jour |
| Phase 3 (purge 6 patients, corbeille) | ~0,5 jour |
| Phase 4 (desktop sync réelle + appairage) | ~6‑8 jours |
| Phase 5 (recette + tests croisés + build) | ~2‑3 jours |
| **Total Option B offline‑first** | **≈ 17‑19 jours ouvrés** |

L'Option B est **explicitement plus coûteuse** que l'Option A (~1‑2 jours) —
c'est le prix du hors‑ligne. Elle reste la seule compatible avec votre
exigence « Windows utilisable sans Internet ».

---

## 8. CE QUE J'ATTENDS DE VOUS AVANT TOUTE ÉCRITURE

1. **Approbation du plan technique** (sections 1 à 6 ci‑dessus).
2. **Approbation de l'inventaire des 6 patients** (section 3, IDs exacts).
3. **Approbation de la désactivation** de `demo@cabinet.dz` (section 2.4).
4. **Choix du canal sécurisé** pour la transmission des 2 mots de passe
   temporaires forts (jamais par chat ni par Git).
5. **Confirmation** que la Phase 4 (appairage desktop) peut être réalisée sur
   le poste réel du cabinet.

Tant que ces 5 points ne sont pas confirmés, **je n'écris rien en
production** — aucune migration, aucun compte, aucune désactivation, aucune
suppression.
