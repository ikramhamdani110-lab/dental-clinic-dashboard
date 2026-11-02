# PLAN DE MISE EN SERVICE — version consolidée (2026-11-01)

Ce document remplace les plans antérieurs. Il découle du cahier des charges
« définitif » et de l'inspection du code réel. **Aucune écriture production
n'a encore été faite** — chaque bloc attend votre approbation explicite.

---

## 1. CE QUE LE CODE FAIT AUJOURD'HUI (constat, vérifié dans le code)

### Secrétaire (site web + application de bureau)

- **Site web secrétaire** = application Next.js (Vercel). Déjà codée pour un
  rôle ASSISTANT : `database/prisma/schema.prisma` définit l'énumération
  `UserRole { MEDECIN, ASSISTANT, ADMINISTRATEUR }`, mais
  `backend/auth/authorization.ts` limite encore `UTILISATEURS_ACTIFS` à
  `['MEDECIN']`. **Il faut activer ASSISTANT dans cette liste** (une ligne),
  sinon le compte secrétaire sera rejeté à la connexion.
- **Application de bureau (Electron)** = un **serveur Next.js autonome**
  embarqué, qui tourne sur `127.0.0.1:43177` avec sa **propre base
  PostgreSQL embarquée** (`embedded-postgres`, port 54329, base
  `sahed_clinic`, utilisateur `sahed/sahed_local_pw` — voir
  `desktop/main.mjs` lignes 56‑62). Elle est **strictement hors ligne** :
  aucune connexion Internet n'est requise ni utilisée (`main.mjs`, en‑tête).
- Le hachage du mot de passe est Argon2id + pepper côté serveur, avec la
  **sentinelle `passwordChangedAt = epoch 0`** qui force un changement de mot
  de passe à la première connexion (`backend/services/auth.service.ts` ligne
  170, `database/seed.ts` lignes 91‑92). Ce mécanisme est **déjà en place**
  et fonctionnera pour les deux comptes dès leur création avec
  `passwordChangedAt = 0`.

### Dr. Sahed (site financier privé)

- Site `/finances` **déjà séparé** de l'application clinique : sessions
  dédiées dans la table `finance_sessions`, cookie distinct
  (`sahed_finance_session`), CSRF dédié (`backend/auth/finance-session.ts`),
  et la fonction `connexionFinanciere()` (backend/services/finances.service.ts
  lignes 1001‑1077) **refuse tout rôle ≠ MEDECIN** avec la raison
  `ROLE_NON_AUTORISE`. La séparation est **native et côté serveur** :
  créer une secrétaire ASSISTANT ≠ MEDECIN suffit à la bloquer, sans code
  supplémentaire.
- La table `finance_sessions` **n'existe pas encore** en production Neon
  (vérifié par inventaire) — elle sera créée par migration Prisma.

### Base de données

- Production Neon `sahed-dental-clinic` / branche `main` / base `neondb`
  (identité vérifiée, backup fraîche déjà fait).
- Desktop utilise aujourd'hui **une autre base** (locale, embarquée) :
  ce n'est PAS la même base que le site web. **Je ne prétends pas le
  contraire** — c'est exactement le point à trancher (voir §3).

---

## 2. COMPTES À CRÉER (en attente de votre feu vert)

| Application | Email | Rôle | Mot de passe initial | Changement forcé 1ʳᵉ connexion |
|---|---|---|---|---|
| Secrétaire (web + desktop) | `clinic@gmail.dz` | ASSISTANT | `Clinic123+` | ✅ (sentinelle native) |
| Dr. Sahed (finances) | `sahed@gmail.dz` | MEDECIN | `Sahed_2026` | ✅ (sentinelle native) |

- Un **seul compte par personne** : le compte secrétaire `clinic@gmail.dz`
  servira à la fois au site web secrétaire ET (après migration desktop §3)
  à l'application de bureau. Pas d'identité dupliquée.
- Les mots de passe sont traités comme **provisoires** (partagés en chat) —
  la sentinelle native obligera à les changer à la 1ʳᵉ connexion. Aucun ne
  sera imprimé, loggué ni commité.
- Le compte `demo@cabinet.dz` (MEDECIN, actif, créé le 2026‑09‑30) est un
  **compte de démonstration** : proposition de le **désactiver**
  (`isActive = false`) sans le supprimer, pour traçabilité. À confirmer.

---

