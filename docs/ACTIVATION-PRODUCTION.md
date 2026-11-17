# PLAN D'ACTIVATION PRODUCTION — SYNCHRONISATION BUREAU

> ⚠️ **STATUT : EN ATTENTE DE VOTRE APPROBATION EXPLICITE.**
> Rien dans ce document n'a été exécuté. Aucune écriture de production n'a eu lieu.

## 0. Procédure finale — NEON (document opératoire unique)

**La procédure complète, vérifiée et reproductible pour appliquer la migration
`20261114000000_sync_tombstones_durables` sur Neon se trouve dans
[`docs/NEON-FINAL-ACTIVATION.md`](./NEON-FINAL-ACTIVATION.md).**

Résumé de ce qui a été vérifié de bout en bout sur base PostgreSQL jetable
(Prisma **6.1.0** réel, jamais la production) :

| Vérification | Résultat |
|---|---|
| SHA-256 du fichier de migration = checksum écrit par Prisma 6.1.0 | `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385` |
| Réconciliation complète (9 migrations + INSERT historique + `migrate deploy`) | no-op, aucune migration rejouée, 10 lignes d'historique |
| Les 14 blocs SQL du document, exécutés dans l'ordre | tous exécutables, résultats conformes |
| Données cliniques sentinelles avant/après | intactes |
| Instruction destructive dans le document | aucune |

Reproduire ces vérifications à tout moment :

```bash
node scripts/verifier-checksum-prisma.mjs
node scripts/verifier-reconciliation-neon.mjs
node scripts/verifier-sql-documentation.mjs
```

---ure, migration, appairage
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

> **PROCÉDURE OFFICIELLE : `docs/NEON-FINAL-ACTIVATION.md`.**
> La chaîne de connexion de production n'est pas disponible dans
> l'environnement de développement : `prisma migrate deploy` **ne peut pas**
> être lancé depuis ici. La migration est donc appliquée via l'éditeur SQL de
> Neon (DDL identique) puis réconciliée dans `_prisma_migrations` avec le
> checksum mesuré par Prisma 6.1.0 :
> `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385`.
> Cette réconciliation a été reproduite sur base jetable (historique complet
> de 10 migrations) — voir le récapitulatif en tête de ce document cible.

```bash
# Variante SI la chaîne de production est disponible dans l'environnement :
npx prisma migrate deploy --schema database/prisma/schema.prisma
```

**Rollback** : privilégier la **restauration de la branche de sauvegarde
Neon** (réversible, sans commande destructive). La suppression manuelle des
trois tables n'est acceptable que si aucune donnée de synchronisation
n'existe encore (aucun appareil appairé, compteurs à zéro vérifiés).

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

1. ☐ Sauvegarde Neon validée (`docs/NEON-FINAL-ACTIVATION.md` étape 0)
2. ☐ Approbation explicite reçue
3. ☐ Migration appliquée via l'éditeur SQL + réconciliation Prisma
   (`docs/NEON-FINAL-ACTIVATION.md` étapes 1 à 3)
4. ☐ Vérifier `/api/health` en production
5. ☐ Appairage du poste (fenêtre avec Internet)
6. ☐ Premier pull → vérifier compte patients/traitements côté bureau
7. ☐ Test bidirectionnel : créer 1 patient test côté bureau → vérifier en ligne
8. ☐ Test inverse : créer 1 patient test en ligne → vérifier au bureau
9. ☐ Contrôles §6


## 9. Après la migration — protocole de tests réels (post-confirmation)

Une fois les résultats des étapes 3.1–3.6 de `docs/NEON-FINAL-ACTIVATION.md`
reçus et conformes, l'activation suit cet ordre — avec des enregistrements de
test **clairement identifiés** (préfixe `TEST-SYNC-…`), jamais de données
réelles :

| # | Test | Méthode | Preuve attendue |
|---|---|---|---|
| 1 | Appairage du poste | fenêtre d'appairage bureau → connexion production → confirmation /parametres | ligne `devices` active, jeton reçu, phrase de récupération notée |
| 2 | Bureau → ligne | patient + RDV `TEST-SYNC-…` créés **hors ligne**, puis reconnexion | records visibles sur le site (et dans Neon) |
| 3 | Ligne → bureau | enregistrement `TEST-SYNC-WEB-…` créé/modifié sur le site | modification présente au prochain pull bureau |
| 4 | Édition croisée hors ligne | 2 enregistrements test distincts, 1 modifié au bureau hors ligne, 1 modifié sur le site, reconnexion | les deux modifications convergent |
| 5 | Suppressions | suppression d'un test au bureau, d'un autre sur le site, répétition de sync | suppressions propagées, **aucune résurrection** (tombstones durables) |
| 6 | Conflits | même enregistrement modifié des deux côtés | statut `A_ARBITRER`, aucune donnée médicale/financière écrasée, aucun doublon |
| 7 | Redémarrage | fermer la fenêtre bureau (tray actif), rouvrir | backend toujours vivant, données locales intactes, sync reprend |
| 8 | Nettoyage | suppression des enregistrements `TEST-SYNC-…` via l'application | production sans résidu de test |

Résultats attendus enregistrés dans le rapport final de livraison. Toute
divergence = STOP et diagnostic avant toute nouvelle écriture.
