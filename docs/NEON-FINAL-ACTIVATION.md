# ACTIVATION NEON — PROCÉDURE FINALE VÉRIFIÉE

> **Objet** : appliquer la migration `20261114000000_sync_tombstones_durables`
> sur la base Neon de production, sans aucune perte de données cliniques.
>
> **Ce que vous exécutez** : des blocs `sql` copiés tels quels dans l'éditeur
> SQL Neon.
>
> **Ce qui a été vérifié ici, avant rédaction de ce document** :
>
> | Vérification | Méthode | Résultat |
> |---|---|---|
> | Contenu du fichier de migration | lecture du fichier du dépôt | 3 `CREATE TABLE` + 6 index, aucun `ALTER`/`DROP` |
> | Checksum | `prisma migrate deploy` réel (Prisma **6.1.0**) sur base jetable | `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385` |
> | SHA-256 du fichier | `crypto` sur les octets du fichier | **identique** au checksum ci-dessus |
> | Réconciliation sur historique complet | 9 migrations préalables + `INSERT` manuel + `migrate deploy` | `No pending migrations to apply`, aucune migration rejouée |
> | Historique après réconciliation | `SELECT` sur `_prisma_migrations` | exactement 1 ligne, checksum correct |
> | Données cliniques | ligne `patients` sentinelle créée avant la migration | intacte après |
> | Blocs SQL de CE document | extraits puis exécutés dans l'ordre sur base jetable | tous exécutables, résultats conformes |
>
> Harnais reproductibles (base **jetable** uniquement, jamais la production) :
>
> ```bash
> node scripts/verifier-checksum-prisma.mjs
> node scripts/verifier-reconciliation-neon.mjs
> node scripts/verifier-sql-documentation.mjs
> ```

---

## Règles absolues avant de commencer

1. **Aucune écriture n'est faite par vous avant l'étape 0.** La sauvegarde
   d'abord, toujours.
