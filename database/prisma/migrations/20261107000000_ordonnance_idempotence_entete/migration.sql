-- Alterations pour le generateur d'ordonnances : idempotence + en-tete persiste.
-- submissionKey : meme mecanique que appointments."submissionKey" (anti double soumission).
ALTER TABLE "prescriptions" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "prescriptions_submissionKey_key" ON "prescriptions"("submissionKey");
ALTER TABLE "prescriptions" ADD COLUMN "enteteOrdonnance" JSONB;
