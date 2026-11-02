# Site financier privé du médecin — architecture et synchronisation

Ce document décrit la séparation entre l'application de bureau (secrétaire) et
le site financier privé du médecin, et l'approche de synchronisation retenue.

---

## 1. Ce qui a changé côté application clinique

| Élément | Changement |
|---|---|
| Tableau de bord | Indicateurs financiers **retirés** : « Paiements du jour », « Paiements reçus », « Montants restant dus », revenus du jour / semaine / mois. |
| Section **Rapports** | **Retirée** entièrement : page, composant, entrée de navigation et API `/api/reports/revenue` supprimées. |
| PDF du tableau de bord | Les lignes « Payé aujourd'hui » et « Montants restant dus » ne sont plus imprimées. |
| Paiements | **Intacts**. L'enregistrement d'un paiement reste la responsabilité de la secrétaire (§16) : le formulaire, la clé d'idempotence et le contrôle de dépassement sont inchangés. |
| Patients, rendez-vous, traitements | Intacts. |

Aucun tableau ni colonne existante n'a été modifiée ou supprimée : la migration
est strictement **additive**.

---

## 2. Le site financier privé

Interface distincte sous le groupe de routes `(finances)` :

| Route | Rôle |
|---|---|
| `/finances/connexion` | Connexion dédiée (session distincte). |
| `/finances` | Tableau de bord financier (revenus, dépenses, solde net, restant dû, tendance mensuelle). |
| `/finances/revenus-manuels` | Liste, création, modification, suppression. |
| `/finances/depenses` | Liste, création, modification, suppression (filtres par catégorie). |

API protégées (`routeFinanciere`) :

| Méthode | Chemin | Rôle |
|---|---|---|
| POST / DELETE | `/api/finances/auth` | Connexion / déconnexion de la session financière. |
| GET | `/api/finances/summary` | Synthèse + tendance mensuelle. |
| GET / POST | `/api/finances/manual-income` | Liste / création. |
| PUT / DELETE | `/api/finances/manual-income/[id]` | Modification / suppression. |
| GET / POST | `/api/finances/expenses` | Liste / création. |
| PUT / DELETE | `/api/finances/expenses/[id]` | Modification / suppression. |
| GET | `/api/finances/history` | Historique paginé des transactions. |

### Sécurité (critique)

- **Session dédiée** : le site financier utilise un cookie distinct
  (`sahed_finance_session`, HttpOnly, Secure en production, SameSite=Lax),
  porté par la table `finance_sessions`. La session clinique de la secrétaire
  (ou du médecin sur le poste clinique) **ne donne AUCUN accès** au site
  financier, et réciproquement.
- **Serveur uniquement** : chaque page du groupe `(finances)` resout la session
  côté serveur avant tout rendu ; chaque route API vérifie la session et le rôle
  (seul `MEDECIN` actif est accepté) — deny by default. Masquer un lien ne
  protège rien : le refus est systématique côté serveur.
- **CSRF** : jeton dédié (`x-finance-csrf-token`), vérifié sur toute requête
  mutante.
- **Pas d'inscription publique** : seul le compte MEDECIN existant peut ouvrir
  une session ; le mot de passe Argon2id est celui du compte médecin.
- **Aucun secret exposé** : le jeton de session, l'empreinte Argon2id et la
  chaîne de connexion ne figurent jamais dans une réponse, un journal ou un
  bundle client.

### Calculs financiers

- **Revenu encaissé** : somme des paiements `VALIDE` de la table `payments`
  (exclusion des paiements en corbeille), bornes en calendrier local,
  agrégations en base (`aggregate`, `$queryRaw` avec `DATE_TRUNC`). Aucun
  paiement annulé, corrigé ou invalide n'entre dans un total.
- **Revenus manuels** : table `manual_incomes`, toujours distinguée du revenu
  calculé. Les deux lignes ne sont jamais fondues silencieusement.
- **Dépenses** : table `expenses` (catégories : EQUIPEMENT, FOURNITURES, LOYER,
  UTILITES, SALAIRES, MAINTENANCE, AUTRE, + catégorie libre).
