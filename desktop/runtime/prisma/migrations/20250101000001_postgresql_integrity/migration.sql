-- =============================================================================
--  SAHED DENTAL CLINIC — CONTRAINTES D'INTEGRITE PROPRES A POSTGRESQL
-- =============================================================================
--
--  !!! ATTENTION !!!
--
--  Ce fichier s'applique UNIQUEMENT a PostgreSQL (production).
--  Il est livre comme migration versionnee mais n'a PAS pu etre execute ni
--  verifie sur la machine de developpement, faute de PostgreSQL installe.
--  Voir docs/POSTGRESQL-VERIFICATION.md pour la procedure de verification.
--
--  Chaque instruction est idempotente autant que possible et commentee.
--  Elle ajoute une defense en profondeur que Prisma ne sait pas exprimer :
--    - contraintes CHECK sur les montants et les intervalles de dates
--    - index partiels sur les enregistrements actifs
--    - index trigram pour la recherche partielle de patients
--    - unicite insensible a la casse sur l'email
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. EXTENSIONS
-- -----------------------------------------------------------------------------

-- pg_trgm : accelere les recherches partielles (ILIKE '%...%') sur nom/prenom.
-- Indispensable pour rester performant avec des milliers de patients.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
--  2. CONTRAINTES CHECK — INTEGRITE FINANCIERE
-- -----------------------------------------------------------------------------
--  Le domaine interdit les etats financiers impossibles (§17).

-- Un paiement doit etre strictement positif.
-- Un montant nul ou negatif rendrait les totaux incoherents.
ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_montant_positif_check";
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_montant_positif_check"
  CHECK ("montantCentimes" > 0);

-- Un prix de traitement ne peut pas etre negatif (la valeur 0 reste permise :
-- un traitement peut etre offert ou non facture).
ALTER TABLE "treatments"
  DROP CONSTRAINT IF EXISTS "treatments_prix_non_negatif_check";
ALTER TABLE "treatments"
  ADD CONSTRAINT "treatments_prix_non_negatif_check"
  CHECK ("prixTotalCentimes" >= 0);

-- Un paiement ne peut pas etre date dans le futur au-dela d'une tolerance
-- raisonnable (saisie manuelle le soir pour le lendemain, fuseau horaire).
ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_date_plausible_check";
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_date_plausible_check"
  CHECK ("datePaiement" < (CURRENT_TIMESTAMP + INTERVAL '1 day'));

-- Contre-passation : le montant corrige ne peut pas etre negatif.
ALTER TABLE "payment_corrections"
  DROP CONSTRAINT IF EXISTS "payment_corrections_montants_check";
ALTER TABLE "payment_corrections"
  ADD CONSTRAINT "payment_corrections_montants_check"
  CHECK (
    "ancienMontantCentimes" > 0
    AND ("nouveauMontantCentimes" IS NULL OR "nouveauMontantCentimes" >= 0)
  );

-- -----------------------------------------------------------------------------
--  3. CONTRAINTES CHECK — COHERENCE DES INTERVALLES DE TEMPS
-- -----------------------------------------------------------------------------

-- Un rendez-vous doit se terminer apres son debut.
ALTER TABLE "appointments"
  DROP CONSTRAINT IF EXISTS "appointments_intervalle_check";
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_intervalle_check"
  CHECK ("dateFin" > "dateDebut");

-- Une reprogrammation doit egalement etre un intervalle valide.
ALTER TABLE "appointment_reschedules"
  DROP CONSTRAINT IF EXISTS "appointment_reschedules_intervalle_check";
ALTER TABLE "appointment_reschedules"
  ADD CONSTRAINT "appointment_reschedules_intervalle_check"
  CHECK (
    "ancienneDateFin" > "ancienneDateDebut"
    AND "nouvelleDateFin" > "nouvelleDateDebut"
  );

