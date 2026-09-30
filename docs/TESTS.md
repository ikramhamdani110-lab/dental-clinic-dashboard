# Tests — SAHED DENTAL CLINIC

## 1. Comment lancer les tests

```bash
npm run test           # execution unique
npm run test:watch     # en continu
```

Verifications completes :

```bash
npm run typecheck      # TypeScript strict
npm run lint           # ESLint (zero avertissement tolere)
npm run format:check   # Prettier
npm run test           # Vitest
npm run build          # Build de production
```

---

## 2. Etat reel des tests dans cet environnement

| Suite | Fichier | S'execute ici ? | Resultat |
|---|---|---|---|
| Calculs financiers | `tests/business/finance.test.ts` | **Oui** | ✅ |
| Corbeille 24 h | `tests/business/corbeille.test.ts` | **Oui** | ✅ |
| Corbeille paginee | `tests/business/corbeille-pagination.test.ts` | **Oui** | ✅ |
| Securite et validation | `tests/business/securite.test.ts` | **Oui** | ✅ |
| Isolation des erreurs | `tests/business/isolation-erreurs.test.ts` | **Oui** | ✅ |
| Configuration production | `tests/business/config-production.test.ts` | **Oui** | ✅ |
| Rapports (structure) | `tests/business/rapports-pagination.test.ts` | **Oui** | ✅ |
| **Rapports (PostgreSQL reel)** | `tests/integration/rapports-postgres.test.ts` | Avec `TEST_DATABASE_URL` | ✅ |
| **Odontogramme (PostgreSQL reel)** | `tests/integration/odontogramme-postgres.test.ts` | Avec `TEST_DATABASE_URL` | ✅ |

**Resultat mesure : 125 tests, 125 reussis, 0 echec** (9 fichiers), avec une
instance PostgreSQL 16 reelle pour les suites d'integration.

### Tests d'integration — PostgreSQL 16 reel

Les suites `tests/integration/*.test.ts` executent les VRAIES requetes SQL contre
une instance PostgreSQL 16 reelle, sur le schema produit par les migrations.
Elles ne sont **jamais simulees** : sans `TEST_DATABASE_URL`, elles sont
marquees IGNOREES (`describe.skipIf`), pas « passees ».

```bash
# Base JETABLE, jamais celle du cabinet
createdb sahed_integration_test
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/sahed_integration_test" \
  DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate:deploy
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/sahed_integration_test" npm run test
```

Ces suites ont permis de detecter et de corriger des defauts REELS invisibles au
mock : borne de date dependante de la timezone dans `revenusParMois`, et deux
cassures de l'odontogramme (`Prisma.join([])` et comparaison `uuid NOT IN text`).

---

## 2 bis. Scripts de verification de bout en bout

Ces scripts s'executent contre une application REELLE (`next start`) et une base
JETABLE peuplee. Ils ne fabriquent aucun chiffre.

| Script | Role |
|---|---|
| `database/scripts/seed-charge-test.mjs` | Peuple une base jetable (100 patients, 1000 RDV, 500 traitements, 2000 paiements + visites, annules, multi-mois). REFUSE toute base dont le nom ne contient pas `_test`. |
| `database/scripts/load-test.mjs` | Mesure par endpoint : froid/chaud, temps, taille, statut, lignes renvoyees vs. lignes en base. |
| `database/scripts/mesure-base.mjs` | Temps d'execution cote base via `EXPLAIN (ANALYZE, BUFFERS)` sur les requetes des rapports. |
| `database/scripts/regression-base-vide.mjs` | Base VIDE : aucun 500, aucun chargement infini, etats vides corrects, aucune fuite technique. |
| `database/scripts/regression-securite.mjs` | Routes privees sans session -> 401 JSON ; CSP par nonce ; en-tetes de securite. |

### Tests de logique pure et tests d'integration

Les tests de logique metier pure ne dependent pas de la base : ils s'executent
partout et couvrent les regles les plus critiques.

Les tests d'**integration** (`tests/integration/*`) s'executent contre une
instance **PostgreSQL 16 reelle** lorsque `TEST_DATABASE_URL` est definie. Sans
cette variable, ils sont **explicitement IGNORES** — jamais simules, jamais
declares « passes ».

> **Principe** : nous ne declarons jamais un test « passe » s'il n'a pas ete
> execute. Un test qui depend d'une base absente est signale comme tel.

---

## 3. Ce que couvrent les tests executes

### 3.1 Calculs financiers — `tests/business/finance.test.ts`

| Verifie |
|---|
| Conversion dinars ↔ centimes (espaces, virgule, point, refus des saisies invalides) |
| Formatage des montants (rond, decimal, zero) |
| Calcul du reste a payer a partir des paiements valides |
| Traitement partiellement paye, non paye, entierement paye |
| **Prevention du depassement** : refus d'un paiement qui depasserait le prix total |
| **Scenario complet de la specification (§44)** : patient Ahmed, devitalisation dent 36 (20 000 DA en 2 paiements), couronne dent 11 (15 000 DA, 5 000 DA paye) → totaux 35 000 / 25 000 / 10 000 DA |
| **Le chiffre d'affaires est la somme des paiements reels, pas des prix factures** |

Le scenario §44 est reproduit **exactement** : c'est le test qui prouve la
regle metier centrale du systeme.

### 3.2 Corbeille — `tests/business/corbeille.test.ts`