- **Solde net** = revenus paiements + revenus manuels − dépenses.
- **Restant dû** (facture − paiements VALIDE sur traitements non annulés) est
  **affiché séparément** et n'entre jamais dans le solde net : ce n'est pas de
  l'argent reçu.
- La mention affichée précise que la synthèse décrit les écritures enregistrées,
  et **non** la position comptable complète du cabinet.

### Anti-doublon (revenus manuels)

1. **Serveur** : `idempotencyKey` UNIQUE en base sur `manual_incomes` — un
   second envoi du même formulaire ne crée pas de seconde ligne.
2. **Règle d'usage** affichée à l'écran : une encaissement clinique se saisit
   dans l'application de bureau ; le site financier ne sert qu'aux recettes
   hors de ce circuit.
3. **Distinction des populations** : aucun total ne fond revenus calculés et
   revenus manuels sans libellé explicite.

---

## 3. Synchronisation — ce qui est EN PLACE et ce qui NE L'EST PAS ENCORE

### État actuel

L'application de bureau (Electron) démarre un PostgreSQL **embarqué** qui
n'écoute que sur `127.0.0.1` (port 54329). La base n'est **pas** accessible
depuis Internet — c'est une exigence de sécurité explicite.

Le site financier partage aujourd'hui la **même base** lorsque l'application
tourne sur le poste clinique : les revenus calculés lisent directement
`payments`, `manual_incomes` et `expenses`. Cela fonctionne en local (le
médecin ouvre le site depuis le même poste, ou via un réseau local).

### Ce qui n'est PAS encore en place

**Un accès Internet sécurisé à la base locale n'est pas implémenté.** Le site
financier, tel qu'il est livré, ne peut pas être publié publiquement en lisant
la base embarquée du poste clinique. Ne pas prétendre le contraire.

### Architecture proposée pour la mise en ligne (à valider avant déploiement)

Deux options, à choisir selon les contraintes du cabinet :

**Option A — PostgreSQL managé comme source de vérité (recommandée)**

```
Application de bureau ──▶ PostgreSQL managé (TLS, sauvegardes)
        (Internet)              ▲
                                │
                     Site financier (HTTPS)
```

- La base est migrée vers un PostgreSQL managé (PaaS), accessible au bureau par
  TLS (`sslmode=require`) et au site financier.
- L'application de bureau est reconfigurée (`DATABASE_URL` managée) — aucune
  modification du code n'est nécessaire.
- Les données existantes sont migrées une seule fois (backup → restore).
- **Aucune copie** des paiements : une seule source de vérité, donc aucune
  divergence possible.

**Option B — Synchronisation approuvée (si la base doit rester locale)**

- Un **agent** sur le poste clinique pousse les paiements validés vers le
  serveur du site financier via HTTPS + authentification mutuelle (mTLS ou
  jeton long terme stocké dans le magasin de secrets de l'OS), avec un
  idempotency key par paiement (déjà présent en base).
- Le serveur du site financier conserve une réplique en lecture seule des
  paiements, avec la clé d'origine conservée pour la traçabilité.
- La synchronisation est **incrémentale et idempotente** (clé unique), donc
  rejouable sans doublon.

**Cette option B n'est PAS implémentée dans cette livraison.** Elle exige un
composant supplémentaire côté bureau, un serveur hébergé et une procédure de
sauvegarde/restauration. Elle doit être écrite, testée et validée avant toute
exposition publique.

### Règles d'or

1. **Ne jamais exposer le PostgreSQL embarqué au public** : il n'écoute que sur
   `127.0.0.1`, et il doit le rester.
2. **Ne pas créer de seconde copie** des paiements sans stratégie de
   synchronisation définie et testée (reprise sur incident, idempotence).
3. **Aucune publication publique** du site financier sans validation explicite.
4. **Sauvegarde** de la base avant toute migration ou changement de schéma.

---

## 4. Migration appliquée

| Fichier | Objet |
|---|---|
| `20261028000000_finances_privees` | Tables **additives** `manual_incomes`, `expenses`, `finance_sessions` + index, contraintes CHECK, clés étrangères. Aucune table existante n'est modifiée. |

Sauvegarde à effectuer avant application (`npm run backup:postgres`), puis
`npm run db:migrate:deploy`.