-- Une visite de traitement doit se terminer apres son debut, si elle est bornee.
ALTER TABLE "treatment_visits"
  DROP CONSTRAINT IF EXISTS "treatment_visits_intervalle_check";
ALTER TABLE "treatment_visits"
  ADD CONSTRAINT "treatment_visits_intervalle_check"
  CHECK ("dateFin" IS NULL OR "dateFin" > "dateDebut");

-- Un traitement ne peut pas se terminer avant d'avoir commence.
ALTER TABLE "treatments"
  DROP CONSTRAINT IF EXISTS "treatments_dates_check";
ALTER TABLE "treatments"
  ADD CONSTRAINT "treatments_dates_check"
  CHECK ("dateFin" IS NULL OR "dateDebut" IS NULL OR "dateFin" >= "dateDebut");

-- -----------------------------------------------------------------------------
--  4. CONTRAINTES CHECK — CORBEILLE : EXACTEMENT 24 HEURES (§23)
-- -----------------------------------------------------------------------------
--  Defense au niveau base : meme une insertion manuelle erronee ne peut pas
--  creer une fenetre de restauration differente de 24 heures.

ALTER TABLE "trash_entries"
  DROP CONSTRAINT IF EXISTS "trash_entries_fenetre_24h_check";
ALTER TABLE "trash_entries"
  ADD CONSTRAINT "trash_entries_fenetre_24h_check"
  CHECK ("expireLe" = "supprimeLe" + INTERVAL '24 hours');

-- Une entree restauree doit porter une date de restauration.
ALTER TABLE "trash_entries"
  DROP CONSTRAINT IF EXISTS "trash_entries_restauration_coherente_check";
ALTER TABLE "trash_entries"
  ADD CONSTRAINT "trash_entries_restauration_coherente_check"
  CHECK ("restaureLe" IS NULL OR "restaureLe" >= "supprimeLe");

-- -----------------------------------------------------------------------------
--  5. CONTRAINTES CHECK — DONNEES PATIENTS ET MEDICALES
-- -----------------------------------------------------------------------------

-- Nom et prenom ne peuvent pas etre vides (une chaine de longueur nulle
-- produirait des fiches inidentifiables).
ALTER TABLE "patients"
  DROP CONSTRAINT IF EXISTS "patients_identite_non_vide_check";
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_identite_non_vide_check"
  CHECK (length(btrim("nom")) > 0 AND length(btrim("prenom")) > 0);

-- Le telephone principal est le seul moyen de recherche fiable avec le nom :
-- il ne peut pas etre vide.
ALTER TABLE "patients"
  DROP CONSTRAINT IF EXISTS "patients_telephone_non_vide_check";
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_telephone_non_vide_check"
  CHECK (length(btrim("telephone")) > 0);

-- Numero de dent FDI : exactement deux chiffres.
ALTER TABLE "odontogram_entries"
  DROP CONSTRAINT IF EXISTS "odontogram_numero_dent_fdi_check";
ALTER TABLE "odontogram_entries"
  ADD CONSTRAINT "odontogram_numero_dent_fdi_check"
  CHECK ("numeroDent" ~ '^[1-8][1-8]$');

-- Numero de seance strictement positif.
ALTER TABLE "treatment_visits"
  DROP CONSTRAINT IF EXISTS "treatment_visits_numero_seance_check";
ALTER TABLE "treatment_visits"
  ADD CONSTRAINT "treatment_visits_numero_seance_check"
  CHECK ("numeroSeance" > 0);

-- Taille de document strictement positive.
ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_taille_positive_check";
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_taille_positive_check"
  CHECK ("tailleOctets" > 0);

-- Empreinte : un SHA-256 hexadecimal fait exactement 64 caracteres.
ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_checksum_format_check";
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_checksum_format_check"
  CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

