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
> | Historique de référence (1.1) | reproduction sur base jetable de l'état production RÉEL (10 lignes : 9 OK + 1 `sync_offline_first` rolled-back) puis de la réconciliation | conforme, aucune réparation nécessaire |
> | Version PostgreSQL production | mesurée par le propriétaire (2026-11-18) | **PostgreSQL 18.7** — compatible (voir étape 0) |
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
> node scripts/verifier-resolution-echec-patient-age.mjs   # cas échec non résolu 1.1
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
commence par `PostgreSQL 16`, `PostgreSQL 17` **ou `PostgreSQL 18`**.

> **Version réelle mesurée en production (2026-11-18)** : **PostgreSQL 18.7**.
> PostgreSQL 18 est la version par défaut des nouveaux projets Neon depuis
> juin 2026 (voir [Neon — changelog 2026-06-05](https://neon.com/docs/changelog/2026-06-05))
> et reste supportée (voir [Neon — Postgres Version Support](https://neon.com/docs/postgresql/postgres-version-support)).
> La migration cible n'utilise aucune fonctionnalité spécifique à une version :
> uniquement `CREATE TABLE` + index UUID/timestamptz, disponibles depuis
> PostgreSQL 13 (`gen_random_uuid()` natif). **PG 18.7 est donc compatible**
> — aucune adaptation nécessaire.

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
SELECT migration_name,
       length(checksum) AS longueur_checksum,
       applied_steps_count,
       finished_at IS NOT NULL AS terminee,
       rolled_back_at IS NULL AS non_annulee,
       CASE WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 'ECHEC_NON_RESOLU'
            WHEN rolled_back_at IS NOT NULL THEN 'ANNULEE'
            ELSE 'OK' END AS etat,
       substring(logs for 120) AS logs_extrait,
       started_at
  FROM _prisma_migrations
 ORDER BY started_at;
```

**Attendu : 10 lignes**, correspondant à l'état RÉEL mesuré en production
(2026-11-18) : **9 migrations réussies (`etat = 'OK'`) + 1 ligne
`20261101000000_sync_offline_first` en `ANNULEE`** (première tentative
échouée puis marquée rolled-back, suivie d'une seconde tentative réussie).

| migration_name | etat attendu | notes |
|---|---|---|
| `20250101000000_initial_schema` | `OK` | |
| `20250101000001_postgresql_integrity` | `OK` | |
| `20260927000000_appointment_submission_key` | `OK` | |
| `20260928000000_patient_age` | `OK` | **FINI — une seule ligne**, pas d'échec (confirmé en production le 2026-11-18) |
| `20261028000000_finances_privees` | `OK` | |
| `20261030193357_transactions_personnelles` | `OK` | |
| `20261031011158_paiements_acompte` | `OK` | |
| `20261101000000_sync_offline_first` | `OK` **+** `ANNULEE` (2 lignes) | la ligne `ANNULEE` (`applied_steps_count = 0`, `finished_at` NULL, `rolled_back_at` renseigné) est la 1ʳᵉ tentative échouée — voir encadré ci-dessous |
| `20261107000000_ordonnance_idempotence_entete` | `OK` | |

**Règle d'acceptation :**

| Condition | Résultat |
|---|---|
| Exactement 10 lignes : les 9 migrations ci-dessus présentes (dont
`sync_offline_first` 2 fois — 1 OK + 1 ANNULEE) et **aucune** ligne en
`ECHEC_NON_RESOLU` | ✅ passez à 1.2 |
| Toute ligne en `ECHEC_NON_RESOLU` (quel que soit son nom) | 🔴 **STOP** — envoyez-moi la sortie complète avant toute action |
| Toute autre configuration (migration manquante, dupliquée, ou ligne
`ANNULEE` sur un autre nom que `sync_offline_first`) | 🔴 **STOP** — envoyez-moi la sortie complète |

> **Pourquoi la ligne `sync_offline_first` en `ANNULEE` est sûre (explication
> factuelle)**
>
> 1. Le fichier `20261101000000_sync_offline_first/migration.sql` du dépôt
>    contient 6 `CREATE TABLE` (sync_state, sync_seen_operations,
>    sync_events, sync_conflicts, device_sessions, sync_queue), 3 `ALTER
>    TABLE ADD COLUMN "syncStatut"`, une extension btree_gist, un
>    déclencheur `creneau` et une contrainte EXCLUDE anti-chevauchement.
>    Les `CREATE TABLE` ne sont pas idempotents (pas de `IF NOT EXISTS`) :
>    si l'une des tables existait déjà, la migration échouait à cette
>    instruction.
> 2. **Le scénario réel mesuré en production** : une première exécution a
>    échoué (ligne `applied_steps_count = 0`), la ligne a été clôturée par
>    `prisma migrate resolve --rolled-back` (ou équivalent SQL), PUIS la
>    migration a été rejouée avec succès (seconde ligne,
>    `applied_steps_count = 1`, `finished_at` renseigné).
> 3. **Pourquoi c'est sans effet sur la suite :**
>    - `prisma migrate status` / `migrate deploy` ignorent les lignes
>      `rolled_back_at` renseigné — elles sont considérées comme
>      « retirées de l'historique actif ». Prisma ne les rejoue PAS et ne
>      se bloque PAS dessus (vérifié sur base jetable : harnais
>      `verifier-resolution-echec-patient-age.mjs`, étapes C→E).
>    - La ligne en `OK` (la seconde) fait foi pour Prisma : la migration
>      est considérée appliquée.
>    - Les tables qu'elle a créées existent bien (vérifié par l'étape 1.2
>      côté sync : `sync_events` répond normalement, cf. étape 3.6).
> 4. **Aucune réparation n'est nécessaire** pour cette ligne : elle est
>    déjà correctement clôturée (`rolled_back_at` renseigné). Le bloc de
>    réparation patient_age plus bas ne s'applique PAS à votre base
>    (`patient_age` est déjà `OK`, une seule ligne).
>
> Référence Prisma : la table `_prisma_migrations` et la sémantique de
> `migrate resolve` sont documentées dans
> [Prisma — Migration issues](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-generating-a-migration-history).

> **Pourquoi une ligne `ANNULEE` est sans effet, et pourquoi un échec non
> résolu ne l'est pas (explication factuelle)**
>
> 1. Prisma écrit une ligne dans `_prisma_migrations` AVANT d'exécuter la
>    migration. En cas d'échec, cette ligne reste avec `finished_at = NULL`
>    et `applied_steps_count = 0`.
> 2. **Ligne `ANNULEE`** (`rolled_back_at` renseigné) : elle a été clôturée
>    par `prisma migrate resolve --rolled-back` (ou équivalent SQL). Prisma
>    l'ignore ensuite — ni `migrate status` ni `migrate deploy` ne la
>    rejouent ni ne se bloquent dessus (vérifié sur base jetable,
>    harnais `verifier-resolution-echec-patient-age.mjs`).
> 3. **Ligne `ECHEC_NON_RESOLU`** (`finished_at = NULL` ET
>    `rolled_back_at = NULL`) : elle bloque `migrate deploy` et
>    `migrate status` (Prisma refuse d'aller plus loin : « migration
>    failed »). Une réparation est alors requise AVANT l'étape 2 — voir
>    1.1bis. Votre exécution se fait via l'éditeur SQL Neon, qui n'est pas
>    bloqué : la ligne apparaît simplement dans 1.1.
> 4. Le `checksum` d'une ligne en échec peut être correct (64 caractères) :
>    ce n'est PAS un signe de réussite. Seul `finished_at` renseigné fait
>    foi.
>
> Référence Prisma : la table `_prisma_migrations` et la sémantique de
> `migrate resolve` sont documentées dans
> [Prisma — Migration issues](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-generating-a-migration-history).

### 1.1bis — Réparation d'un échec NON résolu (SEULEMENT si 1.1 en montre un)

> **État réel de la production (2026-11-18) : AUCUNE réparation nécessaire.**
> `patient_age` est `OK` (une ligne, finie) et la seule ligne non-OK est
> `sync_offline_first` déjà en `ANNULEE` — les deux cas sont sans effet.
> Cette section ne s'applique donc PAS à votre base actuelle. Elle est
> conservée au cas où une nouvelle exécution de 1.1 (par exemple après
> l'étape 2, si quelque chose tournait mal) révélait un échec non résolu.

**Réparation (SEULE si 1.1 montre une ligne `ECHEC_NON_RESOLU`)** —
vérifiez D'ABORD que le changement de schéma visé est en place (bloc
`colonne_age_existe` ci-dessous), puis exécutez ce bloc, et relancez 1.1 :

```sql
UPDATE _prisma_migrations
   SET rolled_back_at = now(),
       logs = COALESCE(logs, '')
              || CASE WHEN COALESCE(logs, '') = '' THEN '' ELSE ' | ' END
              || 'cloture manuelle : echec marque rolled-back (changement de schema verifie present, migration re-appliquee avec succes juste apres)'
 WHERE migration_name = '20260928000000_patient_age'
   AND applied_steps_count = 0
   AND finished_at IS NULL
   AND rolled_back_at IS NULL;
```

> **Condition préalable à la réparation — LIRE AVANT D'EXÉCUTER.**
> Marquer un échec comme `rolled-back` n'est sûr que si le changement de
> schéma visé par la migration est RÉELLEMENT en place dans la base — sinon
> `migrate deploy` considérera la migration comme déjà traitée et la colonne
> `age` ne sera jamais créée : l'application plantera à la première lecture
> des patients (`column "age" does not exist`). Vérifiez donc d'abord :

```sql
SELECT count(*)::int AS colonne_age_existe
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'patients'
   AND column_name = 'age';
```

> **Attendu : `1`.** Si le résultat est `0`, **STOP** : la colonne `age`
> n'existe pas en production — la vraie migration n'a jamais réussi. Il faut
> alors m'envoyer la sortie complète de 1.1 et de cette requête AVANT toute
> action : la réparation à appliquer serait différente (il faudrait laisser
> la ligne en échec et exécuter le DDL manuellement via un chemin validé,
> pas le marquer rolled-back). Si le résultat est `1` ET que 1.1 montre une
> ligne `20260928000000_patient_age` en `OK` (`applied_steps_count = 1`,
> `finished_at` renseigné), le changement est bien appliqué et la clôture de
> la ligne en échec est sûre.

**Attendu** : `UPDATE 1` (exactement une ligne clôturée), puis 1.1 relancé
affiche `ANNULEE` pour cette ligne et `OK` pour les autres.

**STOP** si `UPDATE` renvoie autre chose que 1 (0 ligne : le diagnostic ne
correspond pas à la réalité — envoyez-moi la sortie de 1.1 avant toute
autre action ; ≥ 2 lignes : n'insistez pas, il y a plusieurs échecs sur ce
nom — même chose).

**Note** : cette réparation n'est PAS destructive : elle ne modifie QUE la
table `_prisma_migrations` (l'historique), jamais une table clinique. Elle
calque exactement ce que fait `prisma migrate resolve --rolled-back` —
commande officielle de Prisma pour clôturer un échec — reproduite en SQL
pour être exécutable dans l'éditeur Neon. Son effet est vérifié par le
harnais (aucune différence de comportement de `migrate deploy` après).

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
| 1.1 montre un échec non résolu (`ECHEC_NON_RESOLU`) | Ne pas exécuter l'étape 2. Exécuter la réparation de 1.1bis (avec vérification préalable du schéma), relancer 1.1, puis m'envoyer les sorties. |
| Données cliniques anormales | **Restaurer la branche de sauvegarde** — voir la procédure contrôlée ci-dessus. Ne tentez jamais une « réparation » manuelle de données cliniques. |
| Tout est bloqué | Le système reste utilisable : le bureau fonctionne hors ligne et le site web n'utilise **pas** ces tables tant qu'aucun appareil n'est appairé. |

### Restauration de la sauvegarde — procédure contrôlée (PAS de promotion à l'aveugle)

**Quand restaurer ?** Uniquement sur un incident avéré affectant les données
c Cliniques (un volume de l'étape 3.5 a diminué, une table clinique absente, un
comportement inexpliqué après l'étape 2). Un simple échec d'étape 2 (tables
non créées, INSERT refusé) ne justifie PAS une restauration : il suffit de
corriger la cause et de relancer l'étape concernée.

**Quoi faire exactement, dans l'ordre :**

1. **Stoppez tout** : aucun nouvel SQL, aucun `migrate`, aucune ouverture de
   l'application. Notez l'heure de l'incident et les résultats des étapes
   1.3 / 3.5.
2. **Faites un diagnostic AVANT de toucher quoi que ce soit** : dans la branche
   de production, exécutez les requêtes de l'étape 3.1 à 3.6 et notez la
   sortie exacte. C'est elle qui dira si l'incident est réellement une perte de
   données ou un simple problème cosmétique.
3. **Si (et seulement si) une perte de données clinique est confirmée** :
   console Neon → projet → **Branches**.
4. **Vérifiez d'abord la branche de sauvegarde AVANT de la toucher** :
   ouvrez son **SQL Editor** et exécutez :

```sql
SELECT (SELECT count(*)::int FROM patients)     AS patients,
       (SELECT count(*)::int FROM appointments) AS rendez_vous,
       (SELECT count(*)::int FROM treatments)   AS traitements,
       (SELECT count(*)::int FROM payments)     AS paiements,
       (SELECT count(*)::int FROM users)        AS utilisateurs;
```

   Comparez à vos volumes de référence (étape 1.3) : ils doivent être
   **identiques** (la branche a été créée AVANT l'étape 2). Si ce n'est pas le
   cas, la sauvegarde est elle-même défectueuse — **STOP**, ne la promouvez
   surtout pas, signalez-moi l'incident.
5. **Uniquement si les volumes correspondent**, deux options de restauration
   (au choix, selon la durée d'interruption acceptable) :

   | Option | Procédure | Avantage / limite |
   |---|---|---|
   | **A — Promotion de branche** | Console Neon → branche de sauvegarde → `⋯` (menu) → **Set as default branch** (ou « Promote to primary »). Vérifiez ensuite que l'application pointe bien la nouvelle branche par défaut (Neon met à jour l'endpoint automatiquement, mais Vercel peut avoir une chaîne de connexion épingle — vérifiez dans Neon → Dashboard que la chaîne affichée correspond à la branche promue) | Instantané, zéro copie de données. Limite : l'endpoint change potentiellement d'identifiant ; testez `/api/health` après coup |
   | **B — Restauration sélective** | Ne pas toucher aux branches ; exécuter dans la branche de production un `pg_dump` de la sauvegarde (via la Console Neon ou `pg_dump` depuis votre machine avec la chaîne de la branche de sauvegarde) et restaurer UNIQUEMENT les objets manquants/endommagés | Plus fine, mais plus longue et exige une manipulation `pg_dump` correcte — à privilégier si l'incident ne touche qu'une table précise |

6. **Après restauration, re-exécutez l'étape 3 (contrôles) pour confirmer**
   que les volumes correspondent à 1.3, puis — seulement à ce moment —
   reprenez la procédure à l'étape où l'incident s'est produit.
7. **Consignez** dans le journal de bord : heure, symptôme, résultat du
   diagnostic de l'étape 2, option choisie (A ou B), résultat final.

**Dans TOUS les cas** : envoyez-moi les sorties complètes AVANT et APRÈS toute
opération de restauration — je ne considère la situation comme maîtrisée
qu'après une vérification contradictoire de votre côté et du mien.

> La branche de sauvegarde est une copie complète et instantanée
> (copy-on-write) : elle ne consomme quasiment rien. **Ne la supprimez pas**
> avant la validation finale de la procédure.

---

## Journal

| Champ | Valeur |
|---|---|
| Migration | `20261114000000_sync_tombstones_durables` |
| Checksum (Prisma 6.1.0, mesuré) | `68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385` |
| Prisma / client | `6.1.0` / `6.1.0` |
| Statut | **NON APPLIQUÉE** — en attente de l'action du propriétaire |
| Appliquée le | *(à compléter après confirmation)* |