| Verifie |
|---|
| La constante du domaine vaut **exactement** 86 400 000 ms |
| **Ce n'est pas** 30 jours |
| **Ce n'est pas** 90 jours |
| L'expiration vaut exactement `supprimeLe + 24 h` |
| Un element supprime il y a 1 h est restaurable |
| Un element supprime il y a 23 h 59 est encore restaurable |
| Un element supprime depuis **exactement** 24 h ne l'est **plus** |
| Un element supprime depuis 24 h 01 ne l'est plus |
| Un element supprime depuis 3 jours ne l'est plus |

### 3.3 Securite et validation — `tests/business/securite.test.ts`

| Verifie |
|---|
| Robustesse des mots de passe (longueur, majuscule, minuscule, chiffre, mots courants) |
| **Anonymisation des journaux** : `password`, `passwordHash`, `sessionSecret`, `csrfToken` masques, y compris **imbriques** et dans un **tableau**, **insensible a la casse** |
| Les champs legitimes ne sont **pas** masques |
| Numero de dent FDI (permanent, temporaire, refus hors domaine) |
| Validation patient (telephone obligatoire, telephone trop court, date de naissance dans le futur) |
| Validation paiement (montant nul/negatif refuse, cle d'idempotence obligatoire, methode hors domaine refusee) |
| Validation reprogrammation (fin avant debut refusee) |
| **Injections** : une charge SQL est traitee comme donnee, pas comme SQL |
| **XSS** : une charge `<script>` est acceptee comme donnee (elle sera echappee a l'affichage) |
| Erreurs de champ **en francais** |

---

## 4. Couverture des suites d'integration (PostgreSQL reel)

Les suites `tests/integration/*` couvrent les scenarios suivants contre une base
PostgreSQL 16 reelle :

| Domaine | Cas couverts |
|---|---|
| **Rapports — revenus mensuels** | execution SQL, validite du cast d'enum `StatutPaiement`, `DATE_TRUNC` par mois, `SUM` type `bigint`, bornes de mois, independance a la timezone de session, base vide, limite de 12 mois |
| **Rapports — soldes patients** | execution SQL, calcul du solde, exclusion des traitements ANNULE, exclusion des paiements ANNULE, exclusion des patients sans traitement, `LIMIT`/`OFFSET`, COUNT exact, tri deterministe, bornage de page |
| **Odontogramme** | corbeille vide (cas normal), patient sans entree, etat courant = derniere entree, exclusion d'une entree en corbeille |

La section 5 ci-dessous decrit la procedure d'execution.
| **Patients** | Creation, modification, recherche, suppression, restauration |
| **Rendez-vous** | Creation, modification, reprogrammation (**historique conserve**), detection de conflit |
| **Traitements** | Creation, traitements multiples par patient, visites multiples, cloture |
| **Paiements** | Creation, calcul du reste, **protection contre la double soumission**, correction/contre-passation, calcul du chiffre d'affaires |
| **Corbeille** | Suppression logique, restauration **avant** 24 h, **refus apres** 24 h, suppression definitive |
| **Securite** | Autorisation (appel API sans session), entree invalide, injection, XSS, acces non autorise |
| **Documents** | Televersement valide, MIME invalide, fichier trop volumineux, acces non autorise |

### Scenario de reference a automatiser en priorite

Le scenario du patient Ahmed (§44), de bout en bout, contre la base reelle :

```
1. Creer le patient Ahmed.
2. Creer le traitement 1 (Devitalisation, dent 36, 20 000 DA).
3. Ajouter un paiement de 10 000 DA  -> verifier reste = 10 000 DA.
4. Ajouter une deuxieme visite de 10 000 DA -> verifier reste = 0 DA.
5. Marquer le traitement termine.
6. Creer le traitement 2 (Couronne, dent 11, 15 000 DA).
7. Ajouter un paiement de 5 000 DA -> verifier reste = 10 000 DA.
8. Verifier les totaux patient : 35 000 / 25 000 / 10 000 DA.
9. Verifier que le tableau de bord affiche le chiffre d'affaires reel (paiements),
   et non la somme des prix factures.
10. Tenter un paiement qui depasserait le prix total -> doit etre refuse.
11. Tenter un paiement avec une cle d'idempotence deja utilisee -> aucun doublon.
```

La logique metier de ce scenario est **deja verifiee** par les tests purs
(section 3.1). L'automatisation contre la base validera la couche de
persistance.

---

## 5. Executer les tests d'integration

### Prerequis

Une base PostgreSQL JETABLE, jamais celle du cabinet :

```bash
createdb sahed_integration_test
DATABASE_URL="postgresql://user:pass@localhost:5432/sahed_integration_test" npm run db:migrate:deploy
```

### Execution

```bash
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/sahed_integration_test" npm run test
```

Sans `TEST_DATABASE_URL`, les suites d'integration sont marquees IGNOREES dans le
rapport — jamais « passees » : elles ne sont ni executees, ni simulees.

### Principe de non-simulation

Les tests d'integration ne doivent **pas** etre remplaces par des simulations
qui donneraient une fausse assurance : ils doivent s'executer contre une base
reelle. Tant qu'ils ne s'executent pas, aucun resultat n'est avance pour eux.

---

## 6. Philosophie des tests de ce projet

1. **Un test qui ne s'execute pas n'est pas un test.** Onne declare jamais un
   resultat non mesure.
2. **Les regles critiques sont testees en priorite** : le solde d'un patient et
   la fenetre de 24 heures de la Corbeille. Une erreur y cause un litige ou une
   perte de donnees.
3. **Les garanties de securite sont testees** : anonymisation des journaux,
   validation des entrees, resistance aux injections. C'est verifiable, donc
   verifie.
4. **Pas de test pour le decor.** Un test qui se contente de verifier qu'un
   composant s'affiche n'apporte rien ; les tests portent sur le comportement
   metier et les garanties de securite.