# RAPPORT D'AUDIT FINAL — SAHED DENTAL CLINIC (audit du 2026-11-01)

## 1. Architecture (vérifiée dans le code, pas de la doc)

| Surface | Technologie | Preuve |
|---|---|---|
| Application web unique (Next.js 15.5.25, React 19, App Router) | `src/app` | `package.json`, `next.config.ts` |
| Deux espaces authentifiés distincts | groupe `(dashboard)` (secrétariat) et groupe `(finances)` (médecin), sessions séparées (`backend/auth/finance-session.ts`) | arborescence `src/app` |
| API REST | `src/app/api/**/route.ts` (+ CSRF, sessions cookie `sahed_session`) | `src/middleware.ts` |
| ORM / DB | Prisma 6.1 / PostgreSQL, 31 migrations versionnées dont `paiements_acompte` (2026-10-31) | `database/prisma/` |
| Desktop (secrétaire) | Electron 45 + Next standalone + PostgreSQL embarqué (`embedded-postgres`), zéro dépendance externe | `desktop/main.mjs`, `electron-builder.config.cjs` |
| Site financier médecin | même déploiement web, groupe `(finances)`, cookie de session financière dédié | `backend/auth/finance-session.ts` |

Les trois surfaces partagent UNE base par environnement — pas de duplication de paiements.
Le desktop embarque sa propre base PostgreSQL locale (poste secrétaire), le cloud utilise la base Vercel/Neon.

## 2. État du projet

- Site d'installation externe : **absent** (confirmé, non recréé).
- GitHub Release `installateur-v1.0.0` : **absente** (confirmé par API, statut 404).
- Installateur préservé : `desktop/dist/Clinique-Sahed-Setup-1.0.0.exe`, 269 338 226 o,
  SHA-256 `F96B18B4A48FD8D26A45F5F48CC58F012B99A7FE2E60C4F0C814FF82AC3C8943`, construit le 31/10/2026.
  Il contient la migration `paiements_acompte` et la route `personal-transactions` (vérifié par extraction).

## 3. Modifications faites pendant l'audit

| Fichier | Changement | Pourquoi |
|---|---|---|
| `scripts/verifier-previews.cjs` | URL API `/api/finances/personal` → `/api/finances/personal-transactions` | le script référençait une route renommée ; il échouait donc à l'étape 12 |
| `scripts/iso-personnelles.cjs` | même correction d'URL (3 créations + liste + suppression) | idem — le script d'isolement des écritures personnelles appelait l'ancienne route |
| `desktop/test-fullstack.mjs` | chemin runtime `desktop/resources` → `desktop/runtime` ; retrait de l'appel `/api/reports/revenue` | le test cherchait les node_modules au mauvais endroit depuis le passage à `extraResources` ; la route Rapports a été retirée de l'application (§secretaire) mais le test l'appelait encore |
| `qa-responsive.mjs` (racine) | supprimé | artefact de QA non versionné à l'origine, recréé puis retiré pour laisser l'arbre propre |

Aucune modification métier. Aucune migration. Aucune donnée touchée.

## 4. Compatibilité Windows — ce qui a été réellement testé

**Environnement d'exécution réel disponible : Windows 11 x64 (machine de développement, 11e/24H2).**

Tests exécutés avec succès :
- Build packaging complet : `BUILD_TARGET=desktop npm run build` + `node desktop/prepare.mjs` + `npm run desktop:installer` → NSIS régénéré, hash recalculé, ancien installateur sauvegardé puis retiré après vérification.
- Runtime embarqué isolé (le cœur du démarrage packagé) : script dédié exécutant
  `resources/runtime/node.exe` → `embedded-postgres` (initialise + start + createDatabase) → `migrate.mjs` → `seed.cjs` → `standalone/server.js` → **`/api/health` = 200**.
  Cela prouve que le runtime embarqué fonctionne **sans Node ni PostgreSQL installés sur le PATH**, depuis le dossier `resources/runtime` uniquement.
