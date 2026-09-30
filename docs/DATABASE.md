# Base de donnees — SAHED DENTAL CLINIC

## 1. Source de verite

**PostgreSQL est la source de verite en production.** Le schema Prisma
(`database/prisma/schema.prisma`) est concu pour PostgreSQL d'abord : types
`UUID`, enums natifs, contraintes `CHECK`, index partiels, extension
`pg_trgm`.

> **Note d'architecture.** Une variante SQLite locale existait pour executer
> l'application sur une machine depourvue de PostgreSQL. Elle a ete **retiree** :
> SQLite ne supporte ni les enums natifs ni la recherche insensible a la casse
> (`mode: 'insensitive'`), ce qui faisait diverger le comportement observe du
> comportement de production. Le systeme cible desormais PostgreSQL uniquement,
> ce qui garantit que ce qui est verifie est ce qui sera execute.

---

## 2. Migrations

Les migrations sont versionnees dans `database/prisma/migrations/` et **ecrites
pour PostgreSQL**.

| Migration | Contenu |
|---|---|
| `20250101000000_initial_schema` | Tables, enums, index, cles etrangeres |
| `20250101000001_postgresql_integrity` | Contraintes `CHECK`, index partiels, trigram, fonctions de verification |

```bash
npm run db:migrate:dev      # creer une migration (developpement)
npm run db:migrate:deploy   # appliquer les migrations (production)
```

**Regles imperatives :**

1. Ne modifiez **jamais** une migration deja appliquee : creez-en une nouvelle.
2. Une migration doit etre **reproductible** et testee avant la production.
3. Une suppression de colonne contenant des donnees medicales ou financieres se
   fait en **deux temps** (nouvelle colonne, migration des donnees, suppression).

---

## 3. Contraintes d'integrite (PostgreSQL)

La deuxieme migration ajoute des garanties que Prisma ne peut pas exprimer.

### Integrite financiere (§17)

| Contrainte | Effet |
|---|---|
| `payments_montant_positif_check` | Un paiement est strictement positif |
| `treatments_prix_non_negatif_check` | Un prix de traitement n'est jamais negatif |
| `payments_date_plausible_check` | Un paiement ne peut pas etre date loin dans le futur |
| `payment_corrections_montants_check` | Montants de correction coherents |

### Coherence temporelle

| Contrainte | Effet |
|---|---|
| `appointments_intervalle_check` | Un rendez-vous se termine apres son debut |
| `appointment_reschedules_intervalle_check` | Idem pour une reprogrammation |
| `treatment_visits_intervalle_check` | Une visite se termine apres son debut |
| `treatments_dates_check` | Un traitement ne se termine pas avant de commencer |

### Corbeille — 24 heures exactes (§23)

| Contrainte | Effet |
|---|---|
| `trash_entries_fenetre_24h_check` | **`expireLe = supprimeLe + INTERVAL '24 hours'`** : la fenetre ne peut pas etre autre chose que 24 heures, meme par insertion directe |
| `trash_entries_restauration_coherente_check` | Une restauration est posterieure a la suppression |

### Donnees patients et medicales

| Contrainte | Effet |
|---|---|
| `patients_identite_non_vide_check` | Nom et prenom ne sont pas vides |
| `patients_telephone_non_vide_check` | Le telephone n'est pas vide |
| `odontogram_numero_dent_fdi_check` | Numero de dent FDI a deux chiffres |
| `treatment_visits_numero_seance_check` | Numero de seance positif |
| `documents_taille_positive_check` | Taille de document positive |
| `documents_checksum_format_check` | Empreinte SHA-256 au bon format |

### Unicite insensible a la casse

`users_email_lower_key` : `Dr.Sahed@Clinic.dz` et `dr.sahed@clinic.dz` sont le
meme compte.

### Index partiels (performance)

- `sessions_actives_idx` — sessions non revoquees (population interrogee a
  chaque requete).
- `payments_valides_par_date_idx`, `payments_valides_par_traitement_idx` — base
  de **tous** les totaux financiers.
- `appointments_actifs_idx` — le planning ne montre jamais les rendez-vous
  annules.
- `trash_entries_en_attente_idx` — cible du balayage periodique.
- `treatments_actifs_idx` — alimente le tableau de bord.
- `odontogram_courant_idx` — etat courant d'une dent.

### Recherche patient (trigram)

`patients_nom_trgm_idx`, `patients_prenom_trgm_idx`,
`patients_telephone_trgm_idx` : un index B-tree classique ne sert a rien pour
une recherche partielle (`ahme` → `Ahmed`). `pg_trgm` est requis. La recherche
reste rapide sur plusieurs milliers de fiches (§7, §26).

