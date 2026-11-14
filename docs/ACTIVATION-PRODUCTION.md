# PLAN D'ACTIVATION PRODUCTION — SYNCHRONISATION BUREAU

> ⚠️ **STATUT : EN ATTENTE DE VOTRE APPROBATION EXPLICITE.**
> Rien dans ce document n'a été exécuté. Aucune écriture, migration, appairage
> ou synchronisation de production n'a eu lieu. L'approbation de pousser le
> code ne vaut PAS approbation de modifier la base de production.

---

## 1. Pré-requis (à valider AVANT toute opération)

1. **Sauvegarde Neon complète** (dump `pg_dump` du schéma + données) datée du
   jour, testée en restauration sur une base de contrôle. Sans ça : STOP.
2. Fenêtre de maintenance choisie (hors heures de consultation).
3. Accès Neon avec rôle disposant de `CREATE TABLE` (la migration est non
   destructive : uniquement des CREATE TABLE + INDEX).

## 2. Endpoints de production

| Élément | Valeur |
|---|---|
| API sync push | `https://dental-clinic-dashboard-snowy.vercel.app/api/sync/push` |
| API sync pull | `…/api/sync/pull` |
| Appairage | `…/api/sync/appareils` (POST, session web requise) |
| Santé | `…/api/health` |

## 3. Migration base de données (NON destructive)

Une seule migration à appliquer : **`20261114000000_sync_tombstones_durables`**
— trois `CREATE TABLE` (`sync_tombstones`, `sync_tombstone_cursors`,
`sync_tombstone_retention`) + index. Aucun ALTER de table existante, aucun
DROP, aucune écriture de données cliniques.

```bash
# Après sauvegarde validée, avec approval explicite :
npx prisma migrate deploy --schema database/prisma/schema.prisma
# (DATABASE_URL = Neon production)
```

**Rollback** : `DROP TABLE sync_tombstones, sync_tombstone_cursors,
sync_tombstone_retention;` — aucune donnée clinique concernée.

## 4. Appairage du poste (procédure)

1. Sur le site en ligne : se connecter avec le compte du cabinet.
2. Sur le poste (après installation USB) : suivre
   `docs/SYNCHRONISATION-BUREAU.md` §1 — connexion dans la fenêtre d'appairage,
   confirmation depuis /parametres.
3. Noter la phrase de récupération (affichée une seule fois) hors du poste.

**Revocation** : /parametres → révoquer l'appareil (immédiat, atomique côté
serveur ; le poste bascule en hors-ligne définitif pour la sync).

## 5. Synchronisation initiale — comportement

- **Premier pull du poste** : curseurs à epoch → l'appareil reçoit TOUTES les
  données cliniques existantes (patients, RDV, traitements, paiements,
  ordonnances, odontogramme, dossiers) + TOUT l'historique durable des
  suppressions (`sync_tombstones` depuis epoch).
- **Premier push** : uniquement les opérations créées hors ligne AVANT
  l'appairage (file `sync_queue` locale). Idempotence serveur garantie.
- **Aucune suppression de production n'est déclenchée par le premier appairage.**

## 6. Contrôles d'intégrité après activation

| Contrôle | Attendu |
|---|---|
| Nombre de patients en ligne | ≥ nombre avant activation (jamais inférieur) |
| Total paiements VALIDE | Identique avant/après (les `A_ARBITRER` sont exclus) |
| `sync_events` | Journal de chaque push/pull, sans payload sensible |
| Conflits | `sync_conflicts` en `PENDING` uniquement si double modification réelle |

## 7. Impact production attendu

- Vercel : 3 routes API de sync (déjà dans le code, inactives sans appareil apparié).
- Neon : 3 nouvelles tables (+ index), volume faible (quelques Ko/jour).
- Aucune modification des interfaces médecin/secrétaire (l'indicateur de sync
  ne s'affiche QUE dans l'application de bureau).

## 8. Ordre d'exécution approuvé (checklist opératoire)

1. ☐ Sauvegarde Neon validée
2. ☐ Approbation explicite reçue
3. ☐ `prisma migrate deploy` sur Neon
4. ☐ Vérifier `/api/health` en production
5. ☐ Appairage du poste (fenêtre avec Internet)
6. ☐ Premier pull → vérifier compte patients/traitements côté bureau
7. ☐ Test bidirectionnel : créer 1 patient test côté bureau → vérifier en ligne
8. ☐ Test inverse : créer 1 patient test en ligne → vérifier au bureau
9. ☐ Contrôles §6
