# ARCHITECTURE, SYNCHRONISATION & MISES À JOUR — Évaluation et plan d'implémentation

> Date : 2026-11-01 · Branche : `repo-cleanup-publication`
> Ce document est l'évaluation d'architecture exigée avant toute implémentation
> (§2 de la demande). Il décrit l'état RÉEL vérifié dans le code, puis l'état
> cible et les phases d'implémentation.

---

## PARTIE A — ÉTAT RÉEL (vérifié, pas supposé)

### A.1 Les trois surfaces

| Surface | Base de données | Internet requis ? |
|---|---|---|
| Desktop secrétaire (Electron 45, Windows) | **PostgreSQL embarqué local** (`%APPDATA%\Clinique Sahed\clinique\pg`, port 54329) | **NON** |
| Web secrétaire (Vercel `dental-clinic-dashboard-snowy.vercel.app`) | Neon PostgreSQL (cloud) | OUI (par nature) |
| Site financier médecin (`/finances`, même déploiement) | Neon PostgreSQL (cloud), session dédiée | OUI (par nature) |

### A.2 Conclusion majeure : **le desktop est DÉJÀ 100 % hors ligne**

C'est le point central que la demande demandait d'établir sans présumer. Vérifié
dans `desktop/main.mjs` (484 lignes) :

1. **Aucun appel réseau sortant.** Le processus principal ne contacte que
   `127.0.0.1` : PostgreSQL embarqué (port 54329) et le serveur Next standalone
   (port 43177). `main.mjs` ne contient aucun `fetch`, `https.request` ni URL
   distante (vérifié par inspection complète du fichier).
2. **La base locale EST la base de travail.** Toutes les écritures (patients,
   rendez-vous, traitements, paiements, documents) passent par
   `postgresql://sahed:…@127.0.0.1:54329/sahed_clinic`. Sans internet,
   tout fonctionne : démarrage, migration locale, seed, API, interface.
3. **Authentification hors ligne DÉJÀ fonctionnelle.** Les comptes (médecin,
   secrétaire) vivent dans la base locale, hachés Argon2id + pepper local
   (`APP_PASSWORD_PEPPER`). La connexion vérifie le mot de passe **localement** :
   aucun serveur distant n'est sollicité. Un compte créé sur le poste fonctionne
   même après des mois sans internet.
4. **Persistance vérifiée.** Preuves :
   - `desktop/test-fullstack.mjs` : création patient/RDV/paiement → arrêt PG →
     redémarrage PG → relecture OK (`Persistance: OK`).
   - `deleteAppDataOnUninstall: false` (electron-builder) : la base survit à la
     désinstallation/réinstallation.
   - Les données sont hors du dossier d'installation (`DATA_DIR = userData/clinique`).

**Donc : l'exigence « Dr. Sahed doit pouvoir gérer son cabinet sans internet »
est déjà satisfaite par l'architecture actuelle.** Aucun mode dégradé n'existe
parce qu'il n'y a pas de mode distant à dégrader.

### A.3 Ce qui N'existe PAS encore (lacunes réelles)

1. **Aucune synchronisation** desktop ↔ web. Les deux bases (locale embarquée,
   Neon) sont **indépendantes** : ce qui est saisi au bureau n'apparaît pas sur
   le web, et réciproquement. C'est la vraie lacune — pas le hors-ligne.
2. **Aucun mécanisme de mise à jour automatique.** `publish: null` dans
   `electron-builder.config.cjs`, pas de `electron-updater` dans les
   dépendances. Les mises à jour se font aujourd'hui par installateur manuel.
3. Pas d'indicateur de statut de synchronisation (aucun à afficher tant que la
   synchronisation n'existe pas).

### A.4 Conséquence pour la base « centrale »

La demande décrit un schéma « local + central + file d'attente ». Or le web
secrétaire utilise déjà Neon comme SA base de travail. Si le desktop se met à
synchroniser vers Neon, la base locale et la base Neon doivent porter le même
schéma et des règles de résolution — sinon il y aura divergence. C'est
l'implémentation la plus risquée du projet (données médicales + financières) et
elle modifie potentiellement le schéma de production (métadonnées de
synchronisation). Elle est donc **planifiée mais non exécutée** dans cette passe
(cf. A.5 et Partie C).

### A.5 Ce que cette passe NE fait PAS volontairement

- Aucune modification du schéma de production (la demande elle-même l'exige
  sans approbation explicite).