### Fonctions de verification

| Fonction | Role |
|---|---|
| `sahed_traitements_en_depassement()` | Liste les traitements dont les paiements depassent le prix. **Doit toujours retourner 0 ligne.** |
| `sahed_solde_patient(uuid)` | Reproduit le calcul du solde : total traitements, total paye, reste a payer. |

Ces fonctions **prouvent** l'integrite sur une base reelle. Elles ne sont pas la
seule defense : l'application refuse deja tout depassement cote service.

---

## 4. Regles metier exprimees dans le schema

### aucun identifiant patient n'est expose (§48)

L'identifiant interne (`patients.id`) est un UUID technique. Il sert aux cles
etrangeres et aux URL d'API, mais **n'est jamais affiche comme « numero de
patient »**. Le medecin identifie un patient par nom, prenom et telephone.

### « Reste a payer » n'est jamais stocke (§12)

```sql
-- Ce calcul n'est pas une colonne : il est fait a la lecture.
reste_a_payer = prixTotalCentimes - somme(montantCentimes WHERE statut = 'VALIDE')
```

Stocker ce montant creerait une seconde source de verite, qui divergerait
inévitablement des paiements reels.

### Hierarchie Patient → Traitements → Visites → Paiements (§8)

```
Patient 1 ──< n Treatment 1 ──< n TreatmentVisit 1 ──< n Payment
```

Un patient a un nombre illimite de traitements historiques. Un traitement
comporte plusieurs visites. Chaque visite peut porter plusieurs paiements.

### Idempotence des paiements (§17)

`payments.idempotencyKey` est **unique en base** : la meme cle ne cree jamais
deux paiements, meme en cas de double soumission du formulaire.

### Historique jamais ecrase (§11)

| Donnee | Mecanisme |
|---|---|
| Paiement corrige | Statut `ANNULE` + ligne `payment_corrections` (anciennes **et** nouvelles valeurs) |
| Rendez-vous reprogramme | Ligne `appointment_reschedules` (ancien et nouveau creneau) |
| Dossier medical | Une entree par consultation |
| Odontogramme | Une entree par changement d'etat |
| Suppression | Entree `trash_entries` (24 h), puis suppression definitive auditee |

---

## 5. Verification des contraintes PostgreSQL

Les contraintes de la deuxieme migration sont ecrites pour PostgreSQL. Comme
la machine de developpement utilisee n'a pas de PostgreSQL, elles **doivent
etre appliquees et verifiees sur une instance reelle avant la mise en
production**. Procedure :

```bash
# 1. Base de verification
createdb sahed_verification

# 2. Appliquer les migrations
DATABASE_URL="postgresql://.../sahed_verification" npm run db:migrate:deploy

# 3. Verifier que les contraintes existent
psql sahed_verification -c "SELECT conname FROM pg_constraint WHERE conname LIKE 'trash_entries_%'"
psql sahed_verification -c "SELECT conname FROM pg_constraint WHERE conname LIKE 'payments_%'"

# 4. Verifier l'extension trigram
psql sahed_verification -c "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'"

# 5. Verifier les fonctions
psql sahed_verification -c "SELECT * FROM sahed_traitements_en_depassement()"
```

L'etape 5 doit retourner **zero ligne** : aucune donnee ne doit etre incoherente.

---

## 6. Entretien

| Tache | Commande | Frequence |
|---|---|---|
| Purge de la Corbeille | `npm run corbeille:purger` | toutes les heures |
| Sauvegarde | `npm run backup:postgres` | quotidienne |
| Verification d'integrite | `SELECT * FROM sahed_traitements_en_depassement()` | mensuelle |

La purge des sessions expirees est exposee par
`purgeExpiredSessions()` (`backend/auth/session.ts`) pour un script
d'entretien ulterieur ; les sessions ne croissent pas indefiniment.

---

## 7. Dimensionnement

Le systeme est concu pour rester utilisable apres des annees d'exploitation :

- Des **milliers de patients** : recherche trigram indexee, pagination serveur.
- Des **dizaines de milliers de rendez-vous** : index sur `dateDebut` et index
  partiel sur les rendez-vous actifs.
- De **nombreux paiements** : agregations en base, index partiels sur les
  paiements valides.
- Un **journal volumineux** : index chronologique, pagination serveur.
- De **nombreux documents** : stockage fichier, metadonnees en base.

Le partitionnement, les vues materialisees et la mise en cache ne sont pas
introduits : ils ne deviendraient utiles qu'a une echelle non atteinte par un
cabinet unique (§58). Leur introduction eventuelle est listee dans
`docs/ARCHITECTURE.md`.