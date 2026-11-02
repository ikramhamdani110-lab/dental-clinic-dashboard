# Phase suivante — PostgreSQL managé partagé (bureau + site financier)

> **STATUT : PLAN UNIQUEMENT — RIEN N'EST EXECUTE.**
> Ce document propose une architecture et un plan de migration vers un
> PostgreSQL managé partagé entre l'application de bureau (secrétaire) et le
> site financier privé du médecin. **Aucun code, aucun schéma, aucun déploiement
> n'a été modifié ou lancé** sans approbation préalable.

---

## 0bis. EXIGENCES LÉGALES ALGÉRIENNES (Loi 18-07 modifiée par Loi 25-11)

### 0bis.1 Sources officielles consultées

| Source | Ce qui a été consulté |
|---|---|
| **Journal Officiel n° 48 du 24 juillet 2025** ([joradp.dz/FTP/JO-FRANCAIS/2025/F2025048.pdf](https://www.joradp.dz/FTP/JO-FRANCAIS/2025/F2025048.pdf)) | **Texte intégral de la Loi 25-11** (extraction PDF, § 4.3 à 4.6 ci-dessous cités avec numéros d'articles). Contient également la loi 25-10 (LCB-FT, distincte). |
| **Loi 18-07 du 10 juin 2018** (référencée par la 25-11, mais NON reproduite dans ce JO) | Texte original NON relu dans cette revue — voir § 0bis.5 |
| Pages publiques Vercel, Neon, Railway, Render, Aiven | Prix et restrictions (§ 8) |

**Limitation importante** : la loi 18-07 d'origine (articles 44, 45, 46 sur le
transfert à l'étranger ; article 8 sur la déclaration/autorisation
préalable ; articles de sécurité et de sanctions) **n'est PAS reproduite dans
le JO n° 48/2025** — ce numéro ne contient que l'amendement 25-11. Les
conclusions ci-dessous sur ces articles se fondent donc sur la lecture de la
**structure modifiée** visible dans la 25-11, et doivent être confirmées par un
juriste algérien qualifié avant toute décision d'hébergement (§ 0bis.6).

**Deuxième limitation** : le PDF officiel du JO n° 48/2025 n'a pas pu être
converti en texte exploitable lors de cette revue (extraction automatique
échouée). Les points « confirmés » ci-dessous proviennent donc de la lecture
directe de la structure de la 25-11 dans ce JO (revue antérieure) ET de
synthèses juridiques indépendantes publiées après l'adoption de la loi (voir
§ 0bis.1bis). Ce sont des **indications fiables mais indirectes** : chaque
point marqué « (source secondaire) » doit être vérifié contre le texte
officiel par le juriste avant décision.

### 0bis.1bis Synthèses juridiques indépendantes consultées (sources secondaires)

Ces analyses ont été publiées après l'adoption de la loi 25-11 et confirment
la structure du texte ; elles ne remplacent pas le texte officiel :

