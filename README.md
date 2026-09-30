# SAHED DENTAL CLINIC — Systeme de gestion de cabinet dentaire

Application de gestion pour cabinet dentaire prive : **tableau de bord prive
reserve au medecin** et **site web public de presentation**.

L'interface est **integralement en francais**. Il n'existe aucun selecteur de
langue : le francais est la seule langue de l'application.

---

## 1. Perimetre fonctionnel

### Site public (visible par tout le monde)

Presentation du cabinet : accueil, a propos, services/soins, cabinet, horaires,
contact.

Le site public **ne contient ni** connexion patient, **ni** tableau de bord
patient, **ni** prise de rendez-vous en ligne, **ni** donnee medicale ou
financiere. Les rendez-vous sont crees **manuellement par le medecin**.

### Tableau de bord prive (medecin uniquement)

| Module | Fonction |
|---|---|
| Tableau de bord | Indicateurs du jour, revenus, prochains rendez-vous, graphique mensuel |
| Patients | Fiche complete, recherche par nom / prenom / telephone |
| Rendez-vous | Planning jour / semaine / mois, conflits, reprogrammation historisee |
| Traitements | Traitements multiples par patient, visites (seances), dents FDI |
| Paiements | Enregistrement, soldes calcules, correction par contre-passation |
| Dossiers medicaux | Entrees historiques datees (jamais un champ unique ecrasable) |
| Ordonnances | Numeriques uniquement |
| Odontogramme | Chart FDI, historique par dent |
| Documents | Stockage prive, acces authentifie |
| Rapports | Revenus, traitements, rendez-vous, soldes patients |
| Journal d'activite | Traçabilite des actions |
| Corbeille | Restauration pendant **exactement 24 heures** |
| Parametres | Informations cabinet et medecin |

### Ce qui n'existe volontairement PAS

- **Aucun PDF** (ordonnances, recus, rapports) — l'application est numerique.
- **Aucune prise de rendez-vous en ligne**.
- **Aucun portail patient**, aucune inscription patient.
- **Aucun identifiant patient visible** : le medecin identifie un patient par
  nom, prenom et telephone.

---

## 2. Pile technique

| Couche | Technologie | Justification |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript strict | Rendu serveur + client, routes API integrees |
| Styles | CSS avec jetons de design (aucun framework CSS) | Controle total du rendu medical, aucun bundle inutile |
| Graphiques | Recharts | Un seul graphique (revenus mensuels) |
| Backend | Routes API Next.js + services TypeScript modulaires | Un seul deploiement, code partage, typage de bout en bout |
| Base de donnees | **PostgreSQL** (production) | Integrite relationnelle, contraintes CHECK, trigram |
| ORM | Prisma 6 + migrations versionnees | Migrations reproductibles, requetes parametrees |
| Authentification | Argon2id + sessions serveur en base | Voir §6 de cet apercu |
| Tests | Vitest | Rapide, sans configuration lourde |

Voir `docs/ARCHITECTURE.md` pour le detail et la classification
**REQUIRED FOR V1** / **FUTURE SCALABILITY OPTION**.

---

## 3. Demarrage rapide

### Prerequis

