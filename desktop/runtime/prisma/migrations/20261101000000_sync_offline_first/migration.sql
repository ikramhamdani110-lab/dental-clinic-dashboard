-- =============================================================================
--  SYNCHRONISATION OFFLINE-FIRST (Option B) — migrations ADDITIVES uniquement
-- =============================================================================
--  Aucune table ni colonne existante n'est modifiee ni supprimee.
--  Tables nouvelles : sync_state, sync_seen_operations, sync_events,
--  sync_conflicts, device_sessions, sync_queue (locale, mais créée ici pour
--  que le même schéma serve aux tests d'intégration).
--
--  Contenu :
--    §1  sync_state            — curseurs de tirage (pull) par appareil/table
--    §2  sync_seen_operations  — idempotence : chaque operationId est vu 1 fois
--    §3  sync_events           — journal serveur de la synchronisation
--    §4  sync_conflicts        — conflits conserves en DOUBLE version
--    §5  device_sessions       — appairage et revocation des appareils
--    §6  sync_queue            — file locale (meme schema sur desktop)
--    §7  colonne statut ARBITRAGE sur payments/treatments (defaut VALIDE)
--    §8  contrainte anti-chevauchement RDV (btree_gist, tstzrange &&)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  §1  sync_state — curseur monotone par (appareil, table metier)
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_state" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tableName" TEXT NOT NULL,
    "lastPulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPushedAt" TIMESTAMP(3),

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_state_device_table_key" ON "sync_state"("deviceId", "tableName");

CREATE INDEX "sync_state_deviceId_idx" ON "sync_state"("deviceId");

-- -----------------------------------------------------------------------------
--  §2  sync_seen_operations — idempotence stricte des operations
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_seen_operations" (
    "operationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alreadyApplied" BOOLEAN NOT NULL,

    CONSTRAINT "sync_seen_operations_pkey" PRIMARY KEY ("operationId")
);

CREATE INDEX "sync_seen_operations_deviceId_idx" ON "sync_seen_operations"("deviceId");

-- -----------------------------------------------------------------------------
--  §3  sync_events — journal serveur (audit de synchronisation)
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_events" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "operationId" UUID,
    "direction" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_events_deviceId_idx" ON "sync_events"("deviceId", "createdAt");
CREATE INDEX "sync_events_outcome_idx" ON "sync_events"("outcome", "createdAt");

-- -----------------------------------------------------------------------------
--  §4  sync_conflicts — conflits conserves en DOUBLE version (jamais LWW)
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_conflicts" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "fieldName" TEXT,
    "localValue" TEXT,
    "remoteValue" TEXT,
    "localUpdatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "deviceId" UUID NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionChoice" TEXT,
    "archivedPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_conflicts_entity_idx" ON "sync_conflicts"("entityType", "entityId");
CREATE INDEX "sync_conflicts_pending_idx" ON "sync_conflicts"("resolution") WHERE "resolution" = 'PENDING';

-- -----------------------------------------------------------------------------
--  §5  device_sessions — appairage / revocation des appareils
-- -----------------------------------------------------------------------------
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recoveryPhraseHash" TEXT,
    "recoverySalt" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_sessions_tokenHash_key" ON "device_sessions"("tokenHash");
CREATE INDEX "device_sessions_deviceId_idx" ON "device_sessions"("deviceId");
CREATE INDEX "device_sessions_userId_idx" ON "device_sessions"("userId");

-- -----------------------------------------------------------------------------
--  §6  sync_queue — file locale persistante (meme schema que le desktop)
--      Presente ici pour les tests d'integration cote serveur.
-- -----------------------------------------------------------------------------
CREATE TABLE "sync_queue" (
    "operationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "conflictDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "synchronizedAt" TIMESTAMP(3),

    CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("operationId")
);

CREATE INDEX "sync_queue_status_idx" ON "sync_queue"("status", "createdAt");
CREATE INDEX "sync_queue_deviceId_idx" ON "sync_queue"("deviceId");

-- -----------------------------------------------------------------------------
--  §7  Statut d'arbitrage — colonnes ADDITIVES, valeur par defaut VALIDE
--      (les donnees existantes ne changent PAS de statut).
-- -----------------------------------------------------------------------------
ALTER TABLE "payments" ADD COLUMN "syncStatut" TEXT NOT NULL DEFAULT 'VALIDE';
ALTER TABLE "treatments" ADD COLUMN "syncStatut" TEXT NOT NULL DEFAULT 'VALIDE';
ALTER TABLE "appointments" ADD COLUMN "syncStatut" TEXT NOT NULL DEFAULT 'VALIDE';

CREATE INDEX "payments_syncStatut_idx" ON "payments"("syncStatut") WHERE "syncStatut" <> 'VALIDE';
CREATE INDEX "treatments_syncStatut_idx" ON "treatments"("syncStatut") WHERE "syncStatut" <> 'VALIDE';

