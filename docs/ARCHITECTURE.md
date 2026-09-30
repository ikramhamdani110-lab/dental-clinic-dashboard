# Architecture — SAHED DENTAL CLINIC

Ce document decrit l'architecture du systeme et sa classification finale
(§58 de la specification) : chaque composant est explicitement classe
**REQUIS POUR V1** ou **OPTION DE MONTEE EN CHARGE ULTERIEURE**.

---

## 1. Vue d'ensemble

Application **monolithique modulaire** : un seul deploiement Next.js sert le
site public, l'interface privee et l'API REST. La logique metier vit dans
`backend/`, framework-agnostique, et les routes API ne font que l'exposer.

```
                     ┌──────────────────────────────────────┐
 Navigateur ────────▶│  Next.js (un seul processus)         │
 (HTTPS)             │                                      │
                     │  middleware.ts                       │
                     │    ├─ CSP (nonce par requete)        │
                     │    ├─ protection des routes privees  │
                     │    └─ controle d'origine (CSRF amont)│
                     │                                      │
                     │  src/app/(public)   → site public    │
                     │  src/app/(auth)     → connexion      │
                     │  src/app/(dashboard)→ tableau de bord│
                     │  src/app/api        → REST API       │
                     │        │                             │
                     │        ▼                             │
                     │  backend/services/  → logique metier │
                     │        │                             │
                     └────────┼─────────────────────────────┘
                              ▼
                     ┌──────────────────┐     ┌───────────────────┐
                     │   PostgreSQL     │     │ Stockage prive    │
                     │  (source verite) │     │ (documents)       │
                     └──────────────────┘     └───────────────────┘
```

**Pourquoi un monolithe ?** Pour un cabinet unique avec une seule praticienne
ou un seul praticien, une architecture distribuee (microservices, files de
messages) ajouterait un cout d'exploitation et des points de defaillance sans
aucun benefice (§58). Le degres de separation interne (modules, services)
suffit a garder le code maintenable et a permettre une extraction ulterieure
si le besoin apparaissait reellement.

---

## 2. Classification des composants (§58)

### REQUIS POUR V1

| Composant | Role |
|---|---|
| Next.js 15 (App Router) | Rendu serveur + client, routes API, un seul deploiement |
| React 19 | Interface |
| TypeScript strict | Fiabilite du code |
| PostgreSQL | Source de verite, integrite relationnelle |
| Prisma 6 | ORM + migrations versionnees |
| Argon2id (`argon2`) | Hachage des mots de passe |
| Sessions serveur en base | Authentification revocable |
| Zod | Validation cote serveur |
| `jose` | Jeton CSRF signe (cryptographie standard) |
| `date-fns` | Manipulation de dates (formats francais) |
| `file-type` | Verification du type REEL des documents televerses |
| Recharts | Graphique des revenus mensuels |
| Vitest | Tests automatises |
| ESLint + Prettier | Qualite et coherence du code |

### OPTION DE MONTEE EN CHARGE ULTERIEURE

| Composant | Quand l'introduire | Pourquoi pas maintenant |
|---|---|---|
| Redis (cache, sessions) | Si le nombre de requetes sature la base | Les sessions en base suffisent largement pour un cabinet ; ajouter Redis serait un composant a maintenir sans gain mesurable |
| Index partiels supplementaires | Si des requetes ralentissent apres plusieurs annees | Les index actuels couvrent les acces reels ; on mesurera avant d'ajouter |
| Partitionnement des tables | Plusieurs centaines de milliers de lignes par table | Non atteint pour un cabinet unique |
| Vues materialisees | Rapports financiers devenus lents | Les agregations actuelles sont indexees |
| Recherche plein texte (PostgreSQL `tsvector`) | Recherche patient insuffisamment precise | `pg_trgm` couvre deja la recherche partielle |
| Roles supplementaires (assistant, administrateur) | Embauche d'un second poste | L'enumeration et la couche d'autorisation sont deja dimensionnees |
| Multi-praticiens | Ouverture d'un second fauteuil | Le modele porte deja `praticienId` sur les rendez-vous |
| Stockage objet (S3 compatible) | Volume de documents important | Le stockage fichier prive suffit pour un cabinet |
| Analyse antivirus des documents | Exigence reglementaire explicite | Non justifie par l'architecture de deploiement actuelle (§22) |
| Journalisation centralisee (SIEM) | Multi-sites, exigence d'audit renforcee | Les journaux structures suffisent |
| Chiffrement applicatif colonne | Donnee particulierement sensible identifiee | Le chiffrement disque et de sauvegarde couvre le besoin actuel |

