# Deploiement en production — SAHED DENTAL CLINIC

Ce document decrit l'architecture de deploiement recommandee et la procedure.
Il n'impose pas un fournisseur : il enonce **ce qui doit etre vrai** pour que la
production soit sure.

---

## 1. Exigences de deploiement (§41)

Le systeme contient des donnees medicales et financieres. Le choix de
l'infrastructure doit satisfaire ces exigences :

| Exigence | Raison |
|---|---|
| **HTTPS obligatoire** | Les donnees de sante ne transitent jamais en clair ; `COOKIE_SECURE=true` |
| **PostgreSQL manage** avec sauvegardes automatiques | Integrite, PITR, pas de perte de donnees |
| **Sauvegardes hors site et chiffrees** | Voir `docs/BACKUP.md` |
| **Variables d'environnement securisees** | Aucun secret dans le code ni dans l'image |
| **Stockage de documents prive et persistant** | Hors racine web, volume dedie |
| **Supervision et points de sante** | `GET /api/health` |
| **Localisation des donnees maitrisee** | Conformite de la juridiction d'exploitation |
| **Mises a jour sans interruption notable** | Les rendez-vous du jour ne doivent pas etre perdus |

---

## 2. Architecture recommandee

```
                     Internet (HTTPS)
                            │
                   ┌────────▼─────────┐
                   │  Reverse proxy   │  TLS, redirection HTTPS,
                   │  (TLS, WAF)      │  limite de debit reseau
                   └────────┬─────────┘
                            │
            ┌───────────────▼────────────────┐
            │  Application Next.js           │
            │  (conteneur / service)         │
            │  - tableau de bord prive (§2)  │
            │  - API REST                    │
            └───────┬───────────────┬────────┘
                    │               │
          ┌─────────▼──────┐   ┌────▼──────────────┐
          │  PostgreSQL    │   │ Volume prive       │
          │  manage        │   │ DOCUMENTS_STORAGE_ │
          │  (PITR, backups)│  │ PATH               │
          └────────────────┘   └────────────────────┘
```

**Un VPS n'est PAS impose.** Pour un cabinet unique, un hebergement applicatif
(PaaS) avec base de donnees managee et volume persistant est plus simple a
exploiter et a sauvegarder qu'un serveur autonome : moins de surface
d'administration, sauvegardes gerees, mises a jour automatisees. Un VPS se
justifie si l'on prefere maitriser integralement l'environnement — mais il
reporte alors sur l'exploitant la responsabilite des sauvegardes, des mises a
jour de securite et de la supervision.

**Le critere decisif n'est pas « VPS ou PaaS »** mais : qui execute les
sauvegardes, qui teste les restaurations, qui applique les correctifs de
securite ?

---

## 3. Variables d'environnement de production

```bash
NODE_ENV="production"
DATABASE_PROVIDER="postgresql"
DATABASE_URL="postgresql://sahed_app:MOT_DE_PASSE@hote:5432/sahed_clinic?schema=public&sslmode=require&connection_limit=10&pool_timeout=20"

SESSION_SECRET="<32+ caracteres aleatoires>"
PASSWORD_PEPPER="<16+ caracteres aleatoires>"

APP_URL="https://cabinet-sahed.example.dz"
COOKIE_DOMAIN="cabinet-sahed.example.dz"
COOKIE_SECURE="true"          # OBLIGATOIRE en production

DOCUMENTS_STORAGE_PATH="/srv/data/documents"   # hors racine web
DOCUMENTS_MAX_BYTES="20971520"

LOG_LEVEL="info"

# Compte medecin initial (utilise UNE FOIS)
DOCTOR_EMAIL="medecin@cabinet-sahed.example.dz"
DOCTOR_NAME="Dr Sahed"
DOCTOR_INITIAL_PASSWORD="<12+ caracteres>"
```

> **Le demarrage echoue** si `COOKIE_SECURE` n'est pas `true` ou si
> `SESSION_SECRET` est absent en production : c'est volontaire.

---

## 4. Procedure de deploiement

```bash
# 1. Installer les dependances (versions verrouillees)
npm ci

# 2. Appliquer les migrations versionnees
npm run db:migrate:deploy

# 3. Generer le client Prisma
npm run db:generate

# 4. Creer le compte medecin (UNE SEULE FOIS)
npm run db:seed

# 5. Construire l'application
npm run build

# 6. Demarrer
npm run start
```

Pour mettre a jour une instance deja en production :

