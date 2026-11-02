-- =============================================================================
--  TRANSACTIONS PERSONNELLES DU MEDECIN — table ADDITIVE uniquement
-- =============================================================================
--  Aucune table ni colonne existante n'est modifiee. Distincte de :
--    - `payments` (paiements clinique) ;
--    - `manual_incomes` / `expenses` (finances du cabinet) ;
--    - les soldes patients (calcules).
--  Montants : centimes ENTIERS, strictement positifs. Le signe est porte par
--  `nature` (REVENUE / DEPENSE) — jamais par une valeur negative stockee.
-- =============================================================================

-- CreateEnum
CREATE TYPE "personal_nature" AS ENUM ('REVENUE', 'DEPENSE', 'DETTE_PERSONNELLE');

-- CreateEnum
CREATE TYPE "personal_direction" AS ENUM ('DO', 'DU_PAR_UN_TIERS');

-- CreateTable
CREATE TABLE "personal_transactions" (
    "id" UUID NOT NULL,
    "montantCentimes" INTEGER NOT NULL,
    "nature" "personal_nature" NOT NULL,
    "direction" "personal_direction",
    "titre" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personal_transactions_pkey" PRIMARY KEY ("id")
);

-- Unicite de la cle d'anti-doublon : un second envoi du meme formulaire ne
-- cree pas une seconde ligne (mecanisme identique a payments / manual_incomes).
CREATE UNIQUE INDEX "personal_transactions_idempotencyKey_key" ON "personal_transactions"("idempotencyKey");

CREATE INDEX "personal_transactions_date_idx" ON "personal_transactions"("date");
CREATE INDEX "personal_transactions_nature_idx" ON "personal_transactions"("nature");
CREATE INDEX "personal_transactions_createdById_idx" ON "personal_transactions"("createdById");

-- Montant strictement positif, meme regle que les paiements et les depenses.
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_montant_check" CHECK ("montantCentimes" > 0);

-- Une dette personnelle porte TOUJOURS une direction ; les autres natures jamais.
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_direction_check" CHECK (
    ("nature" = 'DETTE_PERSONNELLE' AND "direction" IS NOT NULL)
    OR ("nature" <> 'DETTE_PERSONNELLE' AND "direction" IS NULL)
);

-- Cle etrangere vers les utilisateurs (auteur de la saisie).
ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
