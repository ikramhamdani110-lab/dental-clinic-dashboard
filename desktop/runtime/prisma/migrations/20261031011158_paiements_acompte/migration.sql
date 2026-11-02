-- =============================================================================
--  PAIEMENTS AVANCÉS / ACOMPTES — treatmentId devient NULLABLE (§paiements-avance)
-- =============================================================================
--  Prisma génère des DropIndex/DropIndex accessoires en inspectant la base :
--  ils ne font pas partie du changement métier. Cette migration est réduite
--  au SEUL changement voulu, réversible et sans perte de données :
--
--    ALTER TABLE payments ALTER COLUMN "treatmentId" DROP NOT NULL;
--
--  Un paiement avec treatmentId NULL est un ACOMPTE : argent reçu du patient
--  avant tout traitement. Il appartient au patient (crédit), jamais converti
--  en « faux traitement ». Aucune donnée existante n'est modifiée ni supprimée.
-- =============================================================================

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "treatmentId" DROP NOT NULL;
