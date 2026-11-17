-- =============================================================================
--  TOMBSTONES DURABLES DE SYNCHRONISATION — table sync_tombstones
-- =============================================================================
--  AUDIT (§3 de la mission) : les trash_entries sont purgées après 24 h
--  (purgerExpires) : un appareil resté hors ligne PLUS de 24 h raterait la
--  suppression et ferait « ressusciter » l'enregistrement à son prochain pull.
--
--  Cette table est un JOURNAL DURABLE des suppressions, indépendant de la
--  fenêtre de restauration :
--    - une ligne est écrite DANS LA TRANSACTION de chaque suppression
--      (mise en corbeille, suppression définitive, purge) ;
--    - un RESTORE écrit une ligne restaurée (type='RESTORE') qui annule le
--      tombstone précédent ;
--    - chaque appareil avance son propre curseur (sync_tombstone_cursors,
--      par device+table) : une ligne n'est JAMAIS supprimée tant qu'un
--      appareil apparié peut encore avoir besoin de la voir — la purge
--      n'a lieu que pour les lignes antérieures au PLUS ANCIEN curseur
--      actif de tous les appareils (rétention pilotée par curseur).
-- =============================================================================

CREATE TABLE "sync_tombstones" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  -- DELETE = suppression ; RESTORE = restauration (annule le DELETE).
  "type" TEXT NOT NULL DEFAULT 'DELETE',
  -- Identité de la corbeille d'origine (nullable : purge définitive sans corbeille).
  "sourceTrashId" UUID,
  -- UUID texte : pas de FK vers devices (peut référencer un appareil supprimé).
  "deviceId" TEXT,
  "deletedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "sync_tombstones_deletedAt_idx" ON "sync_tombstones"("deletedAt");
CREATE INDEX "sync_tombstones_entity_idx" ON "sync_tombstones"("entityType", "entityId");

-- Curseur de lecture des tombstones, par appareil et par table. Un appareil
-- qui vient d'être appairé démarre à epoch : il reçoit alors TOUT l'historique
-- durable des suppressions — jamais de résurrection.
CREATE TABLE "sync_tombstone_cursors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  -- Position = horodatage du dernier tombstone reçu (monotone).
  "lastTombstoneAt" TIMESTAMPTZ NOT NULL DEFAULT now() - interval '100 years',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "sync_tombstone_cursors_device_key" UNIQUE ("deviceId")
);

-- Rétention : on ne purge que les tombstones antérieurs au plus ancien curseur
-- ACTIF (dernière synchro réussie) de tous les appareils non révoqués — et
-- jamais au-delà de 90 jours (filet de sécurité absolu).
CREATE TABLE "sync_tombstone_retention" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Horodatage du plus ancien curseur actif, mis à jour à chaque pull.
  "safeBefore" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