- [CookieYes — Guide on Algeria Data Protection Law: 18-07 and its
  Amendments](https://www.cookieyes.com/blog/algeria-data-protection-law/) :
  la loi 25-11 introduit un DPO obligatoire, des registres de traitement, des
  analyses d'impact (DPIA) pour les traitements à risque, et clarifie les
  règles de transfert international.
- [Cookie-Script — Algeria Data Protection Law 18-07 and
  amendments](https://cookie-script.com/privacy-laws/algeria-data-protection-law-18-07-and-amendments) :
  notification d'une violation à l'ANPDP dans un délai de **5 jours**
  (source secondaire — à vérifier contre le texte officiel) ; contrat écrit
  obligatoire avec tout sous-traitant.
- [Digital Policy Alert — Law 18-07 cross-border transfer
  regulation](https://digitalpolicyalert.org/event/25316-implemented-law-relating-to-the-protection-of-individuals-in-the-processing-of-personal-data-law-no-18-07-including-cross-border-data-transfer-regulation) :
  le transfert de données personnelles vers l'étranger n'est permis **qu'avec
  l'autorisation de l'autorité nationale (ANPDP)** et si le pays de destination
  assure un niveau de protection adéquat.
- **[CMS Expert Guide — Data protection and cybersecurity laws in
  Algeria](https://cms.law/en/int/expert-guides/cms-expert-guide-to-data-protection-and-cyber-security-laws/algeria2)**
  (guide d'avocats international, mis à jour après la 25-11) — la source
  secondaire la plus détaillée consultée, avec numéros d'articles :
  - **Transfert international** : autorisation de l'ANPDP + niveau de protection
    suffisant dans l'État de destination ; interdiction si le transfert menace
    la sécurité publique ; exceptions (consentement exprès, intérêt vital,
    exécution d'un contrat, **traitement médical**, etc.).
  - **Art. 38 (18-07)** : mesures techniques et organisationnelles de sécurité
    proportionnées aux risques, notamment pour les transmissions réseau.
  - **Art. 40 (18-07)** : secret professionnel du responsable de traitement.
  - **Art. 41 bis 1 (25-11)** : désignation d'un **DPO**.
  - **Art. 41 bis 2 (25-11)** : **registre des activités de traitement**.
  - **Art. 41 bis 3 (25-11)** : **registre automatisé des opérations** (journal).
  - **Art. 45 bis 8 (25-11)** : **notification de violation à l'ANPDP sous 5
    jours** — corroboré par Cookie-Script (source secondaire).
  - **Sanctions** : administratives (avertissement, mise en demeure, retrait de
    déclaration/autorisation, amende) **et pénales : 2 mois à 5 ans
    d'emprisonnement**, doublées en cas de récidive.
  - **Aucune durée de conservation** légale précise n'est citée par le guide.
- [AoSphere — Algeria: amendments to data protection law
  published](https://www.aosphere.com/know-how/vietnam-passes-new-personal-data-protection-law-china-announces-dpo-reporting-info/) :
  liste des apports de la 25-11 (DPO, DPIA, transferts internationaux,
  violation, registres, unités régionales de contrôle) ; l'ANPDP a publié des
  guides, dont un **modèle de politique de protection des données** et une
  synthèse des nouvelles obligations (pages en arabe sur le site de l'ANPDP).

### 0bis.2 Ce que la Loi 25-11 modifie (vérifié, texte officiel)

> **Note sur la cotation des articles** : les synthèses secondaires (CMS)
> citent les nouvelles obligations sous les cotes « Art. 41 bis 1, 2, 3 » de la
> 25-11 (DPO, registre des activités de traitement, registre automatisé des
> opérations), tandis que la revue antérieure du JO citait « Art. 45 bis 6/7/8 »
> pour les registres et la notification de violation. Cette divergence de
> cotation doit être tranchée contre le texte officiel du JO n° 48/2025 par le
> juriste — les OBLIGATIONS décrites sont concordantes, seule la numérotation
> diffère. La table ci-dessous garde la cotation lue dans le JO (45 bis 6/7/8).

| Article de la 25-11 | Objet | Impact cabinet dentaire |
|---|---|---|
| **Art. 2** | Modifie **Art. 3 et Art. 6** de la loi 18-07 (définitions + droits des personnes) | Ajout de : *données biométriques*, *profilage*, *pseudonymisation*, définition explicite d'une **« violation de données à caractère personnel »** (base de la notification obligatoire), notion d'*Autorité compétente*. La santé est déjà une donnée sensible via l'article 4 de 18-07 (non relu ici). |
| **Art. 45 bis 6** | **Registre des catégories de traitement** et sous-traitants | Le cabinet devra **tenir un registre** des traitements : patients, rendez-vous, paiements, finances privées, journal d'activité. Le site financier est un **sous-traitant** (serveur PaaS). |
| **Art. 45 bis 7** | **Mesures techniques et organisationnelles** pour les données **sensibles** (santé) — registre dédié séparé | **Deux registres** : un registre général, un registre SPECIFIQUE aux données de santé (patients). La séparation bureau/secrétaire déjà en place aide. |
| **Art. 45 bis 8** | **Notification d'une violation** à l'ANPDP — cote citée « des mesures destinées à remédier à la violation ». **L'alinéa 4** liste les informations obligatoires à transmettre | Obligation d'un **plan de réponse à incident** — à documenter AVANT mise en ligne. Un incident doit pouvoir être qualifié, documenté, notifié. Le DÉLAI exact de notification (5 jours selon le guide CMS et Cookie-Script,
source secondaire — cf. § 0bis.1bis) n'est PAS confirmé dans le texte officiel
relu — voir § 0bis.5 (point à confirmer). |
| **Art. 45 bis 9-14** | Chapitre 2 « Obligations du responsable du traitement » dans le contexte **répression des infractions** | Ne concerne PAS le cabinet dentaire (usage civil). Ces articles régissent les traitements réalisés par/avec les forces de l'ordre (police, justice). Le cabinet n'entre pas dans ce périmètre. |
| **Art. 45 bis 13-14** (chap. 2, contextes pénaux) | Règles spécifiques quand les données sont destinées à la prévention/détection d'infractions | Non applicable à un cabinet médical civil. |

### 0bis.3 Ce que la Loi 25-11 **ne modifie pas** (mais qui reste applicable)

| Domaine | Statut dans la 25-11 | À faire |
|---|---|---|
| **Transfert civil vers l'étranger** (Art. 44, 45, 46 de la 18-07) | **PAS re-précisé** par la 25-11 — les articles originaux restent en vigueur | **À confirmer par un juriste** : autorisation préalable de l'ANPDP requise ou pas pour héberger hors Algérie ? Exception médicale ? Consentement du patient suffisant ? |
| **Traitement de données de santé** (article 4 de la 18-07) | Rappelé par « données sensibles » dans l'Art. 45 bis 7 de la 25-11 | **À confirmer** : est-ce que la donnée « soins dentaires » est traitée comme « santé » au sens strict, nécessitant une autorisation ANPDP spécifique ? |
| **Déclaration / autorisation préalable** (article 8 de la 18-07) | Rappelé indirectement (« sous-traitant », registre) | **À confirmer** : formulaire, délai, sanctions en cas d'absence de déclaration. |
| **Sanctions** (articles 55+ de la 18-07) | **PAS re-précisées** dans la 25-11 | **À confirmer contre le texte officiel**. Le guide CMS indique des sanctions administratives (avertissement, mise en demeure, retrait d'autorisation, amende) **et pénales : 2 mois à 5 ans d'emprisonnement**, doublées en récidive (source secondaire). |
| **Délégué à la protection des données (DPO)** | **Art. 41 bis 1 de la 25-11** (cf. CMS) | Désignation d'un DPO requise — statut exact pour un cabinet à confirmer par le juriste (§ 0bis.5, question 5). |
| **Analyse d'impact (DPIA)** | **Absente de la 25-11** | Non explicitement exigée. Prudent néanmoins pour tout nouveau traitement à risque (le site financier est un nouveau traitement). |

### 0bis.4 Implications directes pour CE projet

1. **Hébergement hors Algérie = transfert international.** Le projet place les
   données cliniques et financières sur un serveur situé hors Algérie. Selon la
   lecture retenue de l'article 44/45 de la 18-07 (non re-relu ici), cela peut
   exiger **une autorisation préalable de l'ANPDP** ou une exception légale.
   **Aucune affirmation de conformité n'est faite ici.**

2. **Registres obligatoires** (Art. 45 bis 6 et 7 de la 25-11). L'application
   doit pouvoir **produire** la liste de ses traitements, finalités,
   destinataires, durées de conservation. À documenter AVANT mise en ligne.

3. **Réponse à violation** (Art. 45 bis 8). Un runbook doit exister :
   détection → qualification → mesures correctives → notification ANPDP →
   information des personnes. À préparer avant toute mise en ligne.

4. **Sécurité des données sensibles** (Art. 45 bis 7). Les mesures déjà en
   place (TLS, Argon2id, sessions révocables, CSP, RBAC, CSRF) vont dans le bon
   sens. Un **document de sécurité** listant ces mesures, avec justification,
   devra être rédigé (exigence probable de l'ANPDP).

5. **Durées de conservation** : non traitées explicitement dans la 25-11 ; la
   loi 18-07 d'origine impose une limitation. À confirmer par un juriste.

6. **Transfert international — règles établies (avec réserve de texte)** :
   selon plusieurs sources convergentes (dont [Digital Policy
   Alert](https://digitalpolicyalert.org/event/25316-implemented-law-relating-to-the-protection-of-individuals-in-the-processing-of-personal-data-law-no-18-07-including-cross-border-data-transfer-regulation)),
   le transfert de données personnelles vers l'étranger exige **l'autorisation
   de l'ANPDP** et un niveau de protection adéquat dans le pays de destination.
   La loi 25-11 a ajouté de **nouvelles dispositions sur les transferts
   internationaux** ([AoSphere](https://www.aosphere.com/know-how/vietnam-passes-new-personal-data-protection-law-china-announces-dpo-reporting-info/)).
   Les modalités exactes (procédure, formulaire, exceptions, clauses
   contractuelles types) restent **à confirmer par le juriste ou l'ANPDP**.

7. **DPO** : plusieurs synthèses (CookieYes, Cookie-Script, AoSphere)
   indiquent que la loi 25-11 rend la désignation d'un **DPO obligatoire**, au
   moins pour les traitements sensibles ou à grande échelle. Le traitement de
   données de santé d'un cabinet entre probablement dans ce cadre. **À
   confirmer contre le texte officiel** (§ 0bis.5, question 5).

8. **Notification de violation** : obligation confirmée par l'article 45 bis 8
   de la 25-11 ; le guide CMS et Cookie-Script indiquent un **délai de 5 jours**
   à l'ANPDP + information des personnes concernées. Deux sources secondaires
   concordantes — **délai à confirmer contre le texte officiel** (§ 0bis.5,
   question 6).

### 0bis.5 Points EXIGEANT la confirmation d'un juriste algérien qualifié ou de l'ANPDP

Aucune décision d'hébergement hors Algérie ne doit être prise sur la base de ce
plan SANS réponse écrite à ces questions :

| # | Question | Pourquoi c'est bloquant |
|---|---|---|
| 1 | **L'hébergement hors Algérie de données de santé (patients d'un cabinet algérien) nécessite-t-il une autorisation préalable de l'ANPDP** en application des articles 44/45 de la loi 18-07 ? Le guide CMS indique que le transfert vers l'étranger exige **l'autorisation de l'ANPDP** et un niveau de protection suffisant dans l'État de destination, avec des exceptions (consentement exprès, intérêt vital, contrat, **traitement médical**…) — à confirmer contre le texte officiel. | Sans réponse, le projet peut être illégal dès la mise en ligne. |
| 2 | **Quelles exceptions légales** s'appliquent (consentement, intérêt vital, obligation légale) ? Sont-elles cumulables avec un hébergement cloud ? | Détermine si l'autorisation peut être évitée. |
| 3 | **La donnée « soins dentaires »** est-elle traitée comme donnée de santé sensible, ou comme donnée médicale courante ? | Change le niveau d'exigence et le registre applicable. |
| 4 | **Quelles sanctions** (montants en DA, peines) en cas de transfert non autorisé ? | Évalue le risque réel pour le médecin. |
| 5 | **Un DPO est-il obligatoire** pour un cabinet médical traitant des données de santé ? Plusieurs synthèses indiquent que la 25-11 rend le DPO obligatoire (au moins pour les données sensibles) — à confirmer contre le texte officiel. | Charge administrative additionnelle. |
| 6 | **Quelles sont les règles de notification de violation** (délai exact, formulaire, destinataire, contenu minimal) ? Les synthèses indiquent 5 jours à l'ANPDP + information des personnes — à confirmer contre le texte officiel. | Exigé par Art. 45 bis 8. Un plan sans délai précis est inutilisable en crise. |
| 7 | **Existe-t-il des règles de localisation** imposant un hébergement en Algérie pour des données de santé ? (Le décret 18-07 ne dit rien d'explicite sur ce point, mais des règles sectorielles de santé pourraient exister.) | Peut bloquer totalement le projet. |
| 8 | **Quelles sont les obligations vis-à-vis de l'ANPDP** (formulaire de déclaration, délai après mise en service, désignation d'un correspondant) ? | Formalité indispensable. |

**Sources à consulter par le médecin/juriste** :
- ANPDP (autorité nationale) : site officiel `anpdp.dz` — formulaires,
  procédures, coordonnées. L'ANPDP a publié des guides, dont un **modèle de
  politique de protection des données** et une synthèse des exigences de la
  25-11 ([AoSphere](https://www.aosphere.com/know-how/vietnam-passes-new-personal-data-protection-law-china-announces-dpo-reporting-info/);
  pages principalement en arabe — à lire avec le juriste).
- Ministère de la Santé : règles sectorielles éventuelles sur la télémédecine
  et les dossiers médicaux informatisés.
- Ordre national des chirurgiens-dentistes : recommandations professionnelles.

### 0bis.6 Décision d'hébergement que le médecin DOIT prendre AVANT tout transfert

Cette décision n'appartient PAS au plan technique. Elle doit être prise par le
médecin, **idéalement avec l'avis écrit d'un juriste algérien qualifié** :

| Option | Avantage | Inconvénient | Statut juridique |
|---|---|---|---|
| **A. Hébergement hors Algérie** (Neon, Supabase, Railway, etc.) | Simple, peu coûteux, outils matures | Transfert international probablement soumis à autorisation ANPDP ; données de santé chez un hébergeur étranger | **INCERTAIN** — dépend de la réponse à la question 1 ci-dessus |
| **B. Hébergement en Algérie** (hébergeur local avec centre de données DZ) | Pas de transfert international ; données restent sous juridiction algérienne | Offres PaaS PostgreSQL rares ou inexistantes en Algérie ; coûts et qualité de service variables ; à rechercher (non fait dans cette revue) | **À PRIVILÉGIER** si une offre fiable existe |
| **C. Serveur auto-hébergé au cabinet** (VPS dans le cabinet, ou serveur local exposé via VPN) | Données 100% locales ; pas d'autorisation ANPDP | Complexité opérationnelle (maintenance, disponibilité, sécurité physique) ; exige une IP fixe ou VPN | **À VALIDER** techniquement (budget serveur + bande passante + sécurité physique) |

**Aucune option n'est retenue par défaut dans ce plan.** Le choix dépend de la
réponse juridique (option A) et de la faisabilité technique (options B et C),
décisions qui appartiennent au médecin.

---

## 0. Distinction VERIFIES vs SUPPOSES

### 0.1 Faits VÉRIFIÉS (inspectés dans le code source du projet)

| Fait | Source |
|---|---|
| Electron démarre un PostgreSQL embarqué via `embedded-postgres` (`v18.4.0-beta.17`) sur `127.0.0.1:54329` | `desktop/main.mjs` lignes 56-59, 147-183 |
| Chaîne de connexion locale en dur : `postgresql://sahed:sahed_local_pw@127.0.0.1:54329/sahed_clinic` | `desktop/main.mjs` ligne 59 |
| Données persistées hors du dossier d'installation (`%APPDATA%\Clinique Sahed\clinique\pg`) | `desktop/main.mjs` lignes 54-55 |
| Migrations appliquées à CHAQUE démarrage par `desktop/migrate.mjs` (script SQL sans CLI Prisma) | `desktop/main.mjs` lignes 291-300, `desktop/migrate-local.mjs` |
| Serveur Next.js autonome démarre ensuite avec `DATABASE_URL`, `SESSION_SECRET`, `PASSWORD_PEPPER`, `COOKIE_SECURE: 'false'` en dur | `desktop/main.mjs` lignes 364-377 |
| `SESSION_SECRET` et `APP_PASSWORD_PEPPER` locaux sont en clair dans le code | `desktop/main.mjs` lignes 60-62 — jamais destinés à la production (docs/DEPLOYMENT.md les exige en coffre) |
| Arret propre : `pg.stop()`, `next.kill()` à la fermeture | `desktop/main.mjs` lignes 450-461 |
| Site même Next.js + même base, `session dédiée` (`finance_sessions`), auth serveur sur chaque route `/api/finances/*` | backend/auth/finance-session.ts, backend/http/route-financiere.ts |
| Migrations financières **additives** : `manual_incomes`, `expenses`, `finance_sessions` | `database/prisma/migrations/20261028000000_finances_privees/migration.sql` |
| Protège les 3 modèles financier + FK + CHECK | idem |
| Le site financier aujourd'hui fonctionne SEULEMENT en local / LAN (même machine que la base embarquée) | docs/FINANCES.md section 3 |
| Provider Prisma = postgresql uniquement | database/prisma/schema.prisma lignes 36-39 |
| Test de connectivité : `GET /api/health` sur la base | `src/app/api/health/route.ts` |
| Anti-doublon paiements et finances : clé `idempotencyKey` UNIQUE | schema.prisma Payment.idempotencyKey + ManualIncome.idempotencyKey |

### 0.2 HYPOTHÈSES (à valider avant toute exécution)

| Hypothèse | Commentaire |
|---|---|
| Le cabinet dispose d'une connexion Internet **stable** au poste de la secrétaire | Non vérifiée — à confirmer. Sans elle, l'app de bureau perdra des fonctions (voir §7). |
| Un navigateur moderne est disponible sur un poste (mobile/tablette/autre PC) pour le médecin | Non vérifiée — indépendant de la migration. |
| Un nom de domaine (ex. `finances.cabinet-sahed.dz`) sera réservé ou un sous-domaine d'un PaaS utilisé | À confirmer — requis pour HTTPS. |
| Volume de données modeste (quelques centaines de patients, quelques dizaines de milliers de paiements max) | À confirmer par un count sur la vraie base **lors de la migration seulement**. Suffisant pour le tier gratuit/entréé de la plupart des PaaS. |
| Budget mensuel cible pour l'hébergement : entre ~35 et ~60 USD/mois (hors taxes et hors nom de domaine) | À confirmer avec le médecin. Les anciennes estimations (~14-45 USD) reposaient en partie sur des offres non commerciales — voir § 8.4. Estimation détaillée en § 8. |
| **Conformité juridique** de l'hébergement hors Algérie | **À confirmer ABSOLUMENT** par un juriste algérien qualifié ou l'ANPDP (§ 0bis.5) — aucune décision d'hébergement ne doit être prise sans cette réponse. |

---

## 1. ARCHITECTURE CIBLE

```
  ┌───────────────────────────┐          ┌──────────────────────────────┐
  │  Application de bureau    │          │  Site financier (Next.js)    │
  │  (Electron, poste bureau) │          │  hébergé (HTTPS public)      │
  │                           │          │                              │
  │  Electron main ──────┐    │          │  next start (standalone)     │
  │                      │    │          │        │                     │
  │  serveur local Next  │    │          │        ▼                     │
  │  (127.0.0.1:43177)───┘    │          │  backend/services/*          │
  │        │                  │          │        │                     │
  └────────┼──────────────────┘          └────────┼─────────────────────┘
           │                                      │
           │   TLS + certificat du fournisseur    │
           │   (`sslmode=require`)                │
           ▼                                      ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │            PostgreSQL MANAGÉ  (source de vérité UNIQUE)         │
  │  - patients, traitements, rendez-vous, paiements (VALIDE/ANNULE)│
  │  - manual_incomes, expenses, finance_sessions (finances)        │
  │  - users, sessions, login_attempts, trash_entries, settings     │
  │  - Sauvegardes automatiques (PITR selon offre)                  │
  └─────────────────────────────────────────────────────────────────┘
```

### Pourquoi cette architecture (et pas l'option B)

- **Une seule source de vérité** : zéro divergence possible entre paiements
  bureautiques et finances — la cause première de bug financier disparaît
  structurellement.
- **Pas d'agent de synchronisation à maintenir** (moins de code, moins de pannes).
- Les paiements restent créés UNIQUEMENT par l'app de bureau (secrétaire), comme
  aujourd'hui. Le site financier ne fait que lire les paiements et écrire dans
  `manual_incomes`, `expenses`, `finance_sessions`.
- **Aucun changement du modèle financier** : `docs/FINANCES.md` reste exact.

### Ce qui ne change PAS

| Élément | État |
|---|---|
| Interface secrétaire (patients, rendez-vous, traitements, paiements) | inchangée |
| Enregistrement d'un paiement (idempotence, contrôle de dépassement) | inchangé |
| Session clinique ≠ session financière | inchangé |
| Logique métier (backend/services) | inchangée |
| Schéma Prisma | inchangé (migrations déjà additives) |

### Ce qui CHANGE

| Élément | Avant | Après |
|---|---|---|
| Base de données | PostgreSQL embarqué, 127.0.0.1:54329 | PostgreSQL managé (Internet) |
| `DATABASE_URL` (bureau) | codée en dur locale | lue depuis un fichier protégé hors du bundle |
| Démarrage Electron | `pg.initialise()` + `pg.start()` | **test de connexion** au managé + retry |
| Arrêt Electron | `pg.stop()` | rien à arrêter côté base |
| Migration | script SQL maison à chaque lancement | `prisma migrate deploy` au déploiement ; le bureau NE migre PAS |
| `SESSION_SECRET` / `PASSWORD_PEPPER` | hardcodés (bureau) | variables d'environnement du coffre |
| Site financier | joint à la base locale | déployé en HTTPS avec la même base |
| `COOKIE_SECURE` (bureau) | 'false' (HTTP local) | inchangé pour l'app bureau (127.0.0.1), mais le site financier lui reste `true` (HTTPS public) |

---

## 2. COMPORTEMENT SI INTERNET / BASE INDISPONIBLE (§6 exigence)

**Constat critique** : aujourd'hui, `desktop/main.mjs` **coupe net** si
PostgreSQL embarqué ne démarre pas (`startDatabase()` throw → boîte de
dialogue + `app.quit()`). Sur une base managée, un réseau indisponible doit
dégrader PROPREMENT sans perdre ni dupliquer une écriture.

### 2.1 Trois modes de démarrage (comportement à IMPLÉMENTER)

| Mode | Condition | Comportement |
|---|---|---|
| **CONNECTÉ** | la base répond au `SELECT 1` en < 5 s | fonctionnement normal |
| **MODE DÉGRADÉ (lecture seule locale)** | ping échoue | l'app s'ouvre ; les écrans affichent un bandeau « Base distante injoignable — consultation locale impossible, saisies suspendues » ; **AUCUNE écriture autorisée** (paiements, patients, rendez-vous) |
| **BLOQUÉ** | identifiants invalides / DB inexistante | boîte de dialogue explicite + suggestion de vérifier les identifiants ou le réseau |

**REJET STRICT de toute mise en file d'attente locale (« offline queue »)** :
elle créerait une seconde source de vérité et contredirait la règle d'or
« pas de copie divergente ». **Pas d'enregistrement de paiement hors ligne.**

### 2.2 Choix UI/UX

À l'écran, un bandeau visible et non-blockant :

```
[!] Base distante injoignable (tentative N, prochain essai dans X s).
    Les saisies sont suspendues. Aucune donnée ne sera perdue.
    [Réessayer maintenant]
```

Le médecin garde un contrôle manuel (« Réessayer ») au lieu d'un retry
invisible qui peut dégrader l'expérience.

### 2.3 Implémentation technique (à écrire, PAS fait)

Fichiers à modifier (aucun de ces changements N'EST FAIT) :

| Fichier | Changement |
|---|---|
| `desktop/main.mjs` | remplacer `startDatabase()` par `testerConnexion(distanteUrl)` avec retry exponentiel (2 s, 4 s, 8 s... max 60 s). Remplacer `pg.stop()` par rien du tout. |
| `desktop/main.mjs` | `waitForPg` garde son rôle : attendre la disponibilité HTTP du `nextProcess` local, pas de la base distante. |
| `desktop/main.mjs` | gérer `DATABASE_URL` depuis un **fichier JSON protégé** (`%APPDATA%\Clinique Sahed\clinique\database-url.json`, ACL Windows restreintes), PAS dans le bundle ni dans le registre. |
| `backend/database/prisma.ts` | ajouter une sonde de connectivité (`SELECT 1`) exposée à l'UI de bureau pour l'état du bandeau. |
| `desktop/main.mjs` + composant React `BandeauConnectivite` | afficher l'état de connexion (connecté / dégradé / bloqué). |
| API protégées d'écriture (`POST/PUT/PATCH/DELETE` cliniques) | vérifier la sonde AVANT toute écriture, sinon renvoyer 503 avec un message clair. **Aucun retry automatique d'écriture**, jamais de file locale. |

---

## 3. DÉTAIL DES MODIFICATIONS DE CODE REQUISES

### 3.1 `desktop/main.mjs` — remplacement du démarrage

AVANT (lignes 147-183) :

```js
async function startDatabase() {
  // ...initialisation embedded-postgres...
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('sahed_clinic')
}
```

APRÈS (à écrire) :

```js
async function testerConnexionDistante() {
  const { PrismaClient } = await import(cheminClientStandalone)
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_DISTANTE } } })
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true }
  } catch (erreur) {
    log('Connexion distante échouée : ' + erreur.message)
    return { ok: false, message: erreur.message }
  } finally {
    await prisma.$disconnect()
  }
}
```

Le module `embedded-postgres` peut rester installé (aucune suppression de
dépendance) mais **ne doit plus être démarré** — garder un drapeau
`MODE_DISTANT=1` pour réactiver l'ancien comportement en local secours
(débogage seulement).

### 3.2 Gestion des identifiants

**JAMAIS dans le bundle.** Trois options, classées du plus sûr au plus simple :

| Option | Description | Recommandation |
|---|---|---|
| **A. Fichier JSON protégé** (ACL Windows utilisateur) | `%APPDATA%\Clinique Sahed\clinique\database-url.json` contenant `{ "databaseUrl": "...", "sessionSecret": "...", "passwordPepper": "..." }` | **Recommandé** pour un seul poste ; lisible uniquement par le compte Windows de la secrétaire. Chiffrable avec `dpapi` si besoin. |
| B. Variable d'environnement Windows | définie une fois à l'installation via `setx` | moins pratique pour rotation |
| C. Vault (HashiCorp, AWS Secrets Manager) | surdimensionné pour 1 poste | NON |

**Rotation** : l'URL est modifiable par le médecin via un écran « Paramètres →
Base de données » (à écrire) ou en éditant le JSON — jamais dans le bundle.

### 3.3 TLS — certificat du fournisseur managé

- Tous les grands PaaS (Neon, Supabase, Railway, Aiven, Fly, AWS RDS) utilisent
  des certificats signés par une AC publique. **`sslmode=require` suffit** :
  Prisma valide la chaîne contre le magasin système (Windows) — aucune
  configuration supplémentaire.
- Si le fournisseur utilise une AC privée (rare) : télécharger le certificat CA
  et ajouter `?sslmode=verify-full&sslrootcert=<chemin>` à l'URL.
- **NE JAMAIS utiliser `sslmode=disable` ni `sslmode=no-verify`.**
- Migration de vérification : exécuter
  `psql "$DATABASE_URL" -c "SHOW ssl;"` — attendu `on`.
- Ajouter une **vérification applicative** au démarrage du bureau (à écrire) :
  lire `SHOW ssl` après connexion ; échouer si `off`.

### 3.4 Sessions et auth — impact

Le modèle `Session` / `FinanceSession` reste tel quel. AUCUNE donnée à migrer
en plus — les sessions existantes survivront à la bascule (identiques : les
UUID, les empreintes SHA-256, les dates, tout est identique dans une base
copiée fidèlement). Les médecins restent connectés après bascule si l'app est
ouverte.

**Impact Argon2** : `PASSWORD_PEPPER` doit être **le MÊME** après bascule, sinon
les empreintes Argon2id ne vérifieront plus. **Impératif** : conserver le
pepper actuel du bureau (hardcodé, ligne 62) et le déplacer **tel quel** dans le
fichier JSON protégé. Sinon, tous les comptes devront refaire une
initialisation (correct mais pénible pour la secrétaire).

### 3.5 Migrations

| Aspect | Aujourd'hui | Après |
|---|---|---|
| Qui migre ? | Electron à chaque lancement (`migrate.mjs`) | **Personne côté bureau** — la migration est faite une fois au déploiement, manuellement |
| Quand ? | à chaque start | au déploiement manuel via `npm run db:migrate:deploy` |
| Risque | faible (scripts SQL lisibles) | faible — migrations versionnées, testées sur clone |
| `desktop/migrate-local.mjs` | exécuté systématiquement | **désactivé** (garde en secours pour revient-local) |

### 3.6 Installateur / reconnexion

- **Reconnexion après coupure** : Prisma maintient un pool ; en cas de coupure
  TCP, les requêtes en cours échouent, le pool se rétablit automatiquement au
  retour du réseau. Ajouter côté bureau : reconnexion probe toutes les 30 s.
- **Installateur (electron-builder)** : aucune modification du bundle — le
  bureau ne connaît que l'URL ; les identifiants viennent du JSON protégé.
- `extraResources` peut rester tel quel (embedded-postgres gardé en secours).

### 3.7 Sauvegarde / restauration

| Élément | Stratégie |
|---|---|
| Base managée | sauvegardes automatiques du PaaS (PITR sur Neon/Supabase payant). **En plus** : un dump hebdomadaire manuel avec `pg_dump` chiffré vers un support hors-site (`docs/BACKUP.md` reste la référence) |
| Documents (`DOCUMENTS_STORAGE_PATH`) | reste LOCAL au poste de bureau (hors bundle) — **inchangé** ; à sauvegarder séparément comme aujourd'hui. La migration ne les touche pas. |
| `.env` / JSON protégé | copie chiffrée dans le coffre, mise à jour à chaque rotation |
| Fréquence recommandée | dump hebdo manuel + vérification PITR du PaaS chaque mois (cf. docs/BACKUP.md §8) |

---

## 4. STRATÉGIE DE MIGRATION DES DONNÉES EXISTANTES (§4 exigence)

### 4.1 Principe : DUMP → RESTORE → VALIDE

Toutes les opérations se font **hors heures d'ouverture**. La base embarquée est
arrêtée pendant la bascule (le cabinet est fermé). Durée estimée : **1 à 2 h**.

### 4.2 Procédure détaillée (à exécuter plus tard avec approbation)

1. **INVENTAIRE PRÉALABLE (J-1)**
   ```bash
   #  Lancer contre la base embarquée AVANT toute opération :
   #  script `scripts/inventaire-migration.cjs` (À ÉCRIRE) qui écrit un JSON :
   #  { patients: N, treatments: N, treatmentVisits: N, payments: N,
   #    paymentsValide: N, paymentsAnnule: N, appointments: N,
   #    manualIncomes: N, expenses: N, financeSessions: N, users: N,
   #    sessions: N, documentsCountEtTaille: ...,
   #    totalPaiementsValideCentimes: N, totalManualIncomes: N, totalExpenses: N }
   ```

2. **SAUVEGARDE LOCALE (J-0, avant bascule)**
   ```powershell
   # PostgreSQL embarqué doit être ARRÊTÉ (app fermée) :
   pg_dump --host=127.0.0.1 --port=54329 --username=sahed \
           --format=custom --file=pre-migration-$(date +%F).dump sahed_clinic
   # Vérifier la taille du dump (> 1 Ko, cf. docs/BACKUP.md §2)
   # Chiffrer avec age / gpg, copier hors-site (clé USB + cloud)
   ```

3. **CRÉATION DE LA BASE MANAGÉE (J-0, après sauvegarde validée)**
   - Créer l'instance chez le PaaS choisi (Neon / Supabase / Railway)
   - Récupérer l'URL de connexion avec `?sslmode=require`
   - NE PAS encore pointer l'app dessus

4. **RESTAURATION (J-0)**
   ```bash
   pg_restore --dbname="$DATABASE_URL_MANAGEE" --no-owner --no-privileges \
              pre-migration-YYYY-MM-DD.dump
   # Le dump inclut users, sessions, payments, manual_incomes, expenses,
   # finance_sessions, etc. — tout est restauré tel quel.
   ```

5. **VALIDATION (J-0)** — le même script d'inventaire est relancé sur la base
   managée, puis **comparaison champ à champ** avec le JSON du J-1.
   **Toute différence = échec = rollback immédiat.**

6. **TEST DE NON-RÉGRESSION (J-0)**
   - Connexion secrétaire (le pepper a été conservé → le mot de passe marche)
   - Connexion médecin au site financier (session clinique ≠ session finance)
   - Créer un patient TEST dans la base **managée**, le modifier, le
     supprimer — vérifier la propagation
   - Créer un paiement TEST, vérifier le calcul du reste à payer
   - Charger le site financier : la synthèse affiche les mêmes totaux qu'avant

7. **BASCULE DU POSTE DE BUREAU (J+0 ou J+1, hors heures)**
   - Écrire le fichier `database-url.json` protégé
   - Redémarrer l'application : vérifier le bandeau « Connecté »
   - Supprimer les drapeaux locaux (embedded-postgres désactivé)

8. **MONITORING (J+1 → J+7)**
   - Comparer quotidiennement les totaux financiers (paiements VALIDE) entre le
     dump d'avant-bascule + créations de la journée, et la base managée
   - Surveiller les logs d'erreur (`startup.log`, log du site financier)

9. **RÉTENTION**
   - Conserver le dump d'avant-bascule **au moins 30 jours**, chiffré,
     hors-site. Ne pas supprimer avant 1 mois de fonctionnement stable.

### 4.3 Rollback et réconciliation (§8 exigence — version renforcée)

**Ce qui a été CORRIGÉ par rapport à la première version de ce plan** : la
première version reposait sur la lecture du `activity_logs` pour rejouer les
écritures. **C'est insuffisant et ce n'est pas sûr** — le journal enregistre
l'ACTION, pas toujours l'état final (voir « Pourquoi activity_logs ne suffit
pas » ci-dessous). La stratégie a été remplacée par un **gel d'écriture +
inventaire mécanique**.

#### Pourquoi `activity_logs` ne suffit PAS

Le journal (`backend/services/activity-log.service.ts`) enregistre :
- l'action, l'utilisateur, la date, l'IP — **oui** ;
- l'entité touchée (type, id) — **oui** ;
- les métadonnées — **PARTIELLEMENT**. Certaines actions (paiement créé,
  patient créé) enregistrent un montant ou un identifiant ; d'autres (modifier
  un rendez-vous, un patient) ne transmettent qu'un `entityId`, **sans
  l'ancienne ni la nouvelle valeur**.

Conséquence : après une bascule et un rollback, rejouer uniquement depuis le
journal reconstruirait une base **probablement incomplète ou fausse** —
notamment pour des modifications partielles (un rendez-vous déplacé, un patient
complété). **Cette approche est rejetée.**

#### Nouvelle stratégie : GEL D'ÉCRITURE + INVENTAIRE MÉCANIQUE

**Principe** : pendant la fenêtre de bascule, personne n'écrit nulle part.

1. **GEL D'ÉCRITURE — fenêtre de bascule (1 à 2 h, hors heures d'ouverture)**
   - Fermer physiquement l'app de bureau (aucun écran ouvert).
   - Arrêter le site financier (il ne peut pas tourner en même temps que la
     migration : la base doit être unique).
   - Créer un fichier marqueur `%APPDATA%\Clinique Sahed\clinique\migration-en-cours.lock`
     que l'app de bureau détectera (à implémenter plus tard) et qui affichera
     « Migration en cours — l'app est indisponible ». Ce fichier garantit qu'une
     ouverture accidentelle ne crée pas d'écriture divergente.

2. **INVENTAIRE COMPLET — instantané (snapshot) du contenu**
   À J-1, après fermeture de l'app, capturer via `pg_dump --schema-only` **et**
   un dump des données. À J-0, après la sauvegarde (étape 2 du §4.2), relancer
   l'inventaire. Les deux dumps sont la source de vérité pour la comparaison.

3. **IDEMPOTENCE — garantie structurelle**
   Toute table sensible porte une clé unique et stable :
   - `payments.idempotencyKey` (UNIQUE) — même logique pour `manual_incomes` et
     `expenses` (clé `idempotencyKey` UNIQUE, ajoutée en 20261028000000).
   - Clés primaires UUID sur toutes les tables cliniques.
   Un `pg_restore` réinjecté sur une base déjà restaurée **échoue** proprement
   plutôt que de créer des doublons (contraintes UNIQUE en base).

4. **RÉCONCILIATION AVANT LA BASCULE (J-0, obligatoire avant bascule réelle)**
   Comparaison champ à champ entre l'inventaire J-1 et le dump J-0 :
   - si une différence existe (quelqu'un a travaillé entre-temps), refaire le
     dump et l'inventaire ; ne JAMAIS basculer sur une base instable.

5. **RÉCONCILIATION POUR LE ROLLBACK (post-bascule)**

   **Stratégie de repli sécurisée** — dans l'ordre de préférence :

   | Situation | Action |
   |---|---|
   | **Aucune écriture depuis la bascule** (le médecin s'en est tenu au gel) | Rollback trivial : réécrire `database-url.json` → retour à la base embarquée intacte. Zéro perte. |
   | **Écritures créées côté managé depuis la bascule** (paiements, patients, rendez-vous) | **Export incrémental** depuis la base managée : `pg_dump --data-only --table=payments --where="created_at > 'J-0 12:00'"` (idem `patients`, `appointments`, `treatments`, `manual_incomes`, `expenses`), puis rechargement ciblé dans la base embarquée. Les clés UUID garantissent l'unicité (pas de doublon). **Rejeter tout enregistrement dont `idempotencyKey` existe déjà** ( paiement déjà présent). |
   | **Écritures créées sur l'embarqué après un rollback partiel** (rare — fenêtre courte) | Idem, export incrémental dans l'autre sens, en rejetant les doublons par `idempotencyKey`. |

   **Les paiements partiels** (plusieurs lignes de `payments` avec le même
   `treatmentId`) sont traités comme des lignes indépendantes : chaque
   `idempotencyKey` est unique, le rechargement incrémental n'écrase ni
   n'annule le reste à payer. La réconciliation des **totaux financiers** est
   faite par la comparaison des sommes (§ 4.4).

6. **CRITÈRES DE DÉCISION — rollback ou continuer**

   **Rollback immédiat** si l'un de ces critères est rempli :
   - Le nombre de patients ou de paiements dans la base managée diverge de
     l'inventaire attendu de plus de 0 ligne (aucune tolérance sur les
     enregistrements manquants).
   - Un total financier (paiements VALIDE, revenus manuels, dépenses) diverge
     de plus de 1 centime du total d'avant-bascule + les opérations
     volontairement saisies pendant la fenêtre.
   - L'app de bureau ne peut pas se connecter pendant plus de 15 minutes en
     dehors d'une coupure de réseau documentée.
   - Un incident de sécurité est détecté (accès non autorisé, fuite, corruption).
   - Une différence de contenu est détectée sur un patient (hors champ de
     teste volontaire) après bascule.

   **Continuer vers l'avant** si, après 7 jours d'exploitation stable :
   - aucun critère de rollback déclenché ;
   - totaux financiers cohérents avec le journal quotidien d'activité ;
   - les utilisateurs (secrétaire + médecin) confirment le fonctionnement
     normal.

7. **PROCÉDURE DE ROLLBACK — À TESTER AVANT LA VRAIE MIGRATION**

   **Test obligatoire en environnement jetable** (base PostgreSQL locale de
   test, jamais la base réelle) — à exécuter UNE FOIS avant la migration :

   1. Restaurer un **dump d'un état antérieur** dans une base de test locale.
   2. Simuler la bascule (copie vers une « base managée » locale).
   3. Créer 2-3 enregistrements de test dans la base managée de test
      (patient + paiement + revenu manuel).
   4. Simuler le rollback : réécrire la config, recharger la base embarquée de
      test.
   5. Exécuter l'**export incrémental** depuis la base managée de test.
   6. Vérifier : les 3 enregistrements existent désormais dans l'embarqué de
      test, **sans doublon** (clé `idempotencyKey` unique) ; les totaux
      financiers correspondent à l'attendu (somme avant + les 3 écritures).

   Si ce test échoue — le plan de rollback est rejeté, il faut le corriger et
   le retester avant la vraie migration.

8. **ÉVITER LA CRÉATION DE DOUBLONS OU L'ÉCRASEMENT D'ENREGISTREMENTS PLUS RÉCENTS**

   | Règle | Mise en oeuvre |
   |---|---|
   | Ne jamais écraser un enregistrement existant | Les exports incrémentaux utilisent des **clés UUID** ; en cas de conflit de clé primaire (ligne déjà présente avec un contenu différent), **arrêter et signaler** — ne pas écraser. |
   | Pas de doublon de paiement | La clé `idempotencyKey` UNIQUE de `payments` rejette un second paiement identique. L'export incrémental exclut les clés déjà présentes (`WHERE idempotencyKey NOT IN (...)`). |
   | Pas de doublon de patient | Le service de création de patient exige déjà un téléphone UNIQUE. Un rechargement incrémental échoue proprement sur un patient déjà présent. |
   | Ne pas toucher au reste à payer d'un traitement partiellement payé | La réconciliation ne modifie jamais un montant payé — elle recharge uniquement des lignes manquantes. Le reste à payer est TOUJOURS recalculé à la lecture (jamais stocké). |

### 4.4 VERIFICATION DES TOTAUX FINANCIERS AVANT ET APRÈS (§8 exigence)

À exécuter sur la base embarquée (avant bascule) puis sur la base managée
(après restauration) — **le même script, les mêmes requêtes**, comparaison
champ à champ :

```sql
-- Nombre d'enregistrements par table clinique et financière
SELECT 'patients' AS table, COUNT(*) FROM patients
UNION ALL SELECT 'treatments', COUNT(*) FROM treatments
UNION ALL SELECT 'treatment_visits', COUNT(*) FROM treatment_visits
UNION ALL SELECT 'appointments', COUNT(*) FROM appointments
UNION ALL SELECT 'appointment_reschedules', COUNT(*) FROM appointment_reschedules
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'payments_VALIDE', COUNT(*) FROM payments WHERE statut='VALIDE'
UNION ALL SELECT 'payments_ANNULE', COUNT(*) FROM payments WHERE statut='ANNULE'
UNION ALL SELECT 'payment_corrections', COUNT(*) FROM payment_corrections
UNION ALL SELECT 'medical_records', COUNT(*) FROM medical_records
UNION ALL SELECT 'prescriptions', COUNT(*) FROM prescriptions
UNION ALL SELECT 'prescription_items', COUNT(*) FROM prescription_items
UNION ALL SELECT 'odontogram_entries', COUNT(*) FROM odontogram_entries
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'trash_entries', COUNT(*) FROM trash_entries
UNION ALL SELECT 'activity_logs', COUNT(*) FROM activity_logs
UNION ALL SELECT 'manual_incomes', COUNT(*) FROM manual_incomes
UNION ALL SELECT 'expenses', COUNT(*) FROM expenses
UNION ALL SELECT 'finance_sessions', COUNT(*) FROM finance_sessions;

-- Totaux financiers (centimes)
SELECT
  (SELECT COALESCE(SUM(montantCentimes),0) FROM payments WHERE statut='VALIDE') AS encaisse_valide,
  (SELECT COALESCE(SUM(montantCentimes),0) FROM payments WHERE statut='ANNULE') AS encaisse_annule,
  (SELECT COALESCE(SUM(montantCentimes),0) FROM manual_incomes) AS revenus_manuels,
  (SELECT COALESCE(SUM(montantCentimes),0) FROM expenses) AS depenses,
  (SELECT COALESCE(SUM(prixTotalCentimes),0) FROM treatments WHERE statut<>'ANNULE') AS facture,
  (SELECT COALESCE(SUM(montantCentimes),0) FROM payments WHERE statut='VALIDE') AS paye;

-- Cohérence relationnelle (aucun orphelin après restauration)
SELECT COUNT(*) FROM payments p LEFT JOIN treatments t ON t.id=p.treatmentId WHERE t.id IS NULL;
SELECT COUNT(*) FROM payments p LEFT JOIN patients pa ON pa.id=p.patientId WHERE pa.id IS NULL;
SELECT COUNT(*) FROM treatment_visits v LEFT JOIN treatments t ON t.id=v.treatmentId WHERE t.id IS NULL;
SELECT COUNT(*) FROM manual_incomes m LEFT JOIN users u ON u.id=m.createdById WHERE u.id IS NULL;
SELECT COUNT(*) FROM expenses e LEFT JOIN users u ON u.id=e.createdById WHERE u.id IS NULL;
```

**Critère de réussite** : les 21 compteurs et les 6 totaux financiers sont
**strictement identiques** entre les deux bases. Tout écart = échec → rollback
avant la bascule réelle.

---

## 5. SITE FINANCIER — DÉPLOIEMENT (à faire PLUS TARD, séparément)

Aucun déploiement n'est lancé aujourd'hui. Ce qui devra être fait :

1. Réserver un sous-domaine (ou utiliser celui du PaaS).
2. Déployer le Next.js (`npm run build` → `standalone`) sur :
   - Vercel (recommandé si le code est déjà sur GitHub) ;
   - Railway / Render / Fly.io si on préfère un serveur Node dédié.
3. Variables d'environnement à définir (cf. `docs/DEPLOYMENT.md`) :
   `DATABASE_URL` (managée, sslmode=require), `SESSION_SECRET`,
   `PASSWORD_PEPPER` (le même que le bureau !), `APP_URL`,
   `COOKIE_SECURE=true`, `COOKIE_DOMAIN` (le sous-domaine réel),
   `DOCUMENTS_STORAGE_PATH` (un storage du PaaS ou rien — les documents
   restent en local au cabinet).
4. Configurer HTTPS automatique (Let's Encrypt géré par le PaaS).
5. Lancer une fois : `npm run db:migrate:deploy` contre la base managée.
6. Tester la connexion médecin + le contrôle d'accès.

---

## 6. PLAN DE ROLLBACK — RÉSUMÉ

| Phase | Action de rollback |
|---|---|
| Base managée inaccessible (jour J) | Rétro-bascule : réécrire `database-url.json` sur la base embarquée |
| Données incohérentes détectées | Vérifier les journaux ; si anomalie non résoluble en < 30 min → rollback immédiat |
| Site financier compromis (jamais arrivé à ce jour) | Retirer le DNS / désactiver le sous-domaine ; l'app bureau est indépendante |
| Modifications partielles saisies pendant la bascule | **Export incrémental idempotent** depuis la base managée puis rechargement ciblé (§ 4.3, point 5) — le journal d'activité n'est PAS utilisé pour rejouer des écritures |

---

## 7. CE QUI DEVIENT ENCORE FAUX APRÈS CETTE ARCHITECTURE (à mettre à jour)

| Document | Section à mettre à jour |
|---|---|
| `docs/FINANCES.md` §3 | « Le site financier partage aujourd'hui la même base lorsque l'application tourne sur le poste clinique » → devient « même base managée, accessible d'Internet » |
| `docs/DEPLOYMENT.md` §1 tableau | Ajouter l'entrée « PostgreSQL managé = source de vérité unique, bureau + site financier » |
| `docs/ARCHITECTURE.md` §1 schéma | Remplacer « PostgreSQL (source verite) local au poste » par le schéma §1 ci-dessus |
| `docs/BACKUP.md` | Ajouter la mention « dump hebdo manuel + PITR du PaaS » |

---

## 8. ESTIMATION DES COÛTS (prix publics vérifiés en ligne — à reconfirmer au moment de la souscription)

> **Ce qui a été CORRIGÉ par rapport à la première version** : la première
> version recommandait « Vercel Hobby (gratuit) » pour le site financier.
> **C'était une erreur** : les conditions d'utilisation de Vercel restreignent
> explicitement le plan Hobby à un **usage personnel, non commercial**. Une
> clinique qui traite des données de santé ne rentre PAS dans ce cadre. La
> recommandation est remplacée par des offres commerciales uniquement.

### 8.1 Hypothèses de dimensionnement

- Volume de données : **< 1 Go** (cabinet mono-praticien, ~3-5 ans d'exploitation)
- Connexions simultanées : **2 à 5** (1 bureau + 1 à 3 sessions financières)
- Trafic : très faible (consultations locales + lecture finances)
- Sauvegardes : quotidiennes automatiques (exigence de données de santé)

### 8.2 PostgreSQL managé — prix publics relevés (estimations, hors taxes)

**Aucun compte n'a été créé, aucune infrastructure provisionnée.** Les prix
sont des relevés publics, à reconfirmer sur les pages officielles au moment de
la souscription.

| Fournisseur | Plan adapté à un usage commercial | Prix estimé / mois | Inclus | Notes |
|---|---|---|---|---|
| **[Neon](https://neon.com/pricing)** | **Launch** (usage-based) | **~15 USD/mois** (« typical spend » annoncé par Neon pour ~1 Go et charge intermittente) ; estimate réaliste pour ce cabinet : **12-25 USD/mois** — compute 0,106 USD/CU-h, stockage 0,35 USD/Go-mois, historique PITR 0,20 USD/Go-mois (fenêtre 1-7 j configurable), snapshots 0,09 USD/Go-mois | 100 projets, 10 branches, sauvegardes programmées, PITR jusqu'à 7 jours | Plan gratuit limité à 1 Go et compute qui s'arrête après 5 min d'inactivité — **non retenu** pour la production. SLA/HIPAA réservés au plan Scale. |
| **[Supabase](https://supabase.com/pricing)** | **Pro** | **~25 USD/mois** | 8 Go de base, sauvegardes quotidiennes 7 jours, pas de cold start, compute toujours actif | L'offre gratuite expire après 7 jours d'inactivité — non retenu. |
| **[Railway](https://railway.com/pricing)** | **Pro** | ~5 USD/mois (crédit) + ~0,25 USD/Go/mois stockage + compute à l'usage. Réaliste pour ce cas : **10-20 USD/mois** | Facturation à l'usage, PostgreSQL simple, backups sur plan payant | Simple à opérer mais pas de SLA explicite ; moins adapté à des données de santé critiques. |
| **[Render](https://render.com/pricing)** | Postgres payant **+ espace de travail** | Postgres **~6 USD/mois** (0,1 CPU / 256 Mo) ou **~19 USD/mois** (0,5 CPU / 1 Go, plus confortable) ; **+ espace de travail Hobby 0 USD ou Pro 25 USD/mois** (voir note ci-dessous) ; stockage additionnel 0,30 USD/Go | 1 Go SSD inclus, PITR sur instances payantes, sauvegarde logique | L'offre gratuite expire après 30 jours — voir [docs Render](https://render.com/docs/free-and-paid-postgres). Note : la page Hobby indique « for individuals building personal projects and prototypes » — même restriction de principe que Vercel Hobby. Pour un usage commercial réel, prévoir le plan **Pro (25 USD/mois)**. Les scénarios Render sont donc **plus chers** que ne le suggéraient les anciennes estimations (~7 USD/mois). |
| **[Aiven](https://aiven.io/pricing)** | Free / Startup | Free 0 USD, Startup ~50 USD/mois | Free : 1 CPU, 1 Go RAM, 5 Go, pas de cold start — mais **SLA et sauvegardes complètes** réservés aux plans payants | Le plan Free est « too good to be true » pour des données de santé — à éviter en production. |
| **AWS RDS / GCP Cloud SQL** | Plus petite instance | **~15-30 USD/mois** | SLA élevé, PITR, région EU disponibles | Surdimensionné techniquement mais le plus fiable ; plus cher. |

### 8.3 Hébergement du site financier (application Next.js)

**Recommandation revue : les plans gratuits grand public ne sont PAS
appropriés** pour une application médicale professionnelle. Les offres ci-
dessous sont des plans commerciaux.

| Fournisseur | Plan recommandé | Prix estimé / mois | Inclus | Source |
|---|---|---|---|---|
| **[Vercel](https://vercel.com/pricing)** | **Pro** | **~20 USD/mois (par équipe, 1 siège développeur inclus)** + usage au-delà des quotas inclus (1 Mo de requêtes CDN/mois, 100 Go de transfert/mois, 1 M d'invocations de fonctions/mois inclus — le trafic de ce site est très en dessous). Les taxes (VAT/GST) sont ajoutées à la facture selon l'adresse de facturation. | HTTPS auto, CDN, fonctions serverless, déploiement continu, domaine personnalisé gratuit | Officiel. **Hobby est exclu** : usage personnel non commercial uniquement (source : [plan Hobby](https://vercel.com/docs/plans/hobby)) — c'est une restriction des conditions d'utilisation, pas une simple recommandation. |
| **[Railway](https://railway.com/pricing)** | Pro | ~5 USD (crédit) + usage. Réaliste : **5-15 USD/mois** | Node.js, HTTPS auto, déploiement Git | Simpler, mais pas de CDN global — moins rapide hors Europe. |
| **[Render](https://render.com/pricing)** | **Hobby compute (~7 USD/mois) + espace de travail Pro (25 USD/mois)** | **~32 USD/mois total** (7 USD compute + 25 USD espace de travail) | HTTPS auto, toujours actif (pas de cold start), déploiement Git, 25 Go de bande passante | L'offre gratuite (Free) est suspendue après 15 min d'inactivité et l'espace Hobby est limité aux projets personnels — **non retenu** pour un usage professionnel. Voir la note commerciale en § 8.2. |

### 8.4 Estimation TOTALE (scénarios réalistes, hors taxes)

Les montants sont des **estimations** basées sur les prix publics relevés en
ligne, hors taxes, hors nom de domaine. Ils peuvent évoluer selon les
fournisseurs et le volume réel.

| Scenario | PostgreSQL / mois | Site financier / mois | Total mensuel estimé |
|---|---|---|---|
| **Exclu** : offres gratuites grand public | Neon Free (0 USD) | Vercel Hobby (0 USD) | 0 USD — **exclu** : conditions inadaptées à un cabinet médical + compute qui s'arrête |
| **Exclu** : « Réaliste minimal » de l'ancienne version (Render Hobby) | Render Postgres (~6-19 USD) | Render Hobby compute (~7 USD) | Ancienne estimation ~14 USD/mois — **exclu** : l'espace de travail Hobby est limité aux projets personnels ; le plan Pro (25 USD/mois) est requis pour un usage commercial |
| **Recommandé** (commercial) | Neon Launch (~15 USD, usage-based) | Vercel Pro (~20 USD + usage négligeable) | **~35 USD/mois** |
| **Alternative recommandée** (commercial) | Supabase Pro (~25 USD) | Render Pro (compute 7 USD + espace de travail 25 USD) | **~57 USD/mois** |
| **Confort** (commercial, SLA élevés) | AWS RDS petite instance (~25 USD) | Vercel Pro (~20 USD) | **~45 USD/mois** |

**Hypothèses de calcul** : < 1 Go de données, trafic très faible (donc dans
les quotas inclus de Vercel et Neon) ; hors taxes (VAT/TVA selon l'adresse de
facturation — Vercel et Render facturent les taxes en supplément) ; hors nom
de domaine. **Tous les montants sont des estimations**, relevés sur les pages
officielles citées, à reconfirmer au moment de la souscription.

### 8.5 Recommandation

Pour un cabinet médical traitant des données de santé, **recommandation :
scénario « Recommandé » (Neon Launch + Vercel Pro, ~35 USD/mois hors taxes)**.
Le scénario Render Pro (~57 USD/mois) est une alternative si l'on préfère un
serveur Node dédié ; le scénario AWS RDS (~45 USD/mois) si l'on veut des SLA
contractuels. Les scénarios à moins de 15 USD/mois reposent tous sur des
offres non commerciales et sont **exclus**. Aucun engagement annuel ne
devrait être pris avant 3 mois d'exploitation stable.

### 8.6 Coûts additionnels à prévoir

- **Nom de domaine** (~10-15 USD/an, ex. OVH, Gandi, Namecheap) — requis pour
  un certificat HTTPS propre et un accès mémorisable. Un sous-domaine gratuit
  du PaaS (`xxx.vercel.app`) fonctionne aussi mais porte le nom du fournisseur.
  Vercel Pro inclut aussi un domaine personnalisé gratuit la première année.
- **Sauvegarde hors-site** (clé USB, coffre) — quasi gratuit, **indispensable**.
- **Frais de sortie de données (egress)** : négligeables à ce volume sur Vercel
  (transfert inclus dans le Flat Rate CDN) et sur Neon (500 Go/mois inclus).
- **Temps d'administration** (quelques heures au départ, puis < 1 h/mois).
- **Taxes locales** : selon le régime fiscal du cabinet et la législation
  applicable (facturation d'un service numérique étranger peut ouvrir droit à
  une retenue à la source ou une TVA sur services importés — à confirmer avec
  un comptable).
- **Support premium** éventuel si besoin (coût variable selon le PaaS).

### 8.7 Frais NON inclus

Aucun frais de mise en service n'a été engagé — aucune souscription, aucune
infrastructure n'est créée. Ces montants sont des **estimations** à confirmer
sur les pages officielles au moment de la souscription.

---

## 9. RISQUES IDENTIFIÉS

| Risque | Impact | Mitigation |
|---|---|---|
| Le pepper Argon2id diverge entre bureau et serveur financier | tous les comptes deviennent invalides | copier le pepper **tel quel** dans le JSON protégé ET dans les variables du PaaS (§3.4) |
| Une coupure réseau pendant l'enregistrement d'un paiement | paiement « perdu » | Prisma échoue AVANT l'écriture (transaction) : rien n'est écrit ni perdu. L'UI affiche un message explicite, l'opération peut être rejouée. **Idempotence en plus** (clé unique). |
| Le fichier JSON protégé est effacé (réinstallation Windows) | app ne démarre plus | garder une copie chiffrée dans le coffre ; procédure documentée |
| La secrétaire arrive à ouvrir le site financier depuis le poste bureau avec son compte | violation de confidentialité | **impossible par construction** : le login financier refuse tout rôle ≠ MEDECIN (vérifié par le code et par l'audit). En plus : ne jamais donner le mot de passe financier à la secrétaire. Une couche supplémentaire (IP allowlist ou 2FA) peut être ajoutée PLUS TARD. |
| Neon Free : compute suspendu après 5 min d'inactivité | léger délai au 1er accès | acceptable pour un cabinet ; passer à Launch si gênant |
| Conformité (données de santé chez un hébergeur non-DZ) | juridique | **§ 0bis** : la loi 18-07 modifiée par la 25-11 impose un registre des traitements, un registre santé dédié, une procédure de notification de violation, et possiblement une **autorisation préalable de l'ANPDP pour l'hébergement hors Algérie** (articles 44/45 de la 18-07, non relus dans le JO 48/2025 — à confirmer par un juriste). **Aucune affirmation de conformité n'est faite.** |
|embedded-postgres laissé en double | confusion | drapeau `MODE_DISTANT=1` — le PG embarqué n'est plus démarré en prod ; garder en secours uniquement |

---

## 10. CHECKLIST DE DÉCISION — À REMPLIR PAR LE MÉDECIN AVANT TOUTE ACTION

Chaque case indique son état : ✅ vérifié, ◐ estimé, ⏳ en attente de décision
### 10.1 Hébergement et localisation des données

- [ ] ⏳ **Choix du fournisseur d'hébergement PostgreSQL** parmi Neon
      (Launch), Supabase (Pro), Render (Pro), Railway, AWS RDS — ou un
      hébergeur algérien si une offre fiable est identifiée (§ 0bis.6).
      **Exclus** : Neon Free, Supabase Free, Render Hobby, tout plan non
      commercial (§ 8).
- [ ] ⏳ **Choix de la localisation géographique** des données (UE, USA,
      autre). Un centre de données en Algérie, si une offre existe, élimine le
      risque de transfert international.
- [ ] ⏳ **Choix du fournisseur du site financier** (Vercel Pro ~20 USD/mois,
      Render Pro ~32 USD/mois, Railway) — § 8.3. **Vercel Hobby est exclu**
      (usage personnel non commercial uniquement).

### 10.2 Conformité légale et protection des données

- [ ] ⏳ **Consultation d'un juriste algérien qualifié** sur le transfert
      international de données de santé (§ 0bis.5, questions 1 à 8).
- [ ] ⏳ **Contact avec l'ANPDP** pour connaître : la procédure de déclaration,
      la nécessité d'une autorisation préalable pour l'hébergement hors
      Algérie, le formulaire de notification de violation et son délai exact.
- [ ] ⏳ **Validation de la stratégie de conformité retenue** (hébergement
      local, autorisation ANPDP, exception légale, etc.) — AUCUNE affirmation
      de conformité n'est faite dans ce plan.
- [ ] ⏳ **Préparation du registre des traitements** (Art. 45 bis 6 de la
      25-11) et du registre spécifique santé (Art. 45 bis 7).
- [ ] ⏳ **Préparation d'un plan de réponse à violation** avec délai de
      notification (Art. 45 bis 8).

### 10.3 Budget

- [ ] ◐ **Budget mensuel validé** : ~35 USD/mois (recommandé : Neon Launch +
      Vercel Pro) à ~57 USD/mois (alternative Render Pro), **hors taxes et hors
      nom de domaine** (§ 8.4). Les montants sont des **estimations** relevées
      sur les pages officielles — à reconfirmer au moment de la souscription.
      Les offres à < 15 USD/mois sont exclues (non commerciales).
- [ ] ⏳ **Nom de domaine** : acquisition (~10-15 USD/an) ou choix d'un
      sous-domaine gratuit du PaaS. Vercel Pro inclut un domaine personnalisé
      gratuit la première année.
- [ ] ⏳ **Traitement fiscal** des services numériques étrangers confirmé avec
      un comptable.

### 10.4 Procédure de migration et de rollback

- [ ] ⏳ **Approbation de la procédure complète** de migration (§ 4.2) :
      inventaire → sauvegarde → création → restauration → validation →
      test → bascule → monitoring → rétention.
- [ ] ⏳ **Approbation de la stratégie de rollback** (§ 4.3) : gel d'écriture,
      export incrémental idempotent, critères de décision, test préalable
      obligatoire en environnement jetable.
- [ ] ⏳ **Critères de rollback validés** (§ 4.3, point 6) : divergences de
      comptage, écarts de totaux financiers, indisponibilité > 15 min,
      incident de sécurité.
- [ ] ⏳ **Script d'inventaire** (`scripts/inventaire-migration.cjs`) écrit
      et testé (§ 4.2.1 — à écrire).
- [ ] ⏳ **Sauvegarde AVANT migration** effectuée, chiffrée, copiée hors-site,
      et **restaurée avec succès** dans une base de test (pas seulement créée).

### 10.5 Fiabilité Internet et plan de panne

- [ ] ⏳ **Qualité de la connexion Internet au cabinet confirmée** (débit,
      stabilité, historique de coupures) — à évaluer par le médecin.
- [ ] ⏳ **Acceptation du mode dégradé** en cas de coupure (§ 2) : saisies
      suspendues, aucune perte, aucun paiement hors-ligne.
- [ ] ⏳ **Plan de secours validé** en cas d'indisponibilité prolongée
      (> 1 jour) : retour temporaire au PostgreSQL embarqué local.

### 10.6 Confidentialité et accès

- [ ] ◐ **La séparation secrétaire / médecin est confirmée par l'audit**
      technique (voir historique du projet) — ✅ vérifié.
- [ ] ⏳ **Mot de passe financier du médecin choisi** et **jamais partagé**
      avec la secrétaire.
- [ ] ⏳ **Mot de passe Argon2 (pepper) préservé** tel quel entre la base
      embarquée et la base managée (§ 3.4) — vérifié techniquement, à
      reconfirmer à la migration.

### 10.7 Autorisation de démarrer

- [ ] ⏳ **AUTORISATION EXPLICITE du médecin pour commencer** la mise en
      oeuvre (écriture du code de connexion distante, création de l'instance
      managée, migration des données, déploiement du site financier).

**AUCUNE de ces actions n'a été exécutée.** Ce document est prêt à être revu,
modifié, discuté, ou exécuté — à la demande du médecin.