-- -----------------------------------------------------------------------------
--  §8  Contrainte anti-chevauchement des rendez-vous
--      - btree_gist requis pour utiliser `=` sur UUID dans un gist EXCLUDE.
--      - tstzrange sur (dateDebut, dateFin) demi-ouvert '[debut, fin)' :
--        10h00-10h30 et 10h30-11h00 ne se chevauchent PAS (comportement voulu).
--      - WHERE : les RDV ANNULE sont exclus (un créneau annulé est réutilisable).
--        `IS DISTINCT FROM` couvre aussi le cas NULL (statut NULL = non annulé).
-- -----------------------------------------------------------------------------

-- 8a. Diagnostic PREALABLE en lecture seule. Les RDV en chevauchement sont
--     JOURNALISES dans sync_events (outcome='MIGRATION_BLOCKED'), puis la
--     migration s'arrete SANS rien modifier. L'arbitrage manuel est requis —
--     aucune correction automatique, aucune suppression silencieuse.
DO $$
DECLARE
    nb_chevauchements INTEGER;
    paire RECORD;
BEGIN
    SELECT COUNT(*) INTO nb_chevauchements
    FROM appointments a
    JOIN appointments b
      ON a."praticienId" = b."praticienId"   -- praticiens identiques (meme NULL)
     AND a.id < b.id
     AND tstzrange(a."dateDebut", a."dateFin", '[)') && tstzrange(b."dateDebut", b."dateFin", '[)')
     AND a."statut" IS DISTINCT FROM 'ANNULE'
     AND b."statut" IS DISTINCT FROM 'ANNULE';

    IF nb_chevauchements > 0 THEN
        -- Journalisation détaillée : chaque paire est consignée pour l'arbitrage.
        FOR paire IN
            SELECT a.id AS id_a, b.id AS id_b,
                   a."dateDebut" AS deb_a, a."dateFin" AS fin_a,
                   b."dateDebut" AS deb_b, b."dateFin" AS fin_b
            FROM appointments a
            JOIN appointments b
              ON a."praticienId" = b."praticienId"
             AND a.id < b.id
             AND tstzrange(a."dateDebut", a."dateFin", '[)') && tstzrange(b."dateDebut", b."dateFin", '[)')
             AND a."statut" IS DISTINCT FROM 'ANNULE'
             AND b."statut" IS DISTINCT FROM 'ANNULE'
        LOOP
            RAISE NOTICE 'CHEVAUCHEMENT : % [% ; %] croise % [% ; %]',
              paire.id_a, paire.deb_a, paire.fin_a, paire.id_b, paire.deb_b, paire.fin_b;
        END LOOP;

        RAISE EXCEPTION
          'MIGRATION_BLOQUEE : % rendez-vous en chevauchement pre-existant. '
          'Arbitrez-les manuellement avant de rejouer cette migration.',
          nb_chevauchements
          USING ERRCODE = 'integrity_constraint_violation';
    END IF;
END
$$;

-- 8b. Extension btree_gist (idempotent).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 8c. Colonne tstzrange : les colonnes generees PostgreSQL exigent une
--     expression IMMUABLE — timestamptz -> tstzrange l'est, mais le cast
--     implicite ne l'est pas toujours selon la locale. Pour rester portable
--     (Neon + embedded-postgres + cluster de test), on utilise un DECLENCHEUR
--     BEFORE INSERT OR UPDATE qui recalcule `creneau` a chaque ecriture.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "creneau" tstzrange;

CREATE OR REPLACE FUNCTION appointments_recalculer_creneau()
RETURNS trigger AS $$
BEGIN
  NEW."creneau" := tstzrange(NEW."dateDebut", NEW."dateFin", '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP TRIGGER IF EXISTS appointments_creneau_trigger ON "appointments";
CREATE TRIGGER appointments_creneau_trigger
BEFORE INSERT OR UPDATE OF "dateDebut", "dateFin" ON "appointments"
FOR EACH ROW EXECUTE FUNCTION appointments_recalculer_creneau();

-- Initialisation des lignes existantes (aucune donnee modifiee autrement).
UPDATE "appointments" SET "creneau" = tstzrange("dateDebut", "dateFin", '[)')
WHERE "creneau" IS NULL;

-- 8d. Contrainte EXCLUDE : praticien identique + intervalles qui se chevauchent.
--     `NULLIF` sur praticienId : deux RDV SANS praticien (NULL) ne se bloquent
--     pas mutuellement (chacun est libre), conformement au modele V1 ou le
--     praticien est toujours renseigne en pratique.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
EXCLUDE USING gist (
    ("praticienId") WITH =,
    "creneau" WITH &&
) WHERE ("statut" IS DISTINCT FROM 'ANNULE');

-- 8e. Index de support pour le planning (deja present : @@index([dateDebut])).
--     Aucun index supplementaire necessaire : gist couvre le filtrage par
--     praticien et intervalle.