**Aucune de ces options n'est implementee.** Les ajouter sans besoin reel
augmenterait la surface de defaillance et le cout de maintenance.

---

## 3. Modele de donnees (resume)

Le schema complet, commente, est dans `database/prisma/schema.prisma`.

### Hierarchie centrale (§8)

```
Patient 1 ──< n Treatment 1 ──< n TreatmentVisit 1 ──< n Payment
```

Un patient a un nombre **illimite** de traitements historiques. Un traitement
comporte plusieurs **visites** (seances). Chaque visite peut porter un ou
plusieurs paiements.

### Regles d'integrite appliquees

| Regle | Mise en oeuvre |
|---|---|
| « Reste a payer » jamais stocke | Calcule a la lecture : `prixTotal - somme(paiements VALIDE)` |
| Pas de montant flottant | Tous les montants sont des **entiers en centimes** |
| Pas de depassement de paiement | Verifie dans une **transaction** avant insertion |
| Pas de double paiement | Cle d'idempotence **unique** en base |
| Paiement jamais modifie | Statut `ANNULE` + ligne de `payment_corrections` |
| Historique de reprogrammation | Ligne `appointment_reschedules` a chaque changement |
| Dossier medical historique | Une entree par consultation (aucun champ unique ecrasable) |
| Odontogramme historique | Une entree par changement d'etat de dent |
| Corbeille = 24 h exactes | Contrainte CHECK `expireLe = supprimeLe + INTERVAL '24 hours'` |

### Tables (18)

`users`, `sessions`, `login_attempts`, `password_reset_tokens`,
`patients`, `treatments`, `treatment_visits`, `appointments`,
`appointment_reschedules`, `payments`, `payment_corrections`,
`medical_records`, `prescriptions`, `prescription_items`,
`odontogram_entries`, `documents`, `trash_entries`, `activity_logs`,
`settings`.

---

## 4. Structure de l'API REST