## 3. BASE PARTAGÉE — CONTRAINTE ARCHITECTURALE MAJEURE

### Constat honnête

Le bureau embarque **sa propre base PostgreSQL locale** (`embedded-postgres`,
dans AppData du poste). Le site web (Vercel) et les finances pointent vers
**Neon**. Ce sont donc **aujourd'hui deux bases distinctes** — je ne les
présente pas comme une seule.

### Trois options réelles

#### Option A — Bureau 100 % en ligne sur Neon (recommandée si Internet fiable)
- On **remplace** `DATABASE_URL` locale par l'URL Neon dans `desktop/main.mjs`
  (variable d'env, jamais en dur dans le bundle).
- **Avantages** : une seule source de vérité, zéro conflit, zéro dupliqué,
  déploiement simple, pas de mécanisme de sync à maintenir.
- **Inconvénients** : **Internet devient obligatoire** ; latence réseau ;
  coupure = bureau inutilisable.
- **Effort** : faible (~1 journée de code + tests), car le bureau exécute
  déjà le même Next.js que le web — il suffit de changer la cible DB.
- **Compatibilité comptes** : le compte secrétaire `clinic@gmail.dz` créé en
  Neon fonctionnera **automatiquement** sur le bureau (même base, même
  Argon2id, même pepper — à condition d'aligner le pepper desktop sur celui
  de production, voir Risques).
- **Hors ligne** : non supporté. Si la connexion tombe, l'application de
  bureau ne peut plus lire ni écrire.

#### Option B — Offline‑first avec synchronisation (complexe, long)
- On garde la base embarquée ; on ajoute une couche de **réplication
  applicative** (file d'attente d'opérations, jetons d'idempotence, résolution
  de conflits LWW ou CRDT, reconnexion auto).
- **Avantages** : marche sans Internet.
- **Inconvénients** : **gros chantier** (plusieurs semaines), forte
  complexité, risque réel de doublons patients ou de divergences financières
  si un conflit est mal résolu. Exige des tests d'intégrité permanents.
- **Je la déconseille** sauf besoin urgent du hors‑ligne.

#### Option C — Hybride pragmatique (compromis)
- Bureau utilise Neon quand Internet est là ; sinon bascule sur une base
  locale **temporaire** avec une file d'attente d'opérations, rejouée à la
  reconnexion (idempotence par UUID client).
- **Inconvénients** : complexité intermédiaire ; conflits possibles (même
  patient modifié des deux côtés) → résolution LWW ou fusion manuelle.
- Effort ~2‑3 semaines. À réserver à un vrai besoin hors‑ligne.

### Ma recommandation : **Option A**, sauf contrainte hors‑ligne forte.

---

## 4. DONNÉES DE TEST IDENTIFIÉES (inventaire, lecture seule)

Inventaire réel fait sur Neon (aucune suppression) :

### Patients (46 au total) — candidats « données de test »

| # | Nom | Prénom | Téléphone | Créé le | Indices |
|---|---|---|---|---|---|
| 1 | Age18909757 | Test | 0544567890 | 2026‑09‑30 | Nom = « Test », prénom = « Age18909757 » (autogénéré) |
| 2 | dfghjk | dfghjkl | 1234567890 | 2026‑10‑01 | Frappe clavier aléatoire |
| 3 | asdhl;' | sdfghjk | 234567890 | 2026‑10‑01 | Frappe clavier aléatoire (+ apostrophe) |
| 4 | wsdfj | sdfgh | 234567 | 2026‑10‑01 | Frappe clavier aléatoire (téléphone trop court) |
| 5 | asddsdff | sahed | 234567890‑ | 2026‑10‑28 | Frappe clavier aléatoire (téléphone malformé) |

**Cas limites volontairement NON classés « test » :**
- `hamdani ikram` (0542546077, 2026‑09‑30) : nom réel plausible, pourrait être
  une vraie personne → **conservé**, à confirmer par vous.
- Les **40 autres** patients (Kaci, Belkacem, Saidi, etc.) ont des noms
  algériens plausibles, des téléphones cohérents (0550 20xxx) → **conservés**.
- **Aucun patient n'est marqué « test » uniquement parce qu'il a été créé en
  même temps que d'autres** : le critère est le contenu (noms/frappes
  absurdes, téléphone invalide), pas la date.

### Objets liés à ces 5 patients (à joindre à la corbeille applicative)