- Test fullstack desktop (`desktop/test-fullstack.mjs`) : base fraîche → migration → seed → serveur →
  login (401 sur mauvais mot de passe, 200 + `doitChangerMotDePasse: true` sur mot de passe initial) →
  création patient/rendez-vous/traitement/paiement → **persistance vérifiée après arrêt/redémarrage de PostgreSQL**.
- Installateur NSIS : lancement `/S`, extraction vérifiée (`Clinique Sahed.exe`, désinstalleur, `resources/app`, `resources/runtime` complet avec node.exe, embedded-postgres, .prisma, argon2).
- Uninstall : `Uninstall Clinique Sahed.exe` présent, `deleteAppDataOnUninstall: false` (données conservées).

**Non testé (bloqué, pas de machine/VM disponible) — à NE PAS présenter comme validé :**
- Windows 10 64-bit (aucune VM Win10 disponible dans cet environnement).
- Compte Windows **non administrateur** (l'installateur NSIS est `perMachine: false` donc par-utilisateur, mais non vérifié sur un compte standard réel).
- Chemins avec accents/espaces dans le nom d'utilisateur Windows.
- Windows Defender / SmartScreen : l'installateur **n'est pas signé** — un avertissement SmartScreen est ATTENDU et documenté ; non re-testé sur un poste vierge.
- Redémarrage Windows, veille/réveil, antivirus tiers.

## 5. Tests fonctionnels (réels, exécutés)

- `npm run test` (vitest) : **197 passed / 35 skipped / 0 failed** (22 fichiers).
- QA navigateur secrétaire (`scripts/qa-navigateur.mjs`) : connexion réelle, 3 indicateurs du tableau de bord,
  clic « Nouveaux patients » → `?vue=nouvelles-entrees`, traitement en texte libre, acompte 5000 DA enregistré
  **une seule fois** (idempotence vérifiée par double soumission).
- QA secrétaire (`scripts/qa-secretary.mjs`) : aucune fuite financière côté secrétariat (aucun « DA/DZD », aucun lien rapports).
- QA finances (`scripts/qa-finances.mjs`) : connexion médecin, 3 boîtes cohérentes, **refus 401/403 du cookie clinique sur l'API finances**.
- Isolement des écritures personnelles (`scripts/iso-personnelles.cjs`) : création revenu + dépense + dette personnels (3× 201) puis **totaux clinique strictement inchangés** et nettoyage OK.
- `npm run preview:verify` : 14 vérifications bout-en-bout OK après correction du script.
- Paiements : montant en centimes (Int), clé `idempotencyKey` unique en base, acomptes via `Payment.treatmentId` nullable
  rattachables sans créer de second paiement (contrainte `@unique` + `sourceCorrectionId`).

## 6. Audit sécurité (OWASP — probes exécutées sur l'environnement de démo)

| Contrôle | Résultat |
|---|---|
| Mots de passe | Argon2id + pepper, changement forcé 1re connexion (`passwordChangedAt` sentinelle) ✔ |
| Rate limiting + verrouillage | présent (`failedLoginCount`, `lockedUntil`) ✔ |
| Sessions | cookie httpOnly, `COOKIE_SECURE` obligatoire en prod (démarrage refusé sinon) ✔ |
| Isolation des rôles | API finances → 401 avec cookie clinique ✔ (testé) |
| Routes protégées sans session | redirection middleware ✔ (testé) |
| Injection SQL | Prisma paramétré, sonde `'; DROP TABLE` → pas d'erreur 500 ✔ |
| XSS réfléchi | pas de réflexion brute du payload ✔ |
| Path traversal `/api/documents/../..` | refusé ✔ |
| CSRF | token `x-csrf-token` exigé sur les écritures ✔ |
| Headers sécurité | CSP, X-Frame-Options, X-Content-Type-Options présents ✔ |

**Risques restants (non bloquants, à surveiller) :**
1. Installateur non signé → SmartScreen (P2, décision budget certificat).
2. `SESSION_SECRET` desktop est une constante du code — acceptable hors-ligne mono-poste, à remplacer si multi-postes (P2).
3. `npm audit` prod : aucune vulnérabilité high/critical dans les deps de production (vérifié).

## 7. Performance

- Aucun ralentissement constaté sur le jeu de démo (données réalistes réduites).
- **Tests de charge 10k/50k patients NON exécutés** (générateur de dataset synthétique volumineux non disponible dans cette passe).
  Ce point reste **à faire avant une promesse de performance** — classé P2, pas un bloquant pour une clinique réelle de taille normale.

## 8. Réseau

- L'application desktop fonctionne **100 % hors ligne** (base + serveur locaux) — vérifié par conception et par les tests sur 127.0.0.1.
- Paiement : jamais de succès affiché sans confirmation serveur (le client attend le 2xx et utilise une clé d'idempotence).

## 9. Base de données

- 31 migrations, statut `migrate status` : base à jour.
- Base cabinet (5432) : **JAMAIS modifiée** (aucune écriture, aucune migration lancée dessus).
- Base démo (5433, `sahed_demo_clinic`) : utilisée pour tous les tests,(cluster isolé, garde-fou dans `scripts/preview.mjs` qui refuse toute autre URL).
- `Payment` : `treatmentId` nullable documenté (acompte), `onDelete: Restrict` sur patient/treatment, index `(patientId, datePaiement)` et `(treatmentId, statut)`.

## 10. Installateur

| Élément | Valeur |
|---|---|
| Version | 1.0.0 (NSIS x64, `perMachine: false`) |
| SHA-256 | `F96B18B4A48FD8D26A45F5F48CC58F012B99A7FE2E60C4F0C814FF82AC3C8943` |
| Taille | 269 338 226 octets |
| Runtime embarqué validé | node.exe + PostgreSQL 16 embarqué + standalone Next — `/api/health` 200 ✔ |
| Persistance après redémarrage PG | ✔ (test fullstack) |
| Désinstallateur | présent, données AppData conservées ✔ |

## 11. Tests automatisés

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✔ 0 erreur |
| `npm run lint` | ✔ 0 warning |
| `npm run test` | ✔ 197 passés, 35 ignorés, 0 échec |
| `npm run build` | ✔ |
| `BUILD_TARGET=desktop npm run build` + `desktop:installer` | ✔ installateur régénéré |
| QA navigateur (3 scripts) | ✔ tous verts après correction `verifier-previews.cjs` |

## 12. Problèmes restants

| # | Gravité | Problème | Action requise |
|---|---|---|---|
| 1 | P1 | **Windows 10 et compte non-admin non testés** (pas de VM) | tester sur VM Win10 + compte standard avant déploiement généralisé |
| 2 | P2 | Installateur non signé → SmartScreen | certificat de signature (budget) |
| 3 | P2 | Tests de charge volumieuses non exécutés | jeu de données 10k+ sur la base de démo |
| 4 | P2 | `SESSION_SECRET` codé en dur côté desktop | acceptable hors-ligne ; à parameteriser si évolution multi-postes |

## 13. Recommandation de release

# **READY FOR CONTROLLED DEMONSTRATION**

**Justification.** Tout ce qui a pu être testé dans cet environnement passe :
zéro échec sur 197 tests, build/lint/typecheck propres, installateur régénéré et vérifié,
runtime desktop embarqué prouvé fonctionnel sans aucune dépendance externe,
persistance des données après redémarrage de la base, isolation stricte secrétaire/médecin (401 vérifié),
idempotence des paiements vérifiée en navigateur réel, aucune donnée réelle touchée.

**Pourquoi pas « READY FOR CLIENT DEPLOYMENT »** : deux gates n'ont pas pu être exécutés
faute d'environnement — test sur **Windows 10 réel/compte non-admin** et **test de charge volumineux**.
Le premier est le plus important : il faut impérativement une VM ou un poste Windows 10 avant
d'installer chez Dr. Sahed si son poste n'est pas Windows 11.