-- -----------------------------------------------------------------------------
--  6. UNICITE INSENSIBLE A LA CASSE
-- -----------------------------------------------------------------------------
--  « Dr.Sahed@Clinic.dz » et « dr.sahed@clinic.dz » sont le meme compte.
--  Sans cette contrainte, un doublon de compte serait possible.

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_key"
  ON "users" (lower("email"));

-- -----------------------------------------------------------------------------
--  7. INDEX PARTIELS — PERFORMANCE SUR LES ENREGISTREMENTS ACTIFS
-- -----------------------------------------------------------------------------
--  Ces index sont plus petits et plus rapides que des index complets, car ils
--  ignorent les lignes historiques ou annulees, majoritaires apres quelques
--  annees d'utilisation.

-- Sessions non revoquees : seule population interrogee a chaque requete.
CREATE INDEX IF NOT EXISTS "sessions_actives_idx"
  ON "sessions" ("userId", "expiresAt")
  WHERE "revokedAt" IS NULL;

-- Paiements valides : base de TOUS les totaux financiers (§16, §18).
CREATE INDEX IF NOT EXISTS "payments_valides_par_date_idx"
  ON "payments" ("datePaiement")
  WHERE "statut" = 'VALIDE';

CREATE INDEX IF NOT EXISTS "payments_valides_par_traitement_idx"
  ON "payments" ("treatmentId")
  WHERE "statut" = 'VALIDE';

-- Rendez-vous actifs : le planning ne montre jamais les rendez-vous annules.
CREATE INDEX IF NOT EXISTS "appointments_actifs_idx"
  ON "appointments" ("dateDebut")
  WHERE "statut" NOT IN ('ANNULE');

-- Entrees de corbeille en attente de decision : cible du balayage periodique.
CREATE INDEX IF NOT EXISTS "trash_entries_en_attente_idx"
  ON "trash_entries" ("expireLe")
  WHERE "restaureLe" IS NULL AND "supprimeDefinitivementLe" IS NULL;

-- Traitements en cours / planifies : alimente le tableau de bord.
CREATE INDEX IF NOT EXISTS "treatments_actifs_idx"
  ON "treatments" ("patientId", "statut")
  WHERE "statut" IN ('PLANIFIE', 'EN_COURS');

-- Etat courant d'une dent : l'odontogramme lit la derniere entree par dent.
CREATE INDEX IF NOT EXISTS "odontogram_courant_idx"
  ON "odontogram_entries" ("patientId", "numeroDent", "date" DESC);

-- Jetons de reinitialisation non utilises.
CREATE INDEX IF NOT EXISTS "password_reset_actifs_idx"
  ON "password_reset_tokens" ("tokenHash", "expiresAt")
  WHERE "usedAt" IS NULL;

-- -----------------------------------------------------------------------------
--  8. INDEX DE RECHERCHE PATIENTS (trigram)
-- -----------------------------------------------------------------------------
--  La recherche patient (§7) doit rester rapide sur plusieurs milliers de
--  fiches, y compris sur une recherche partielle (« ahme » -> « Ahmed »).
--  Un index B-tree classique ne sert a rien pour '%...%' : pg_trgm est requis.

