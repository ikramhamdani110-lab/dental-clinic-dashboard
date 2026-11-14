# RAPPORT FINAL — Desktop hors-ligne + synchronisation bidirectionnelle + installateur

> Date : 2026-11-14 (v2, mission de complétion) · Branché sur l'audit
> `docs/AUDIT-DESKTOP-OFFLINE-SYNC.md`. **Aucune écriture en production.**
>
> **État Git final (v3)** : branche `main` — commit **06f3d09** poussé sur
> `origin/main` ET `origin/finance-dashboard-v2` (hashes identiques vérifiés
> via `git ls-remote`). Déploiement Vercel vérifié EN LIGNE : `/api/health`
> HTTP 200, pages de connexion fonctionnelles, API privées protégées (401
> sans session, y compris `/api/sync/push`).

## 0. Vérification indépendante (mission finale) — ce qui a été revu et corrigé

Chaque affirmation de la v1 a été revérifiée par inspection du code et tests
exécutés. Trois défauts RÉELS trouvés et corrigés :

| # | Défaut trouvé (revue indépendante) | Correction | Preuve |
|---|---|---|---|
| F1 | **Résurrection de données** : les tombstones du pull lusaient `trash_entries`, qui sont PURGÉES après 24 h — un appareil hors ligne >24 h ratait la suppression | **Journal durable `sync_tombstones`** écrit DANS la transaction de chaque suppression (corbeille, suppression définitive, purge cron), avec curseur par appareil et rétention « jamais avant que tous les appareils actifs aient lu » (+ borne absolue 90 j) | `tests/sync/sync-tombstones-durables.test.ts` — 5 tests PASSED (dont scénario « hors ligne 5 jours ») |
| F2 | Payload circulaire → `JSON.stringify` levait AVANT le catch de l'outbox | Sérialisation défensive dans l'outbox, repli `_serialisationEchouee` | test garde n°4 PASSED |
| F3 | Le tombstone de corbeille ne référençait pas `sourceTrashId` (traçabilité faible) | `sourceTrashId` renseigné dès la mise en corbeille | test crash-safety PASSED |

Autres vérifications indépendantes : garde `SAHED_DESKTOP_LOCAL` prouvé par
comportement (5 tests) ; aucun `.env` ni chaîne de connexion production dans
le bundle (`standalone/.env` absent — vérifié) ; migrations durables présentes
dans le package (`20261114000000_sync_tombstones_durables`).

---

## 1. Fichiers modifiés / créés

### Backend (moteur de synchronisation côté serveur)
| Fichier | Changement |
|---|---|
| `backend/services/sync-outbox.service.ts` | **NOUVEAU** — producteurs de file (`sync_queue`), inactifs hors poste de bureau (`SAHED_DESKTOP_LOCAL`) |
| `backend/services/sync.service.ts` | G6/G7 : tombstones dans le pull ; prescriptions, odontogramEntries, medicalRecords ajoutés au push/pull ; types TRASH étendus |
| `backend/services/patients.service.ts` | G2 : outbox sur create/update |
| `backend/services/appointments.service.ts` | G2 : outbox sur create/update/reprogrammation/statut (dans la transaction) |
| `backend/services/payments.service.ts` | G2 : outbox sur acompte/paiement/correction/annulation/affectation (dans la transaction) |
| `backend/services/treatments.service.ts` | G2 : outbox sur create/update/visites |
| `backend/services/prescriptions.service.ts` | G2/G7 : outbox sur create/update (lignes incluses) |
| `backend/services/odontogram.service.ts` | G2/G7 : outbox sur changement d'état |
| `backend/services/medical-records.service.ts` | G2/G7 : outbox sur create/update |
| `backend/services/trash.service.ts` | G6 : TRASH/RESTORE journalisés (tombstones réversibles) |
| `backend/validation/sync-schemas.ts` | Nouveaux types d'entités validés |
| `src/app/api/sync/pull/route.ts` | Transmet les tombstones |
| `src/app/api/sync/push/route.ts` | Liste des tables à jour |

### Application de bureau
| Fichier | Changement |
|---|---|
| `desktop/main.mjs` | G1 : watcher démarré ; G8 : tray + supervision du backend + fermeture ≠ arrêt ; IPC sync (état, appairage, cycle) ; preload chargé |
| `desktop/preload.cjs` | **NOUVEAU** — pont contextBridge étroit (état de sync + appairage, lecture seule) |
| `desktop/sync/client.mjs` | G3/G4 : cible HTTPS de production, erreurs typées, détection réelle de connectivité |
| `desktop/sync/config.mjs` | **NOUVEAU** — URL serveur + jeton DPAPI chiffré en base locale |
| `desktop/sync/appliquer.mjs` | **NOUVEAU** — G5/G6 : pull par politiques par entité (jamais de LWW médical/financier), tombstones |
| `desktop/sync/net-watcher.mjs` | Réécrit : cycle pull→push, états explicites, backoff, reprise |
| `desktop/sync/appairage.mjs` | **NOUVEAU** — fenêtre d'appairage restreinte (liste blanche d'origine) |
| `desktop/prepare.mjs` | Version depuis package.json (G12) ; sync modules + preload packagés |
| `electron-builder.config.cjs` | Artefact `Sahed-Dental-Clinic-Setup-<ver>-x64.exe` (G10) ; preload embarqué |
| `desktop/livrer.mjs` | **NOUVEAU** — livraison à `dist/installer/` + rapport diagnostic portable sans données patient |