2. **Collez chaque bloc entier et cliquez une seule fois sur Run.** L'éditeur
   SQL de Neon prend en charge plusieurs instructions par requête et affiche
   un jeu de résultats par instruction, dans des onglets numérotés (voir
   [Query with Neon's SQL Editor](https://neon.tech/docs/get-started-with-neon/query-with-neon-sql-editor)).
   Les blocs `BEGIN; … COMMIT;` sont donc volontairement atomiques : en cas
   d'erreur au milieu, PostgreSQL annule tout et aucune table n'est laissée
   à moitié créée.
3. **STOP immédiat** dès qu'un résultat diffère de « attendu ». Reportez le
   résultat réel — ne « réparez » jamais à l'aveugle.
4. **Aucun secret** ne doit être copié dans ce document, dans un ticket ou dans
   un message. La chaîne de connexion reste dans Neon.

---

## Ce que la migration contient exactement

Le fichier `database/prisma/migrations/20261114000000_sync_tombstones_durables/migration.sql`
(copie identique dans `desktop/runtime/prisma/migrations/`) exécute exactement
six instructions :

| # | Instruction | Effet |
|---|---|---|
| 1 | `CREATE TABLE "sync_tombstones"` | journal durable des suppressions |
| 2 | `CREATE INDEX "sync_tombstones_deletedAt_idx"` | curseur de lecture |
| 3 | `CREATE INDEX "sync_tombstones_entity_idx"` | recherche par entité |
| 4 | `CREATE TABLE "sync_tombstone_cursors"` | curseur par appareil (unique `deviceId`) |
| 5 | `CREATE TABLE "sync_tombstone_retention"` | borne de rétention |
| 6 | *(implicite)* contraintes `PRIMARY KEY` / `UNIQUE` créées par les `CREATE TABLE` | intégrité |

**Aucun `ALTER TABLE`, aucun `DROP`, aucun `UPDATE`, aucun `DELETE`, aucune
insertion dans une table existante.** La migration ne peut donc pas modifier,
écraser ou supprimer une donnée clinique existante : elle crée uniquement trois
nouvelles tables et leurs index.

> Remarque d'honnêteté : `sync_tombstone_retention` est créée par la migration
> mais **n'est pas encore lue par le code**. Elle est inoffensive (table vide,
> aucun consommateur). La rétention réelle est calculée par les curseurs dans
> `sync_tombstone_cursors` (`purgerTombstonesLus`). Elle est conservée pour ne
> pas diverger du fichier de migration déjà publié.

---

## Étape 0 — Sauvegarde Neon (obligatoire)

1. Console Neon → projet de production → **Branches** → branche principale.
2. **Create branch** → nommer `backup-avant-sync-tombstones-20261114` →
   branche source = la branche principale → créer.
3. Attendre que la nouvelle branche affiche **Ready**.
4. Dans la branche de sauvegarde, onglet **SQL Editor**, exécuter :

```sql
SELECT current_database() AS base, version() AS version_postgres;
```

**Attendu** : 1 ligne, `base` = le nom de la base de production, `version_postgres`
commence par `PostgreSQL 16` ou `PostgreSQL 17`.

**STOP** si la branche n'est pas `Ready`, ou si la requête échoue.

5. Relever et conserver (hors du dépôt) l'horodatage exact de création.

> La branche de sauvegarde est une copie complète et instantanée (copy-on-write)
> : elle ne consomme quasiment rien et se restaure en la promouvant. **Ne la
> supprimez pas** avant la validation finale.

---

## Étape 1 — Contrôles AVANT migration (lecture seule)

Exécuter sur la **branche de production** (pas la sauvegarde).

### 1.1 — État de l'historique Prisma

```sql
SELECT migration_name, length(checksum) AS longueur_checksum,
       applied_steps_count, rolled_back_at IS NULL AS appliquee_ok
  FROM _prisma_migrations
 ORDER BY started_at;
```

**Attendu** : **9 lignes**.

| migration_name | longueur_checksum | appliquee_ok |
|---|---|---|
| `20250101000000_initial_schema` | 64 | `true` |
| `20250101000001_postgresql_integrity` | 64 | `true` |
| `20260927000000_appointment_submission_key` | 64 | `true` |
| `20260928000000_patient_age` | 64 | `true` |
| `20261028000000_finances_privees` | 64 | `true` |
| `20261030193357_transactions_personnelles` | 64 | `true` |
| `20261031011158_paiements_acompte` | 64 | `true` |
| `20261101000000_sync_offline_first` | 64 | `true` |
| `20261107000000_ordonnance_idempotence_entete` | 64 | `true` |

**STOP** si :
- le nombre de lignes n'est pas 9 ;
- une ligne a `appliquee_ok = false` ;
- **la migration `20261114000000_sync_tombstones_durables` apparaît déjà**
  (dans ce cas le travail est déjà fait : passez à l'étape 3, ne l'insérez
  pas deux fois).

> Une ligne `20260928000000_patient_age` avec `applied_steps_count = 0` et un
> `logs` contenant « column "age" already exists » est un **état historique
> connu et sans effet** : la seconde ligne `applied_steps_count = 1` est
> l'application réelle. Ne la corrigez pas pendant cette procédure.

### 1.2 — Les tables de synchronisation n'existent pas encore

```sql
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('sync_tombstones', 'sync_tombstone_cursors', 'sync_tombstone_retention')
 ORDER BY table_name;
```

**Attendu** : **0 ligne**.

**STOP** si une ligne apparaît : la migration a déjà été partiellement
appliquée. Poursuivez à l'étape 3 (vérification) **sans** exécuter l'étape 2.

### 1.3 — Volumes cliniques de référence (à photographier)

```sql
SELECT
  (SELECT count(*)::int FROM patients)      AS patients,
  (SELECT count(*)::int FROM appointments)  AS rendez_vous,
  (SELECT count(*)::int FROM treatments)    AS traitements,
  (SELECT count(*)::int FROM payments)      AS paiements,
  (SELECT count(*)::int FROM users)         AS utilisateurs;
```

**Attendu** : 1 ligne, cinq entiers ≥ 0.

**Notez ces cinq nombres** : ils constituent votre référence. Toute diminution
après migration est un incident (elle est théoriquement impossible : la
migration ne supprime rien).

### 1.4 — Droits du rôle

```sql
SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS peut_creer_table;
```

**Attendu** : `peut_creer_table = true`.

**STOP** si `false` : le rôle courant ne peut pas créer de table ; cette
procédure ne doit pas être forcée.

---

## Étape 2 — Migration + réconciliation Prisma

> **Pourquoi une réconciliation ?** L'environnement d'exécution n'a pas accès à
> la chaîne de connexion de production : `prisma migrate deploy` ne peut donc
> pas être lancé ici. L'éditeur SQL, lui, applique exactement le même DDL, et
> l'insertion de la ligne d'historique est reproduite à l'identique de ce que
> Prisma 6.1.0 écrit lui-même (mesuré, pas supposé).

### 2.1 — Créer les trois tables et leurs index

Copier ce bloc **entier** dans l'éditeur SQL Neon, puis **Run** *(une seule
fois : les onglets de résultats multiples sont normaux)*.