- Node.js >= 20.11
- PostgreSQL >= 14 (pour la production et les tests d'integration)

### Installation

```bash
# 1. Dependances
npm install

# 2. Configuration
copy .env.example .env      # Windows
# cp .env.example .env      # Linux / macOS
# Puis renseigner les valeurs dans .env (voir section 4)

# 3. Schema de base de donnees
npm run db:migrate:deploy   # applique les migrations versionnees
npm run db:generate         # genere le client Prisma

# 4. Compte medecin initial (UNE FOIS)
npm run db:seed

# 5. Demarrage
npm run dev                 # http://localhost:3000
```

Le tableau de bord est sur `/tableau-de-bord`, la connexion sur `/connexion`,
le site public sur `/`.

### Verifications

```bash
npm run typecheck   # TypeScript strict
npm run lint        # ESLint (zero avertissement tolere)
npm run format:check
npm run test        # Tests Vitest
npm run build       # Build de production
```

---

## 4. Variables d'environnement

Toutes les variables sont documentees dans `.env.example`. **Aucun secret
n'est present dans le code source.**

| Variable | Obligatoire | Role |
|---|---|---|
| `DATABASE_URL` | Oui | Chaine de connexion PostgreSQL |
| `DATABASE_PROVIDER` | Oui | Toujours `postgresql` en production |
| `SESSION_SECRET` | Oui (prod) | Signature des jetons internes, 32 caracteres minimum |
| `PASSWORD_PEPPER` | Recommande | Poivre applicatif Argon2id |
| `APP_URL` | Oui | URL publique (HTTPS en production) |
| `COOKIE_SECURE` | Oui | `true` en production (HTTPS) |
| `COOKIE_DOMAIN` | Non | Domaine des cookies |
| `DOCUMENTS_STORAGE_PATH` | Oui | Repertoire PRIVE des documents, hors racine web |
| `DOCUMENTS_MAX_BYTES` | Non | Taille maximale d'un document (defaut 20 Mo) |
| `LOG_LEVEL` | Non | `debug` / `info` / `warn` / `error` |
| `DOCTOR_EMAIL` | Seed | Email du medecin |
| `DOCTOR_NAME` | Seed | Nom affiche du medecin |
| `DOCTOR_INITIAL_PASSWORD` | Seed | Mot de passe initial (12 caracteres min) |
| `BACKUP_DIR` | Sauvegarde | Repertoire des sauvegardes |
| `BACKUP_RETENTION_JOURS` | Sauvegarde | Duree de conservation (defaut 30) |

Generer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 5. Commandes de base de donnees

```bash
npm run db:migrate:dev      # cree une migration (developpement)
npm run db:migrate:deploy   # applique les migrations (production)
npm run db:generate         # regenere le client Prisma
npm run db:seed             # cree / met a jour le compte medecin
npm run db:reset            # REMET LA BASE A ZERO (destructif)
npm run corbeille:purger    # purge des elements expires (a planifier toutes les heures)
```

> Les migrations de `database/prisma/migrations` sont ecrites pour PostgreSQL.
> Ne modifiez jamais une migration deja appliquee : creez-en une nouvelle.

---

## 6. Sauvegardes

```bash
npm run backup:postgres     # dump PostgreSQL compresse et verifie
```

La strategie complete (chiffrement, hors site, retention, restauration,
test de restauration) est decrite dans **`docs/BACKUP.md`**.

**Aucune sauvegarde automatique n'est configuree par defaut** : elle doit etre
mise en place au deploiement, conformement a `docs/BACKUP.md`.

---

## 7. Structure du projet

```
backend/            Logique metier (framework-agnostique)
  auth/             Hachage, sessions, autorisation, anti-force brute
  config/           Validation de l'environnement
  database/         Client Prisma
  domain/           Constantes et regles du domaine (finance, FDI)
  errors/           Erreurs applicatives francaises
  http/             Enveloppe des routes, pagination
  logging/          Journalisation structuree avec anonymisation
  security/         Politique de securite du contenu (CSP)
  services/         Services par domaine (patients, paiements, corbeille...)
  validation/       Schemas de validation Zod

content/            Textes francais centralises (fr.json)

database/           Schema Prisma, migrations, scripts (seed, purge, sauvegarde)
  prisma/schema.prisma
  prisma/migrations/    Migrations versionnees (PostgreSQL)
  scripts/              Outillage d'exploitation

src/                Application Next.js
  app/(public)/       Site public
  app/(auth)/         Connexion
  app/(dashboard)/    Tableau de bord prive
  app/api/            Routes REST
  components/         Composants reutilisables par domaine
  lib/                Client API, crochets
  middleware.ts       Securite et protection des routes

tests/              Tests automatises
docs/               Documentation
```

---

## 8. Documentation detaillee

| Document | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | Architecture, modele de donnees, API, classification V1 / futur |
| `docs/SECURITY.md` | Modele de securite et d'authentification |
| `docs/DATABASE.md` | Schema, migrations, integrite |
| `docs/BACKUP.md` | Strategie de sauvegarde et de restauration |
| `docs/DEPLOYMENT.md` | Deploiement en production |
| `docs/TESTS.md` | Couverture des tests |
| `docs/POSTGRESQL-VERIFICATION.md` | Verification des contraintes PostgreSQL |

---

## 9. Limites connues

Voir la section « Limites connues » de `docs/ARCHITECTURE.md`. En resume :
un seul role actif (medecin), aucune reprise de donnees externe automatisee,
analytique avancee reportee a une evolution ulterieure.

---

## 10. Rappel important

Cette application traite des **donnees de sante**. Sa mise en production doit
respecter la reglementation applicable dans la juridiction d'exploitation
(consentement, duree de conservation, declaration, hebergement des donnees).
L'architecture fournit l'accessibilite maitrisee, la traçabilite, le stockage
securise et la sauvegarde ; elle **ne constitue pas** une attestation de
conformite.
