-- =============================================================================
--  FINANCES PRIVEES DU MEDECIN — tables ADDITIVES uniquement
-- =============================================================================
--  Aucune table ni colonne existante n'est modifiee : les donnees cliniques
--  (patients, traitements, paiements) restent strictement inchangees.
--  Les montants sont des centimes ENTIERS, meme regle que `payments`.
-- =============================================================================

-- ----------------------------------------------------------------------------
--  manual_incomes — argent recu HORS du circuit d'encaissement normal.
--  Ne double JAMAIS un paiement : les totaux distinguent toujours les deux
--  populations (payments VALIDE vs ManualIncome).
-- ----------------------------------------------------------------------------
CREATE TABLE "manual_incomes" (
    "id" UUID NOT NULL,
    "montantCentimes" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categorie" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_incomes_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
--  expenses — depenses du cabinet (materiel, fournitures, loyer, salaires...)
-- ----------------------------------------------------------------------------
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "montantCentimes" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categorie" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- Unicite de la cle d'anti-doublon : un second envoi du meme formulaire ne
-- cree pas une seconde ligne.
CREATE UNIQUE INDEX "manual_incomes_idempotencyKey_key" ON "manual_incomes"("idempotencyKey");
CREATE UNIQUE INDEX "expenses_idempotencyKey_key" ON "expenses"("idempotencyKey");

CREATE INDEX "manual_incomes_date_idx" ON "manual_incomes"("date");
CREATE INDEX "manual_incomes_categorie_idx" ON "manual_incomes"("categorie");
CREATE INDEX "expenses_date_idx" ON "expenses"("date");
CREATE INDEX "expenses_categorie_idx" ON "expenses"("categorie");

-- Montants strictement positifs, meme regle que les paiements (§17).
ALTER TABLE "manual_incomes" ADD CONSTRAINT "manual_incomes_montant_check" CHECK ("montantCentimes" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_montant_check" CHECK ("montantCentimes" > 0);

-- Cles etrangeres vers les utilisateurs (auteur de la saisie).
ALTER TABLE "manual_incomes" ADD CONSTRAINT "manual_incomes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
--  finance_sessions — sessions DEDIEES au site financier prive du medecin.
--  Volontairement SEPARÉE de `sessions` : le site financier ne peut jamais être
--  ouvert par la session de l'application de bureau, et réciproquement.
-- ----------------------------------------------------------------------------
CREATE TABLE "finance_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "finance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_sessions_tokenHash_key" ON "finance_sessions"("tokenHash");
CREATE INDEX "finance_sessions_userId_idx" ON "finance_sessions"("userId");
CREATE INDEX "finance_sessions_expiresAt_idx" ON "finance_sessions"("expiresAt");

ALTER TABLE "finance_sessions" ADD CONSTRAINT "finance_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
