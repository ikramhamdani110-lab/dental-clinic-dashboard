ALTER TABLE "appointments" ADD COLUMN "submissionKey" TEXT;

CREATE UNIQUE INDEX "appointments_submissionKey_key" ON "appointments"("submissionKey");