- Aucune écriture dans la base Neon de production.
- Aucune « synchronisation » simulée ni déclarée sans exécution.
- Aucune publication de release desktop (le canal GitHub Releases utilisé pour
  la *publication d'installateur* a été supprimé sur instruction ; le canal de
  mise à jour auto sera un sujet d'approbation distinct).

---

## PARTIE B — ARCHITECTURE CIBLE (design pour approbation)

### B.1 Principe : « local-first, sync en arrière-plan »

Le desktop garde sa base PostgreSQL embarquée comme source de travail. Neon
reste la base du web. La synchronisation réconcilie les deux **par opérations**,
jamais par réplication aveugle.

```
┌────────────────────────────┐            ┌──────────────────────────┐
│ Desktop (poste secrétaire) │            │ Cloud (Neon)             │
│                            │   HTTPS    │                          │
│ PostgreSQL 54329 (travail) │◀── sync ──▶│ API /api/sync/*          │
│  + table sync_queue        │  (batch,   │  + tables de métadonnées │
│  + curseur par table       │   idem.)   │  + journal des acks      │
│  + jeton d'appareil        │            │                          │
└────────────────────────────┘            └──────────────────────────┘
```

### B.2 Composants à créer (phase 2, après approbation)

1. **`sync_queue` (desktop, table locale)** : une ligne par opération
   (`id uuid`, `entite`, `operation` (INSERT/UPDATE/DELETE), `recordId`,
   `horodatage`, `charge` (payload JSON), `etat` (EN_ATTENTE/ENVOYE/CONFIRME/
   ECHOUE), `tentatives`, `erreur`). Durable : la file survit au crash.
2. **Métadonnées de version** : colonnes `updatedAt` existent déjà sur toutes
   les tables concernées ; ajout éventuel de `synchroHorodatage`/`source`
   sur les tables cliniques (migration **desktop + Neon**, requiert approbation).
3. **API `/api/sync/push` (Neon)** : reçoit un lot d'opérations signées par le
   jeton d'appareil, rejoue la validation métier existante (zod + services),
   répond opération par opération (CONFIRME / CONFLIT / REJET). Idempotence :
   un `operationId` déjà appliqué renvoie le même ack sans ré-exécution.
4. **API `/api/sync/pull` (Neon)** : renvoie les changements depuis un curseur
   (`updatedAt` max + log d'opérations serveur), par lot paginé.
5. **Moteur de sync desktop** (`desktop/sync.mjs`, lancé par le processus main,
   séparé du serveur Next local) : connectivité → push batch → pull →
   résolution → maj du statut. Backoff exponentiel (1 s → 60 s), reprise après
   interruption (la file EST l'état).
6. **Statut UI** : bandeau discret dans l'app (indicateurs français du §6.1 de
   la demande), alimenté par le moteur via IPC.

### B.3 Paiements — règle absolue

Un paiement créé hors ligne est stocké localement avec
`etatSynchro = EN_ATTENTE`. Il n'apparaît comme « reçu » définitif côté médecin
**que** si l'ack serveur CONFIRME a été reçu. La clé `idempotencyKey` (déjà
`@unique` en base) empêche tout doublon lors des rejeux. Les paiements ne sont
JAMAIS fusionnés automatiquement côté client.

### B.4 Conflits

- **Contact patient / rendez-vous** : comparaison `updatedAt` + version ; en cas
  de modification simultanée des deux côtés, l'opération en CONFLIT est
  signalée à l'utilisateur (écran de choix), jamais écrasée en silence.
- **Notes cliniques / informations médicales** : conservation des deux versions
  et revue humaine (pas de fusion automatique).
- **Paiements** : jamais de fusion ; le serveur arbitre et la validation
  existante (montants, solde, idempotence) s'applique à chaque rejeu.

### B.5 Mises à jour automatiques (phase 3, indépendante de la sync)

- Ajout de `electron-updater` (compatible NSIS x64 existant).
- Canal : **GitHub Releases** (déjà l'infrastructure du dépôt) ou serveur
  générique HTTPS — choix soumis à approbation, **sans recréer** le site
  d'installation supprimé.
- Comportement : détection au démarrage + toutes les 4 h, téléchargement en
  arrière-plan, vérification SHA-512 intégrée à electron-updater, jamais
  d'installation pendant un écran de saisie (propose « Installer plus tard »,
  applique à la fermeture), la base locale n'est jamais touchée
  (`deleteAppDataOnUninstall: false` + updater ne touche qu'à `resources/`).
- Hors ligne : aucun blocage, la version installée reste utilisable, les
  vérifications reprennent au retour du réseau.
- Sécurité : signature de code recommandée (certificat) pour supprimer le
  SmartScreen ; à défaut, avertissement documenté et hash publié à part.

---

## PARTIE C — PLAN D'IMPLÉMENTATION PHASÉ

| Phase | Contenu | Prérequis |
|---|---|---|
| 1 (FAIT) | Évaluation d'architecture, preuves hors-ligne, documentation | — |
| 2 | File `sync_queue`, APIs `/api/sync/*`, moteur desktop, statut UI, résolution de conflits | **Approbation de la migration de schéma** (métadonnées de sync) + environnement de démo isolé |
| 3 | `electron-updater`, canal de release, CI/CD (build installer sur tag, publication artefacts + SHA-512) | Choix/approbation du canal de release + certificat de signature (option) |
| 4 | Tests lifecycle complets (§13 de la demande) sur démo isolé + VM Windows 10 | VM Windows 10 disponible |
| 5 | Déploiement production + publication release desktop | Approbation finale |

**Règle d'or reprise de la demande :** rien de ce qui n'a pas été exécuté et
vérifié ne sera déclaré fait dans le rapport final.