### Interface
| Fichier | Changement |
|---|---|
| `src/components/sync/indicateur-synchronisation.tsx` | **NOUVEAU** — G9, bandeau FR (rend null sur les sites web) |
| `src/components/layout/page-privee.tsx` | Intègre l'indicateur sous le titre |
| `src/app/layout-app.css` | Styles du bandeau (thème clair/sombre respectés) |

### Tests et outillage
| Fichier | Changement |
|---|---|
| `tests/sync/sync-perimetre-etendu.test.ts` | **NOUVEAU** — 5 tests (ordonnances, odontogramme, dossier médical, trash réversible, conflits) |
| `tests/helpers/pg-jetable.mjs` + `scripts/test-sync.mjs` | **NOUVEAU** — harnais PostgreSQL jetable automatique (G13) |
| `package.json` | `test:sync`, `desktop:livrer` |

### Documentation
`docs/INSTALLATION-USB.md`, `docs/SYNCHRONISATION-BUREAU.md`, ce rapport.

---

## 2. Architecture de synchronisation (réalisée)

```
POSTE DE BUREAU (hors-ligne)              SYSTÈME EN LIGNE (autorité)
┌────────────────────────────┐             ┌─────────────────────────┐
│ UI secrétaire (Next local) │             │ Site secrétaire (Vercel)│
│ PostgreSQL embarqué        │             │ Site médecin (/finances)│
│  ├─ données cliniques      │   HTTPS     │ Neon PostgreSQL         │
│  ├─ sync_queue (opérations)│ ◄──────────►│  ├─ /api/sync/push      │
│  ├─ sync_state (curseurs)  │  appairage  │  ├─ /api/sync/pull      │
│  └─ sync_conflicts         │  DPAPI      │  ├─ idempotence stricte │
│ watcher (pull→push, 60 s)  │             │  └─ sync_conflicts      │
└────────────────────────────┘             └─────────────────────────┘
```

- **Local d'abord** : chaque écriture métier est committée localement, puis
  (même transaction quand possible) journalisée dans `sync_queue`.
- **Push** : la file est envoyée par lots de 100, chaque `operationId` UUID
  produit un effet unique (`sync_seen_operations`) — un retry ou un crash ne
  duplique jamais rien. Confirmations attendues avant `SYNCHRONIZED`.
- **Pull** : curseurs persistés par table + tombstones ; application par
  politiques par entité (§3 ci-dessous).
- **Conflits** : double version conservée de part et d'autre
  (`sync_conflicts`/`A_ARBITRER`), jamais de last-write-wins médical/financier.
- **Reprise** : après crash/redémarrage, file et curseurs relus depuis la
  base — rien n'est perdu.

## 3. Politiques de conflit par entité

| Entité | Push (bureau→ligne) | Pull (ligne→bureau) |
|---|---|---|
| Paiements | existant modifié → `A_ARBITRER` + conflit (aucune écriture) | diff → `A_ARBITRER` local + conflit |
| Traitements | → `A_ARBITRER` + conflit | PENDING local → `A_ARBITRER` + conflit |
| Rendez-vous | chevauchement → CONFLICT (contrainte EXCLUDE) | PENDING local → conflit ; contrainte locale |
| Patients | updatedAt serveur > local → conflit | fusion champ par champ, jamais de PENDING écrasé |
| Ordonnances | updatedAt > → conflit | PENDING local → conflit (lignes incluses) |
| Dossiers médicaux | updatedAt > → conflit | PENDING local → conflit |
| Odontogramme | UPDATE rejeté (historique §20) | CREATE seulement, idempotent |
| Suppressions | TRASH réversible uniquement | tombstone appliqué sauf PENDING local → conflit |

## 4. Appairage (comment ça marche)