À compter précisément avant toute suppression (je le ferai dans le script de
purge, affiché avant exécution) :
- `appointments` liés
- `treatments` liés
- `payments` liés
- `documents`, `medical_records`, `prescriptions`, `odontogram_entries` liés
  (probablement 0 d'après l'inventaire, mais vérifié à l'exécution)

### Utilisateurs

| Email | Rôle | Créé | Statut |
|---|---|---|---|
| `demo@cabinet.dz` | MEDECIN | 2026‑09‑30 | actif — **compte de démo** : proposition de **désactivation** (`isActive=false`), pas de suppression |

### Tables de sessions / journal

- `sessions` : 67 entrées, `login_attempts` : 147, `activity_logs` : 212 →
  **conservés** (historique d'audit, pas des données de test au sens clinique).
- `trash_entries` : 0 (corbeille vide).
- `finance_sessions`, `odontogrammes` : tables absentes en prod — créées par
  migration Prisma `prisma migrate deploy` (non destructives).

---

## 5. MIGRATIONS REQUISES (toutes non destructives)

1. **`prisma migrate deploy`** sur Neon : applique les migrations Prisma déjà
   écrites dans le repo (`database/prisma/migrations/…`) — notamment celle qui
   crée `finance_sessions` et les index/contraintes PostgreSQL. **Aucune
   suppression de table ni de colonne.**
2. **Activation du rôle ASSISTANT** :
   `backend/auth/authorization.ts` — `UTILISATEURS_ACTIFS = ['MEDECIN','ASSISTANT']`.
3. **Création des 2 comptes** via un script Node serveur (Argon2id + pepper de
   production, sentinelles 1ʳᵉ connexion). Jamais dans le code versionné.
4. **Alignement du pepper desktop** avec celui de prod (`PASSWORD_PEPPER`
   dans l'environnement du bureau) — sinon les mots de passe ne seraient pas
   vérifiables depuis le bureau sur Neon. **Ne se fait PAS en committant le
   pepper** : variable d'environnement locale/installeur.
5. **Bascule desktop sur Neon** (si Option A) : remplacer `DATABASE_URL`
   locale par l'URL Neon, via variable d'environnement ou fichier de config
   local hors Git.

---

## 6. RISQUES ET MESURES

| Risque | Mesure |
|---|---|
| Le pepper desktop ≠ pepper prod → connexions refusées depuis le bureau | Unifier le pepper via variable d'env à l'installation ; test de connexion sur un compte réel avant livraison |
| Comptes réels verrouillés par le throttle (5 échecs / 15 min) | Test de login limité à 1‑2 tentatives, mot de passe correct dès le départ |
| Suppression accidentelle d'un vrai patient | Purge **uniquement** par la corbeille applicative (`TrashEntry`, restaurable 24 h), sur la liste exacte des 5 IDs fournis dans l'inventaire ; backup vérifié conservé |
| Migrations Prisma non prévues modifient le schéma | Revue ligne par ligne des migrations avant `migrate deploy`, aucun `DROP` |
| Session expirée pendant l'opération | Reconnexion automatique ; si verrouillage, déblocage scripté (reset `failedLoginCount`/`lockedUntil`) — pas de contournement de la sécurité |
| Conflits de synchronisation (Option C) | Non applicable en Option A |

---

## 7. ORDRE D'EXÉCUTION PROPOSÉ (après votre approbation explicite)

1. Appliquer la migration Prisma (`prisma migrate deploy`) — non destructive.
2. Modifier `UTILISATEURS_ACTIFS` (une ligne, test incluse).
3. Créer les 2 comptes (sentinelles 1ʳᵉ connexion).
4. Tests de connexion web (secrétaire ✔ / médecin ✔ / **refus finances pour
   la secrétaire** — code 401/403 attendu).
5. (Option A) Bascule desktop sur Neon + pepper unifié + retests desktop.
6. Purge corbeille des **5 patients de test** identifiés + comptage
   automatique : 41 patients restants (dont `hamdani ikram` conservé), toutes
   finances cohérentes.
7. `npm run lint` + `npm run test` + `npm run typecheck` + `npm run build`.
8. Rapport final chiffré, sans aucune donnée sensible.

**Je n'exécute RIEN de tout cela tant que vous n'avez pas approuvé
explicitement : (a) l'option A/B/C pour la base partagée, (b) la liste exacte
des 5 patients à supprimer, (c) la désactivation du compte `demo@cabinet.dz`,
(d) l'ordre des migrations.**