```sql
BEGIN;

CREATE TABLE "sync_tombstones" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'DELETE',
  "sourceTrashId" UUID,
  "deviceId" TEXT,
  "deletedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "sync_tombstones_deletedAt_idx" ON "sync_tombstones"("deletedAt");

CREATE INDEX "sync_tombstones_entity_idx" ON "sync_tombstones"("entityType", "entityId");

CREATE TABLE "sync_tombstone_cursors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "lastTombstoneAt" TIMESTAMPTZ NOT NULL DEFAULT now() - interval '100 years',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "sync_tombstone_cursors_device_key" UNIQUE ("deviceId")
);

CREATE TABLE "sync_tombstone_retention" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "safeBefore" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
```

**Attendu** : succès, sans message d'erreur.

**En cas d'erreur** → le `BEGIN`/`COMMIT` annule tout : aucune table n'est
laissée à moitié créée. Reportez le message exact, puis **STOP**.

### 2.2 — Enregistrer la migration dans l'historique Prisma

Copier ce bloc **entier**, puis **Run** *(une seule fois)*. Ne rien modifier.

```sql
BEGIN;

INSERT INTO _prisma_migrations
  (id, checksum, migration_name, logs, rolled_back_at, started_at, finished_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  '68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385',
  '20261114000000_sync_tombstones_durables',
  NULL,
  NULL,
  now(),
  now(),
  1
);

COMMIT;
```

**Attendu** : `INSERT 0 1`.

**STOP** si Neon échoue sur une contrainte d'unicité : la migration est déjà
enregistrée ; n'insistez pas, passez à l'étape 3.

> Détails vérifiés empiriquement sur Prisma 6.1.0 :
> - `_prisma_migrations.id` est un `character varying` → cast `::text` fourni ;
> - `checksum` = **SHA-256 des octets bruts du fichier `migration.sql`**
>   (mesuré : identique au fichier du dépôt) ;
> - `started_at`/`finished_at` non nuls, `logs`/`rolled_back_at` à `NULL`,
>   `applied_steps_count = 1` ;
> - après cette insertion, `prisma migrate deploy` répond
>   `No pending migrations to apply` **sans rejouer la migration**
>   (vérifié sur un historique complet de 10 migrations).

---

## Étape 3 — Contrôles APRÈS migration (lecture seule)

### 3.1 — Les trois tables existent

```sql
SELECT count(*)::int AS nombre_tables
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('sync_tombstones', 'sync_tombstone_cursors', 'sync_tombstone_retention');
```

**Attendu** : `nombre_tables = 3`.

### 3.2 — Les six index existent (par nom)

```sql
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename IN ('sync_tombstones', 'sync_tombstone_cursors', 'sync_tombstone_retention')
 ORDER BY indexname;
```