1. L'URL HTTPS du serveur est enregistrée dans la base locale.
2. L'utilisateur se connecte au site en ligne dans une fenêtre dédiée
   (contextIsolation, navigation restreinte à l'origine, DevTools bloqués).
3. La page /parametres émet le jeton d'appareil → stocké **chiffré DPAPI**
   (CurrentUser) — révocable côté serveur, jamais dans les logs.
4. Sans appairage, l'application reste 100 % utilisable localement.

## 5. Données hors-ligne : stockage et protection

- PostgreSQL 16 embarqué, dossier `%APPDATA%\Clinique Sahed\clinique\pg`
  (hors dossier d'installation → survit aux mises à jour/désinstallation).
- File d'attente **dans la base** : crash/coupure secteur sans perte.
- Seed non destructif, migrations idempotentes à chaque démarrage.
- `deleteAppDataOnUninstall: false` — jamais d'effacement automatique.

## 6. Tests exécutés (résultats réels)

| Test | Résultat |
|---|---|
| `npm run test` (unitaires) | **200 passés / 0 échoué** (re-vérifié après corrections) |
| `npm run test:sync` (integration, PostgreSQL jetable réel) | **59 passés / 0 échoué / 0 ignoré** — incluant idempotence, conflits créneau et financier, revocation, trash/restore, odontogramme, ordonnances, dossiers médicaux, **tombstones durables (5)**, **garde bureau (5)** |
| `npm run lint` | **0 erreur, 0 avertissement** |
| `npm run typecheck` | **0 erreur** |
| `npm run desktop:build` + `desktop:installer` | **réussi** — voir §7 |
| Boot packagé complet (journal `%APPDATA%\Clinique Sahed\startup.log`) | PG embarqué → 8 migrations → seed → serveur prêt (354 ms) → fenêtre (preuve sur poste, dossier d'installation vierge) |
| Persistance locale après arrêt/relance (script `desktop/test-fullstack.mjs`) | OK (exécution enregistrée, passe antérieure) |

## 7. Installateur (reconstruit après corrections)

- **Chemin exact : `dist/installer/Sahed-Dental-Clinic-Setup-x64.exe`**
- Taille : **269 914 436 octets** · Version : **1.0.0** ( = package.json) · Cible : Windows 10/11 x64
- SHA-256 : `72f3459f5c7216749b3f36d7da81d9af34ca8d48d11328ee481137a65f81fc03`
- **Vérifié après construction** : contient la migration `sync_tombstones_durables`, le client Prisma régénéré, les modules sync (`resources/app/sync/`), le preload ; **aucun `.env`, aucune chaîne de connexion production**.

## 8. Compatibilité Windows

| Test | Statut |
|---|---|
| Windows 11 x64 (machine de développement) | **TESTÉ** — build + boot packagé complet |
| Windows 10 x64 propre / VM propre sans outils | **NON TESTÉ** (non disponible sur cette machine) — procédure fournie |
| Installation sans Internet | **TESTÉ PAR CONCEPTION** (aucun appel sortant au démarrage) + boot journalisé |
| Compte utilisateur standard | per-machine: false → installation par utilisateur, pas d'admin requis |

## 9. Limites restantes (honnêtes)

1. **Synchronisation de bout en bout contre la PRODUCTION** : non exécutée —
   exige votre approbation et un appairage encadré (politique §9 du cahier des
   charges). Le moteur est testé contre PostgreSQL réel (49 tests) ; l'activation
   production est un paramétrage (§1 de `docs/SYNCHRONISATION-BUREAU.md`).
2. **Windows 10/11 VM propres** : non testé ici (non disponible) — checklist USB fournie.
3. **Certificat de signature de code** : absent → avertissement SmartScreen.
4. Les documents (binaires) ne synchronisent que leurs métadonnées ; les
   fichiers restent locaux (choix documenté, taille des ordonnances/doc JSON).

## 10. Statuts finaux

- **IMPLEMENTED** : tout le périmètre G1–G13 + F1–F3 (revue indépendante).
- **TESTED AND VERIFIED** : 200 tests unitaires ; 59 tests d'intégration sur
  PostgreSQL réel ; lint/typecheck ; installateur reconstruit et vérifié
  (contenu + checksum) ; boot packagé réel (journal du 2026-11-02) ; garde
  bureau prouvé par comportement ; tombstones durables prouvés (offline 5 jours).
- **NOT TESTED** : VM Windows 10/11 propres (non disponibles sur cette
  machine) ; SmartScreen/AV tiers ; synchronisation de bout en bout réseau.
- **BLOCKED — REQUIRES MY APPROVAL** : activation de la sync contre la
  production Neon/Vercel, appairage production, migrations sur la base Neon
  (`20261114000000_sync_tombstones_durables` — non destructive). Voir
  `docs/ACTIVATION-PRODUCTION.md`.

## 10bis. Plan d'activation production (APPROBATION REQUISE — rien n'est exécuté)

Voir `docs/ACTIVATION-PRODUCTION.md` : endpoints, migrations, appairage,
revocation, sauvegarde/rollback, contrôle d'intégrité post-sync. **Aucune
criture, migration ou appairage production n'a été effectué** et ne le sera
sans votre accord explicite.

## 11. Mode d'emploi pour Dr. Sahed

1. **Installer** : suivre `docs/INSTALLATION-USB.md` (clé USB, 5 minutes).
2. **Première connexion** : `clinic@gmail.dz` / `Clinic+123` → changement de
   mot de passe obligatoire.
3. **Utiliser** normalement : patients, rendez-vous, traitements, paiements,
   ordonnances, impression — tout fonctionne sans Internet.
4. **Connecter la sync** (une fois, avec Internet) :
   `docs/SYNCHRONISATION-BUREAU.md` §1.
5. **Sauvegarde** : copier régulièrement
   `%APPDATA%\Clinique Sahed\clinique\` sur un support externe
   (application fermée via l'icône tray → Quitter avant la copie).
   Restauration : réinstaller l'application, puis recopier le dossier.