```bash
npm ci
npm run db:migrate:deploy   # avant de redemarrer : les migrations sont additives
npm run build
# redemarrer le service
```

### Note sur `npm run build` et le chemin du schema Prisma

Le schema Prisma vit dans `database/prisma/schema.prisma`, hors de l'emplacement
par defaut (`prisma/schema.prisma`). Les scripts `package.json` passent donc
`--schema database/prisma/schema.prisma` a chaque commande Prisma :
la generation fonctionne depuis un depot fraichement clone, sans variable
d'environnement particuliere et sans commande propre au developpeur.

> **Artefact Windows connu** : si une instance de l'application tourne DEJA sur
> la meme machine (par exemple un `npm run start` laisse ouvert pendant le
developpement), la regeneration du client Prisma peut echouer sur
> `EPERM: operation not permitted, rename query_engine-windows.dll.node` : le
> fichier est verrouille par le processus en cours. Arretez le serveur avant de
> reconstruire. Ce n'est PAS un probleme de configuration du projet : un build
> depuis un environnement propre reussit, comme la chaine de mise en production
> (`npm ci` -> `npm run build`) le fait toujours.

> **Regle** : une migration ne supprime jamais une colonne contenant des
> donnees medicales ou financieres sans une migration en deux temps (nouvelle
> colonne, migration des donnees, suppression).

---

## 5. Taches planifiees

| Tache | Frequence | Commande |
|---|---|---|
| Purge de la Corbeille | **toutes les heures** | `npm run corbeille:purger` |
| Sauvegarde de la base | quotidienne | `npm run backup:postgres` |
| Chiffrement + hors site | apres chaque sauvegarde | voir `docs/BACKUP.md` |
| Test de restauration | mensuelle | voir `docs/BACKUP.md` |

**La purge de la Corbeille est indispensable** : sans elle, les elements
expires restent visibles en base indefiniment. Elle applique la suppression
definitive apres expiration de la fenetre de 24 heures, en respectant
l'integrite referentielle.

---

## 6. Supervision

| Point de controle | Methode |
|---|---|
| Application operationnelle | `GET /api/health` → 200 |
| Base accessible | Inclus dans `/api/health` (`baseDeDonnees: "accessible"`) |
| Erreurs applicatives | Journaux JSON (`LOG_LEVEL=info`) |
| Espace disque (documents) | Supervision du volume |
| Age de la derniere sauvegarde | Supervision du repertoire de sauvegarde |

Le point de sante **n'expose aucune information d'infrastructure** (pas de
version de base, pas d'hote, pas de chaine de connexion).

---

## 7. Liste de controle avant mise en service

- [ ] HTTPS actif, certificat valide
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`
- [ ] `SESSION_SECRET` et `PASSWORD_PEPPER` generes et stockes dans le coffre
- [ ] `DATABASE_URL` avec `sslmode=require`
- [ ] Migrations appliquees (`npm run db:migrate:deploy`)
- [ ] Compte medecin cree, **mot de passe initial change**
- [ ] `DOCUMENTS_STORAGE_PATH` hors racine web, sauvegarde incluse
- [ ] Sauvegardes planifiees, chiffrees, **hors site**
- [ ] **Test de restauration effectue**
- [ ] Purge de la Corbeille planifiee (toutes les heures)
- [ ] Supervision du point de sante operationnelle
- [ ] `.env` **non versionne**, droits restreints
- [ ] Mises a jour de securite des dependances suivies (`npm audit`)
- [ ] Localisation des donnees conforme a la juridiction d'exploitation

---

## 8. Mise a jour des dependances de securite

```bash
npm audit              # liste les vulnerabilites connues
npm audit fix          # corrige lorsque c'est compatible
```

Une vulnerabilite **critique ou haute** doit etre traitee avant la mise en
production. Les versions des dependances sont **verrouillees** (`package-lock.json`
versionne) pour que les deploiements soient reproductibles.

---

## 9. Retour arriere

1. **Application** : redeployer la version precedente du build.
2. **Base** : les migrations sont additives ; un retour arriere de l'application
   reste possible sans revenir sur la base. Si une migration devait etre
   annulee, elle necessite une migration inverse ecrite et testee.
3. **Documents** : le repertoire est additif ; aucune suppression automatique.

---

## 10. Ce que ce document ne garantit pas

Le deploiement depend de l'environnement reel choisi (hebergeur, reseau,
reglementation locale). Ce document decrit les exigences et une procedure de
reference ; il **ne constitue pas** une attestation de conformite.**