**Attendu** : exactement ces 6 lignes.

| indexname |
|---|
| `sync_tombstone_cursors_device_key` |
| `sync_tombstone_cursors_pkey` |
| `sync_tombstone_retention_pkey` |
| `sync_tombstones_deletedAt_idx` |
| `sync_tombstones_entity_idx` |
| `sync_tombstones_pkey` |

**STOP** si un nom manque ou s'il y en a d'autres.

### 3.3 — Structures, types, nullabilité et valeurs par défaut

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('sync_tombstones', 'sync_tombstone_cursors', 'sync_tombstone_retention')
 ORDER BY table_name, ordinal_position;
```

**Attendu** : **15 lignes** exactement (8 colonnes pour `sync_tombstones`,
4 pour `sync_tombstone_cursors`, 3 pour `sync_tombstone_retention`).

| table_name | column_name | data_type | is_nullable | column_default |
|---|---|---|---|---|
| `sync_tombstone_cursors` | `id` | `uuid` | `NO` | `gen_random_uuid()` |
| `sync_tombstone_cursors` | `deviceId` | `uuid` | `NO` | *(vide)* |
| `sync_tombstone_cursors` | `lastTombstoneAt` | `timestamp with time zone` | `NO` | `(now() - '100 years'::interval)` |
| `sync_tombstone_cursors` | `updatedAt` | `timestamp with time zone` | `NO` | `now()` |
| `sync_tombstone_retention` | `id` | `uuid` | `NO` | `gen_random_uuid()` |
| `sync_tombstone_retention` | `safeBefore` | `timestamp with time zone` | `NO` | `now()` |
| `sync_tombstone_retention` | `updatedAt` | `timestamp with time zone` | `NO` | `now()` |
| `sync_tombstones` | `id` | `uuid` | `NO` | `gen_random_uuid()` |
| `sync_tombstones` | `entityType` | `text` | `NO` | *(vide)* |
| `sync_tombstones` | `entityId` | `uuid` | `NO` | *(vide)* |
| `sync_tombstones` | `type` | `text` | `NO` | `'DELETE'::text` |
| `sync_tombstones` | `sourceTrashId` | `uuid` | `YES` | *(vide)* |
| `sync_tombstones` | `deviceId` | `text` | `YES` | *(vide)* |
| `sync_tombstones` | `deletedAt` | `timestamp with time zone` | `NO` | `now()` |
| `sync_tombstones` | `createdAt` | `timestamp with time zone` | `NO` | `now()` |

Points de contrôle prioritaires : `deviceId` est `uuid` dans
`sync_tombstone_cursors` mais `text` dans `sync_tombstones` ; `sourceTrashId`
et `deviceId` (de `sync_tombstones`) sont les seules colonnes `is_nullable =
YES` ; `lastTombstoneAt` est le seul défaut `(now() - '100 years'::interval)`.

### 3.4 — La migration figure exactement une fois, checksum correct

```sql
SELECT count(*)::int AS nombre,
       min(checksum) AS checksum,
       min(applied_steps_count) AS etapes,
       bool_and(rolled_back_at IS NULL) AS non_annulee
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_sync_tombstones_durables';
```

**Attendu** :

| nombre | checksum | etapes | non_annulee |
|---|---|---|---|
| `1` | `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385` | `1` | `true` |

**STOP** si `nombre ≠ 1` ou si le checksum diffère, même d'un caractère.

### 3.5 — Les données cliniques sont intactes

```sql
SELECT
  (SELECT count(*)::int FROM patients)      AS patients,
  (SELECT count(*)::int FROM appointments)  AS rendez_vous,
  (SELECT count(*)::int FROM treatments)    AS traitements,
  (SELECT count(*)::int FROM payments)      AS paiements,
  (SELECT count(*)::int FROM users)         AS utilisateurs;
