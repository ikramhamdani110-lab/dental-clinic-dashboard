-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEDECIN', 'ASSISTANT', 'ADMINISTRATEUR');

-- CreateEnum
CREATE TYPE "Sexe" AS ENUM ('MASCULIN', 'FEMININ', 'NON_PRECISE');

-- CreateEnum
CREATE TYPE "StatutTraitement" AS ENUM ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE');

-- CreateEnum
CREATE TYPE "StatutRendezVous" AS ENUM ('PLANIFIE', 'CONFIRME', 'EN_ATTENTE', 'EN_COURS', 'TERMINE', 'ANNULE', 'ABSENT', 'REPROGRAMME');

-- CreateEnum
CREATE TYPE "MethodePaiement" AS ENUM ('ESPECES', 'CARTE', 'VIREMENT', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutPaiement" AS ENUM ('VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "TypeCorrectionPaiement" AS ENUM ('ANNULATION', 'CORRECTION_MONTANT', 'CORRECTION_ATTRIBUT');

-- CreateEnum
CREATE TYPE "EtatDent" AS ENUM ('SAINE', 'CARIE', 'OBTUREE', 'ABSENTE', 'COURONNE', 'DEVITALISEE', 'EXTRACTION_PREVUE', 'IMPLANT', 'AUTRE');

-- CreateEnum
CREATE TYPE "TypeEntiteSupprimable" AS ENUM ('PATIENT', 'RENDEZ_VOUS', 'TRAITEMENT', 'VISITE_TRAITEMENT', 'PAIEMENT', 'DOSSIER_MEDICAL', 'ORDONNANCE', 'DOCUMENT', 'ENTREE_ODONTOGRAMME');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEDECIN',
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
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

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "successful" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "dateNaissance" TIMESTAMP(3),
    "sexe" "Sexe" NOT NULL DEFAULT 'NON_PRECISE',
    "telephone" TEXT NOT NULL,
    "telephoneSecondaire" TEXT,
    "adresse" TEXT,
    "email" TEXT,
    "allergies" TEXT,
    "antecedentsMedicaux" TEXT,
    "medicamentsActuels" TEXT,
    "contactUrgence" TEXT,
    "notesGenerales" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "typeTraitement" TEXT NOT NULL,
    "dents" TEXT NOT NULL DEFAULT '[]',
    "diagnostic" TEXT,
    "description" TEXT,
    "prixTotalCentimes" INTEGER NOT NULL,
    "statut" "StatutTraitement" NOT NULL DEFAULT 'PLANIFIE',
    "dateDebut" TIMESTAMP(3),
    "dateFin" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_visits" (
    "id" UUID NOT NULL,
    "treatmentId" UUID NOT NULL,
    "numeroSeance" INTEGER NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3),
    "notes" TEXT,
    "proceduresRealisees" TEXT,
    "appointmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "praticienId" UUID,
    "treatmentId" UUID,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,
    "dents" TEXT NOT NULL DEFAULT '[]',
    "motif" TEXT,
    "notes" TEXT,
    "statut" "StatutRendezVous" NOT NULL DEFAULT 'PLANIFIE',
    "motifStatut" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reschedules" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "ancienneDateDebut" TIMESTAMP(3) NOT NULL,
    "ancienneDateFin" TIMESTAMP(3) NOT NULL,
    "nouvelleDateDebut" TIMESTAMP(3) NOT NULL,
    "nouvelleDateFin" TIMESTAMP(3) NOT NULL,
    "motif" TEXT,
    "modifieParId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentId" UUID NOT NULL,
    "treatmentVisitId" UUID,
    "montantCentimes" INTEGER NOT NULL,
    "datePaiement" TIMESTAMP(3) NOT NULL,
    "methode" "MethodePaiement" NOT NULL,
    "statut" "StatutPaiement" NOT NULL DEFAULT 'VALIDE',
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceCorrectionId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_corrections" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "type" "TypeCorrectionPaiement" NOT NULL,
    "motif" TEXT NOT NULL,
    "ancienMontantCentimes" INTEGER NOT NULL,
    "ancienneMethode" "MethodePaiement" NOT NULL,
    "ancienneDate" TIMESTAMP(3) NOT NULL,
    "nouveauMontantCentimes" INTEGER,
    "nouvelleMethode" "MethodePaiement",
    "nouvelleDate" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentId" UUID,
    "date" TIMESTAMP(3) NOT NULL,
    "motifPlainte" TEXT,
    "examen" TEXT,
    "diagnostic" TEXT,
    "traitementRealise" TEXT,
    "observations" TEXT,
    "recommandations" TEXT,
    "dateSuivi" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentId" UUID,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "medicament" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequence" TEXT NOT NULL,
    "duree" TEXT NOT NULL,
    "instructions" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odontogram_entries" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentId" UUID,
    "numeroDent" TEXT NOT NULL,
    "etat" "EtatDent" NOT NULL,
    "commentaire" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odontogram_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "nomOriginal" TEXT NOT NULL,
    "cheminStockage" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tailleOctets" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "categorie" TEXT,
    "description" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trash_entries" (
    "id" UUID NOT NULL,
    "entityType" "TypeEntiteSupprimable" NOT NULL,
    "entityId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "supprimeParId" UUID,
    "supprimeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "restaureLe" TIMESTAMP(3),
    "restaureParId" UUID,
    "supprimeDefinitivementLe" TIMESTAMP(3),
    "supprimeDefinitivementParId" UUID,

    CONSTRAINT "trash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "userId" UUID,
    "userEmail" TEXT,
    "entityType" TEXT,
    "entityId" UUID,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ipAddress_createdAt_idx" ON "login_attempts"("ipAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "patients_nom_prenom_idx" ON "patients"("nom", "prenom");