Toutes les routes privees passent par `routePrivee` (authentification +
autorisation + CSRF + gestion d'erreurs). **Aucune route privee ne peut etre
appelee sans session valide** (§39).

### Authentification

| Methode | Chemin | Role |
|---|---|---|
| POST | `/api/auth/login` | Connexion (publique, protegee contre la force brute) |
| POST | `/api/auth/logout` | Deconnexion (revoque la session cote serveur) |
| GET | `/api/auth/session` | Utilisateur courant |

### Ressources

| Methode | Chemin |
|---|---|
| GET / POST | `/api/patients` |
| GET / PUT / DELETE | `/api/patients/:id` |
| GET | `/api/patients/:id/appointments` |
| GET | `/api/patients/:id/treatments` |
| GET | `/api/patients/:id/payments` |
| GET / POST | `/api/patients/:id/medical-records` |
| GET / POST | `/api/patients/:id/prescriptions` |
| GET / POST | `/api/patients/:id/odontogram` |
| GET / POST | `/api/patients/:id/documents` |
| GET / POST | `/api/appointments` |
| GET / PUT / DELETE | `/api/appointments/:id` |
| POST | `/api/appointments/:id/reschedule` |
| GET / POST | `/api/treatments` |
| GET / PUT / DELETE | `/api/treatments/:id` |
| GET / POST | `/api/treatments/:id/visits` |
| GET / POST | `/api/payments` |
| POST | `/api/payments/:id/correct` |
| GET | `/api/documents/:id/download` |
| GET | `/api/dashboard` |
| GET | `/api/reports/revenue` |
| GET | `/api/activity-log` |
| GET | `/api/trash` |
| POST | `/api/trash/:id/restore` |
| DELETE | `/api/trash/:id/permanent` |
| GET / PUT | `/api/settings` |
| GET | `/api/health` |

---

## 5. Systeme de conception (design system)

Direction visuelle : **logiciel medical professionnel** (bleu marine profond,
bleu medical, surfaces bleu-gris, statuts sobres).

| Fichier | Role |
|---|---|
| `src/app/theme.css` | Jetons de design (couleurs, espacements, rayons) pour les deux themes |
| `src/app/components.css` | Styles des composants reutilisables |
| `src/app/layout-app.css` | Structure du tableau de bord (barre laterale, entete) |
| `src/app/site-public.css` | Styles du site public |

**Themes clair et sombre** : concus separement, pas une simple inversion. Le
theme est applique avant la peinture par un script inline (aucun « flash »).

**Accessibilite** : navigation clavier, `:focus-visible` explicite, contrastes
verifies, HTML semantique, libelles de formulaire lies, `aria-current` sur la
navigation, piege de focus dans les modales, respect de
`prefers-reduced-motion`.

---

## 6. Textes francais

L'application est francophone uniquement. Les libelles sont **centralises**
dans `content/fr.json` et accedes via `t('chemin.pointe')` : c'est une exigence
de **maintenabilite**, pas d'internationalisation. Aucun selecteur de langue.

---

## 7. Performance

- **Pagination serveur** sur toutes les listes (patients, rendez-vous,
  traitements, paiements, journal, rapports).
- **Recherche debouncee** cote client (§26).
- **Agregations en base** pour tous les totaux (§18) : les paiements ne sont
  jamais telecharges pour etre additionnes dans le navigateur.
- **Index** : B-tree sur les colonnes filtrees, trigram (`pg_trgm`) sur la
  recherche patient, index partiels sur les populations actives.
- **Chargements cibles** : une liste ne charge que les colonnes qu'elle affiche.

---

## 8. Limites connues

1. **Un seul role actif.** L'enumeration `UserRole` et la couche d'autorisation
   prevoient `ASSISTANT` et `ADMINISTRATEUR`, mais `UTILISATEURS_ACTIFS` ne
   contient que `MEDECIN`. Les activer demande d'ajouter le role a cette liste
   et de definir ses droits, pas de reconstruire l'autorisation.

2. **Tests d'integration conditionnes.** La machine de developpement utilisee
   n'a pas de PostgreSQL : les tests de logique metier pure s'executent partout,
   mais les tests d'integration necessitent une base. Voir `docs/TESTS.md`.

3. **Aucune reprise automatisee de donnees externe.** L'import d'un historique
   existant (autre logiciel) se ferait par un script dedie, hors V1.

4. **Pas d'analyse antivirus des documents televerses.** Le type reel est
   verifie et le stockage est prive ; l'analyse antivirus depend de
   l'architecture de deploiement (§22).

5. **Pas de chiffrement des sauvegardes par l'application.** Le chiffrement de
   la sauvegarde est confie a l'outillage systeme (`age`, `gpg`, volume
   chiffre). Voir `docs/BACKUP.md`.

6. **Restauration de sauvegarde non testee automatiquement.** La procedure est
   documentee et doit etre repetee manuellement a intervalle regulier.

---

## 9. Evolutions prevues sans reconstruction

- Ajout d'un role (assistant, administrateur) : etendre `UTILISATEURS_ACTIFS`.
- Plusieurs praticiens : `praticienId` existe deja sur les rendez-vous ;
  ajouter un champ equivalent sur traitements/paiements.
- Second cabinet : ajouter une dimension « site » aux entites concernees.
- Portail patient : **explicitement exclu de V1** (§47). Le modele de donnees
  ne l'empeche pas, mais aucune intention ne doit etre presume.