```

**Attendu** : 1 ligne, **identique à l'étape 1.3**, nombre par nombre.

**STOP** si un nombre a diminué.

### 3.6 — Les tables existantes répondent normalement

```sql
SELECT
  (SELECT count(*)::int FROM users WHERE "isActive" = true) AS utilisateurs_actifs,
  (SELECT count(*)::int FROM sync_events)                   AS evenements_sync;
```

**Attendu** : 1 ligne, deux entiers ≥ 0 (aucune erreur).

---

## Instructions REPORTER (ce que vous m'envoyez)

Envoyez-moi **exactement** :

1. L'horodatage de création de la branche de sauvegarde et son état (`Ready`).
2. Le tableau de **1.3** (les 5 nombres cliniques avant).
3. La sortie de **2.1** et **2.2** (succès / `INSERT 0 1`).
4. Les résultats de **3.1**, **3.2** (les 6 lignes), **3.3** (les 15 lignes),
   **3.4**, **3.5** et **3.6**.
5. Aucun mot de passe, aucune chaîne de connexion.

Je ne déclarerai la migration appliquée qu'après réception de **3.4** et
**3.5**, puisque ce sont eux qui prouvent le checksum et l'intégrité des
données.

---

## Après réception : vérification Prisma (de mon côté)

```bash
# Avec DATABASE_URL de production dans l'environnement (jamais dans un fichier versionné)
npx prisma migrate status --schema database/prisma/schema.prisma
```

**Attendu** : `10 migrations found in prisma/migrations` puis
`Database schema is up to date!`, code de sortie `0`.

```bash
npx prisma migrate deploy --schema database/prisma/schema.prisma
```

**Attendu** : `No pending migrations to apply.` — **aucune** ligne
`Applying migration`.

---

## Récupération en cas d'échec

| Situation | Action |
|---|---|
| Étape 2.1 échoue | `BEGIN`/`COMMIT` a tout annulé. Vérifier `3.1` → 0 ligne. Corriger la cause, recommencer 2.1. |
| Étape 2.1 réussie, 2.2 échoue | Tables présentes, historique absent. **Ne relancez pas 2.1.** Réexécutez seulement 2.2. |
| `migrate deploy` tente de **rejouer** la migration | Le checksum ou le nom diffère. Vérifiez `3.4`. Ne forcez pas : `prisma migrate resolve --rolled-back` **n'est pas** la bonne action ici. |
| Données cliniques anormales | **Restaurer la branche de sauvegarde** : Neon → branche `backup-avant-sync-tombstones-20261114` → promouvoir en branche principale. Ne tentez jamais une « réparation » manuelle de données cliniques. |
| Tout est bloqué | Le système reste utilisable : le bureau fonctionne hors ligne et le site web n'utilise **pas** ces tables tant qu'aucun appareil n'est appairé. |

### Retour arrière complet (avant tout appairage)

Uniquement si la migration doit être annulée **et** qu'aucun appareil n'a été
appairé — donc qu'aucune donnée de synchronisation n'existe :

```sql
SELECT (SELECT count(*)::int FROM sync_tombstones)
     + (SELECT count(*)::int FROM sync_tombstone_cursors)
     + (SELECT count(*)::int FROM sync_tombstone_retention) AS lignes_sync;
```

**Si et seulement si** `lignes_sync = 0`, alors — et alors seulement — vous
pouvez envisager la suppression des trois tables (aucune donnée clinique
concernée). Cette opération n'est **pas** incluse comme instruction à exécuter :
préférez toujours la restauration de la branche de sauvegarde, qui est
réversible et n'exige aucune commande destructive.

---

## Journal

| Champ | Valeur |
|---|---|
| Migration | `20261114000000_sync_tombstones_durables` |
| Checksum (Prisma 6.1.0, mesuré) | `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385` |
| Prisma / client | `6.1.0` / `6.1.0` |
| Statut | **NON APPLIQUÉE** — en attente de l'action du propriétaire |
| Appliquée le | *(à compléter après confirmation)* |