CREATE INDEX IF NOT EXISTS "patients_nom_trgm_idx"
  ON "patients" USING gin ("nom" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_prenom_trgm_idx"
  ON "patients" USING gin ("prenom" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_telephone_trgm_idx"
  ON "patients" USING gin ("telephone" gin_trgm_ops);

-- -----------------------------------------------------------------------------
--  9. INDEX DE RECHERCHE — TRAITEMENTS, PAIEMENTS, JOURNAL
-- -----------------------------------------------------------------------------

-- Recherche de traitement par dent (§26) : les dents sont stockees en JSON.
-- L'index GIN sur jsonb permet `dents @> '["36"]'`.
-- La colonne reste TEXT cote Prisma ; l'index est construit sur la conversion.
CREATE INDEX IF NOT EXISTS "treatments_dents_gin_idx"
  ON "treatments" USING gin (("dents"::jsonb));

-- Journal d'activite : la consultation la plus frequente est chronologique.
CREATE INDEX IF NOT EXISTS "activity_logs_recent_idx"
  ON "activity_logs" ("createdAt" DESC);

-- -----------------------------------------------------------------------------
--  10. FONCTION DE VERIFICATION D'INTEGRITE FINANCIERE
-- -----------------------------------------------------------------------------
--  Vrai/si un traitement depasse son prix total.
--  Utilisee par les controles d'exploitation et les tests de non-regression.
--
--  IMPORTANT : c'est une FONCTION DE VERIFICATION, pas un trigger bloquant.
--  L'application refuse deja tout depassement cote service (Phase 5) ; cette
--  fonction permet de le PROUVER sur une base reelle.

CREATE OR REPLACE FUNCTION sahed_traitements_en_depassement()
RETURNS TABLE (
  treatment_id UUID,
  patient_id   UUID,
  prix_total   INTEGER,
  total_paye   BIGINT,
  depassement  BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t."id",
    t."patientId",
    t."prixTotalCentimes",
    COALESCE(SUM(p."montantCentimes") FILTER (WHERE p."statut" = 'VALIDE'), 0) AS total_paye,
    COALESCE(SUM(p."montantCentimes") FILTER (WHERE p."statut" = 'VALIDE'), 0)
      - t."prixTotalCentimes" AS depassement
  FROM "treatments" t
  LEFT JOIN "payments" p ON p."treatmentId" = t."id"
  GROUP BY t."id", t."patientId", t."prixTotalCentimes"
  HAVING COALESCE(SUM(p."montantCentimes") FILTER (WHERE p."statut" = 'VALIDE'), 0)
         > t."prixTotalCentimes";
$$;

COMMENT ON FUNCTION sahed_traitements_en_depassement() IS
  'Liste les traitements dont la somme des paiements valides depasse le prix total. '
  'Doit toujours retourner 0 ligne en exploitation normale.';

-- -----------------------------------------------------------------------------
--  11. FONCTION DE VERIFICATION DES SOLDE PATIENTS
-- -----------------------------------------------------------------------------
--  Reproduit exactement le calcul attendu par la specification (§12, §44) :
--    Total traitements = somme des prix totaux
--    Total paye        = somme des paiements VALIDE
--    Reste a payer     = total traitements - total paye
--  Aucune de ces valeurs n'est stockee en base : elles sont toujours calculees.

CREATE OR REPLACE FUNCTION sahed_solde_patient(p_patient_id UUID)
RETURNS TABLE (
  total_traitements INTEGER,
  total_paye        BIGINT,
  reste_a_payer     BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH traitements AS (
    SELECT COALESCE(SUM("prixTotalCentimes"), 0)::INTEGER AS total
    FROM "treatments"
    WHERE "patientId" = p_patient_id
      AND "statut" <> 'ANNULE'
  ),
  paiements AS (
    SELECT COALESCE(SUM("montantCentimes"), 0)::BIGINT AS total
    FROM "payments"
    WHERE "patientId" = p_patient_id
      AND "statut" = 'VALIDE'
  )
  SELECT
    traitements.total,
    paiements.total,
    (traitements.total::BIGINT - paiements.total) AS reste
  FROM traitements, paiements;
$$;

COMMENT ON FUNCTION sahed_solde_patient(UUID) IS
  'Solde d''un patient : total traitements, total paye, reste a payer. '
  'Le reste a payer est toujours calcule, jamais stocke.';

-- =============================================================================
--  FIN DU FICHIER
--
--  Rappel : ces instructions n'ont PAS ete verifiees sur la machine de
--  developpement (PostgreSQL non installe). Elles doivent etre appliquees et
--  testees sur une instance PostgreSQL reelle avant mise en production.
--  Procedure : docs/POSTGRESQL-VERIFICATION.md
-- =============================================================================