-- CreateIndex
CREATE INDEX "patients_prenom_nom_idx" ON "patients"("prenom", "nom");

-- CreateIndex
CREATE INDEX "patients_telephone_idx" ON "patients"("telephone");

-- CreateIndex
CREATE INDEX "patients_createdAt_idx" ON "patients"("createdAt");

-- CreateIndex
CREATE INDEX "treatments_patientId_statut_idx" ON "treatments"("patientId", "statut");

-- CreateIndex
CREATE INDEX "treatments_patientId_dateDebut_idx" ON "treatments"("patientId", "dateDebut");

-- CreateIndex
CREATE INDEX "treatments_statut_idx" ON "treatments"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_visits_appointmentId_key" ON "treatment_visits"("appointmentId");

-- CreateIndex
CREATE INDEX "treatment_visits_treatmentId_dateDebut_idx" ON "treatment_visits"("treatmentId", "dateDebut");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_visits_treatmentId_numeroSeance_key" ON "treatment_visits"("treatmentId", "numeroSeance");

-- CreateIndex
CREATE INDEX "appointments_dateDebut_idx" ON "appointments"("dateDebut");

-- CreateIndex
CREATE INDEX "appointments_patientId_dateDebut_idx" ON "appointments"("patientId", "dateDebut");

-- CreateIndex
CREATE INDEX "appointments_statut_dateDebut_idx" ON "appointments"("statut", "dateDebut");

-- CreateIndex
CREATE INDEX "appointments_treatmentId_idx" ON "appointments"("treatmentId");

-- CreateIndex
CREATE INDEX "appointment_reschedules_appointmentId_createdAt_idx" ON "appointment_reschedules"("appointmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_sourceCorrectionId_key" ON "payments"("sourceCorrectionId");

-- CreateIndex
CREATE INDEX "payments_patientId_datePaiement_idx" ON "payments"("patientId", "datePaiement");

-- CreateIndex
CREATE INDEX "payments_treatmentId_statut_idx" ON "payments"("treatmentId", "statut");

-- CreateIndex
CREATE INDEX "payments_datePaiement_statut_idx" ON "payments"("datePaiement", "statut");

-- CreateIndex
CREATE INDEX "payments_statut_idx" ON "payments"("statut");

-- CreateIndex
CREATE INDEX "payment_corrections_paymentId_createdAt_idx" ON "payment_corrections"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "medical_records_patientId_date_idx" ON "medical_records"("patientId", "date");

-- CreateIndex
CREATE INDEX "prescriptions_patientId_date_idx" ON "prescriptions"("patientId", "date");

-- CreateIndex
CREATE INDEX "prescription_items_prescriptionId_position_idx" ON "prescription_items"("prescriptionId", "position");

-- CreateIndex
CREATE INDEX "odontogram_entries_patientId_numeroDent_date_idx" ON "odontogram_entries"("patientId", "numeroDent", "date");

-- CreateIndex
CREATE INDEX "documents_patientId_createdAt_idx" ON "documents"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "trash_entries_expireLe_idx" ON "trash_entries"("expireLe");

-- CreateIndex
CREATE INDEX "trash_entries_supprimeLe_idx" ON "trash_entries"("supprimeLe");

-- CreateIndex
CREATE INDEX "trash_entries_restaureLe_idx" ON "trash_entries"("restaureLe");

-- CreateIndex
CREATE UNIQUE INDEX "trash_entries_entityType_entityId_key" ON "trash_entries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_entityType_entityId_idx" ON "activity_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_visits" ADD CONSTRAINT "treatment_visits_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_visits" ADD CONSTRAINT "treatment_visits_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_praticienId_fkey" FOREIGN KEY ("praticienId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_modifieParId_fkey" FOREIGN KEY ("modifieParId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_treatmentVisitId_fkey" FOREIGN KEY ("treatmentVisitId") REFERENCES "treatment_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_corrections" ADD CONSTRAINT "payment_corrections_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_corrections" ADD CONSTRAINT "payment_corrections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odontogram_entries" ADD CONSTRAINT "odontogram_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odontogram_entries" ADD CONSTRAINT "odontogram_entries_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odontogram_entries" ADD CONSTRAINT "odontogram_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_supprimeParId_fkey" FOREIGN KEY ("supprimeParId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

