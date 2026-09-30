# Verification des contraintes PostgreSQL

Ce document explique comment **appliquer et verifier** les contraintes
d'integrite PostgreSQL sur une instance reelle.

## Pourquoi ce document existe

La migration `20250101000001_postgresql_integrity` contient des instructions
propres a PostgreSQL (contraintes `CHECK`, index partiels, extension `pg_trgm`,
fonctions SQL). La machine de developpement utilisee pour construire ce projet
**ne disposait pas de PostgreSQL** : ces instructions n'ont donc **pas ete
executees** sur une instance reelle.

Elles sont **ecrites, versionnees et documentees**, mais **non verifiees en
execution**. La procedure ci-dessous permet de les verifier avant toute mise en
production.

> **Regle** : tant que cette procedure n'a pas ete executee avec succes sur une
> instance PostgreSQL reelle, les contraintes de la section 3 ne doivent pas
> etre considerees comme prouvees.

---

## Procedure de verification

### 1. Creer une base de verification

```bash
createdb sahed_verification
export DATABASE_URL="postgresql://user:pass@localhost:5432/sahed_verification"
```

### 2. Appliquer les migrations

```bash
npm run db:migrate:deploy
```

La migration des contraintes doit s'appliquer **sans erreur**. Un echec signale
une incompatibilite de version PostgreSQL (l'extension `pg_trgm` doit etre
disponible).

### 3. Verifier l'extension trigram

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';
```

Doit retourner une ligne. Sans elle, la recherche patient sur des milliers de
fiches perdrait son index.

### 4. Verifier les contraintes CHECK

```sql
-- Corbeille : fenetre EXACTEMENT 24 heures
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'trash_entries_fenetre_24h_check';
```

Doit afficher `CHECK ("expireLe" = ("supprimeLe" + '24:00:00'::interval))`.

```sql
-- Integrite financiere
SELECT conname FROM pg_constraint
WHERE conname IN (
  'payments_montant_positif_check',
  'treatments_prix_non_negatif_check',
  'payments_date_plausible_check',
  'payment_corrections_montants_check'
);
```

Doit retourner **4 lignes**.

```sql
-- Coherence temporelle
SELECT conname FROM pg_constraint
WHERE conname IN (
  'appointments_intervalle_check',
  'appointment_reschedules_intervalle_check',
  'treatment_visits_intervalle_check',
  'treatments_dates_check'
);
```

Doit retourner **4 lignes**.

```sql
-- Donnees patients et medicales
SELECT conname FROM pg_constraint
WHERE conname IN (
  'patients_identite_non_vide_check',
  'patients_telephone_non_vide_check',
  'odontogram_numero_dent_fdi_check',
  'treatment_visits_numero_seance_check',
  'documents_taille_positive_check',
  'documents_checksum_format_check'
);
```

Doit retourner **6 lignes**.

### 5. Verifier les index partiels

```sql
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'sessions_actives_idx',
  'payments_valides_par_date_idx',
  'payments_valides_par_traitement_idx',
  'appointments_actifs_idx',
  'trash_entries_en_attente_idx',
  'treatments_actifs_idx',
  'odontogram_courant_idx',
  'password_reset_actifs_idx'
);
```

Doit retourner **8 lignes**.

```sql
SELECT indexname FROM pg_indexes
WHERE indexname LIKE 'patients_%_trgm_idx';
```

Doit retourner **3 lignes**.

### 6. Verifier les fonctions

```sql
-- Doit retourner ZERO ligne en exploitation normale.
SELECT * FROM sahed_traitements_en_depassement();

-- Doit retourner exactement une ligne avec trois colonnes.
SELECT * FROM sahed_solde_patient('00000000-0000-0000-0000-000000000000');
```

### 7. Tester les contraintes en les violant (base de verification uniquement)

Ces tests prouvent que les contraintes **bloquent** reellement.

```sql
-- Doit ECHOUER : fenetre de corbeille differente de 24 h
INSERT INTO trash_entries (id, "entityType", "entityId", description, snapshot, "supprimeLe", "expireLe")
VALUES (gen_random_uuid(), 'PATIENT', gen_random_uuid(), 'test', '{}',
        NOW(), NOW() + INTERVAL '30 days');
-- Attendu : ERROR ... violates check constraint "trash_entries_fenetre_24h_check"

-- Doit ECHOUER : paiement de montant nul
INSERT INTO payments (id, "patientId", "treatmentId", "montantCentimes", "datePaiement",
                      methode, "idempotencyKey", "createdById")
VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 0, NOW(),
        'ESPECES', 'test-key-nul', gen_random_uuid());
-- Attendu : ERROR ... violates check constraint "payments_montant_positif_check"
```

Ces deux `INSERT` doivent etre **refuses par la base**, independamment de
l'application. C'est la defense en profondeur : meme une intervention manuelle
directe ne peut pas creer un etat impossible.

### 8. Nettoyer

```bash
dropdb sahed_verification
```

---

## Liste de controle

| Verification | Attendu | Fait |
|---|---|---|
| Migrations appliquees sans erreur | ok | [ ] |
| Extension `pg_trgm` presente | 1 ligne | [ ] |
| Contrainte fenetre 24 h | exacte | [ ] |
| Contraintes financieres | 4 | [ ] |
| Contraintes temporelles | 4 | [ ] |
| Contraintes patients/medical | 6 | [ ] |
| Index partiels | 8 | [ ] |
| Index trigram patients | 3 | [ ] |
| Fonction depassements | 0 ligne | [ ] |
| Violation fenetre 24 h refusee | erreur | [ ] |
| Violation montant nul refuse | erreur | [ ] |

---

## Si une contrainte manque

1. Verifiez que la migration `20250101000001_postgresql_integrity` a bien ete
   appliquee : `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at;`
2. Si elle n'apparait pas, appliquez-la : `npm run db:migrate:deploy`.
3. Si elle apparait mais que la contrainte manque, le contenu de la migration a
   pu etre modifie : **ne modifiez jamais une migration deja appliquee**,
   creez-en une nouvelle qui ajoute la contrainte manquante.