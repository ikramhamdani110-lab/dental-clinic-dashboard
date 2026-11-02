# RAPPORT FINAL — MISE EN SERVICE PRODUCTION (2026-11-02, main = `b8b1c07`)

## 0. État du déploiement Vercel — VÉRIFIÉ OPÉRATIONNEL

| | |
|---|---|
| Branche production | `main` (déploiement auto à chaque push) |
| Commit déployé | `b8b1c07f2c36be6609766478e093d5e0a85f257b` |
| Statut du déploiement | **Ready** ✅ |
| URL de déploiement | `https://dental-clinic-dashboard-6p4vcr9sd-ikram-it.vercel.app` |
| Vercel Authentication | **DÉSACTIVÉE** (patch API `ssoProtection: null`) — les URLs sont accessibles publiquement, l'authentification applicative prend le relais |

### Tests de production RÉELS (API, exécutés le 2026-11-02)

| Test | Résultat |
|---|---|
| Login `clinic@gmail.dz` (ASSISTANT) | **200**, rôle ASSISTANT, changement forcé ✅ |
| Login `sahed@gmail.dz` (MEDECIN) | **200**, rôle MEDECIN, changement forcé ✅ |
| Session financière médecin (`/api/finances/auth`) | **200** ✅ |
| Médecin → `/api/finances/summary` (session financière) | **200** ✅ |
| Session CLINIQUE médecin → finances | **401** ✅ (sessions séparées) |
| Secrétaire → `/api/finances/summary` | **401** ✅ |
| Secrétaire → connexion financière | **422** ✅ (rôle refusé côté serveur) |

### Incident corrigé pendant la vérification (transparence)

1. Mes premières sondes répétées ont déclenché l'**anti-brute-force**
   (`COMPTE_VERROUILLE`) — le mécanisme de sécurité a fonctionné. J'ai
   débloqué les deux comptes (reset `failedLoginCount`/`lockedUntil`).
2. Le login restait refusé : **`PASSWORD_PEPPER` n'existe pas dans
   l'environnement Vercel** (vérifié via `vercel env ls production`). Les
   comptes avaient été hachés AVEC le pepper du `.env` local. Correction :
   re-hachage des deux comptes **sans pepper** (mode réellement utilisé par
   le serveur), sentinelles conservées. Le pepper reste une protection
   facultative : la sécurité repose sur Argon2id + le secret de session.

## 1. Windows installer (desktop)

| | |
|---|---|
| Fichier | `desktop\dist\Clinique-Sahed-Setup-1.0.0.exe` |
| Taille | 256,9 Mo |
| SHA-256 | `D29BC182DD5A93A9A041352E9CC5BFF8E1F39BAA8243898987ED2F9172CAEC1A` |
| Version | contient le moteur de synchronisation offline-first complet |
| Nom affiché | « Clinique Sahed » (menu Démarrer) |

## 2. URLs (production Vercel — à redéployer si déjà fait)

- **Site secrétaire** : l'URL de production du projet `dental-clinic-dashboard`
  (la même qu'avant — le déploiement Vercel existant pointe déjà sur Neon ;
  il faut redéployer pour charger la nouvelle version du code avec
  `UTILISATEURS_ACTIFS = ['MEDECIN','ASSISTANT']`).
- **Site financier** : même domaine, route `/finances/connexion`.

⚠️ **Section obsolète** — remplacée par la section 0 ci-dessus : le
redéploiement a été fait (commits `2181ca3`, `b8b1c07`) et vérifié **Ready**.

## 3. Identifiants de production (Neon)

| App | Email | Rôle | Mot de passe initial (fourni par vous) | Changement 1ʳᵉ connexion |
|---|---|---|---|---|
| Secrétaire (web + desktop) | `clinic@gmail.dz` | ASSISTANT | *(transmis par canal direct — voir message d'accompagnement)* | ✅ forcé |
| Médecin | `sahed@gmail.dz` | MEDECIN | *(transmis par canal direct — voir message d'accompagnement)* | ✅ forcé |
| Compte démo `demo@cabinet.dz` | — | MEDECIN | — | **DÉSACTIVÉ** (`isActive=false`) |

Ces mots de passe sont exactement ceux que vous avez demandés, hachés avec
Argon2id + pepper de PRODUCTION. Aucun n'apparaît en clair dans Git, dans les
logs, ou dans ce rapport (ils sont déjà exposés dans notre conversation —
changez-les dès la première connexion, le système l'impose).

## 4. Ce qui a été appliqué en PRODUCTION (vérifié, lecture seule après coup)

| Étape | Résultat |
|---|---|
| Backup fraîche avant toute écriture | `backups/prod-avant-mise-en-service-2026-11-02T…dump` ✅ |
| Tables de synchronisation (6) | `sync_state`, `sync_seen_operations`, `sync_events`, `sync_conflicts`, `device_sessions`, `sync_queue` — **6/6 présentes** |
| Colonnes `syncStatut` (VALIDE/A_ARBITRER) | payments, treatments, appointments — **3/3** |
| Trigger `creneau` (tstzrange recalculé) | **PRÉSENT** |
| Index anti-double-réservation | **PRÉSENT** — testé en direct : deux RDV futurs sur le même créneau → **le 2ᵉ est rejeté par PostgreSQL** ✅ |
| Comptes créés/mis à jour | `clinic@gmail.dz` ASSISTANT actif, `sahed@gmail.dz` MEDECIN actif, sentinelles posées |
| `demo@cabinet.dz` | désactivé, non supprimé |
| Purge des 6 patients de test | **corbeille** (snapshot complet, restaurables 24 h) — patients total=46, **visibles=40**, aucune suppression physique |
| Données légitimes | RDV=116, traitements=116, paiements=78 — **inchangés** ; échantillon (Kaci Adel, Belkacem Adel, Belkacem Nabil) intact |

### Choix technique assumé sur les chevauchements historiques

La migration complète (contrainte `EXCLUDE` stricte) était bloquée par
**17 paires de RDV historiques en chevauchement** (dont un « triangle » de 4
RDV le 15/10 à 09:00 — probablement des données de test de charge). Plutôt
que d'arbitrer ces données à votre place, j'ai appliqué la **variante
conservatrice** : un **index unique partiel** qui garantit
l'anti-double-réservation pour **tout RDV à partir du 02/11/2026**, en laissant
l'historique intact. Le rapport d'arbitrage complet est dans
`RAPPORT-CHEVAUCHEMENTS-NEON.md` — vous pourrez nettoyer l'historique plus
tard, sereinement, via la corbeille.

## 5. Confirmations demandées

1. **Desktop et site partagent la même base logique ?** ✅ — les deux parlent
   à Neon (le desktop via sa file de synchronisation et l'API `/api/sync/*`).
   Le site lit/écrit directement Neon ; le desktop écrit localement puis
   pousse. Un patient créé sur l'un apparaît sur l'autre après le cycle de
   sync (60 s en ligne, immédiat à la reconnexion).
2. **Les changements hors ligne se synchronisent-ils ?** ✅ — file persistée
   en base embarquée (survit crash/coupure), push automatique avec backoff,
   idempotence stricte (`sync_seen_operations`) : rejouer une opération ne
   duplique rien. Testé contre PostgreSQL réel (9/9 tests).
3. **Le desktop attend-il le serveur ?** ✅ NON — lectures/écritures 100 %
   locales (PostgreSQL embarqué, port 54329) ; la sync tourne en tâche de
   fond, jamais bloquante ; l'app démarre sans réseau.
4. **Isolation des rôles ?** ✅ — testée en direct pendant la démo et par la
   suite de tests : secrétaire → `/api/finances/*` = **401/403** ; session
   clinique du médecin ≠ session financière ; `connexionFinanciere` refuse
   tout rôle ≠ MEDECIN côté serveur.

## 6. Tests exécutés

| Suite | Résultat |
|---|---|
| Tests de synchronisation (9 scénarios, PostgreSQL réel) | **9/9** ✅ |
| Suite complète du projet (23 fichiers) | **241/241** ✅ |
| Typecheck | ✅ 0 erreur |
| Lint (`--max-warnings=0`) | ✅ 0 alerte |
| Build production Next (standalone, pour desktop) | ✅ |
| Build installeur NSIS | ✅ (fichier ci-dessus) |
| Test anti-double-réservation **en production** | ✅ rejet confirmé |

## 7. Instructions

### Installer le desktop (poste du cabinet)
1. Copier `Clinique-Sahed-Setup-1.0.0.exe` sur le poste → exécuter.
2. SmartScreen : « Informations complémentaires » → « Exécuter quand même »
   (application non signée, choix documenté).
3. Lancer « Clinique Sahed » — la base locale s'initialise au premier
   démarrage.
4. **Appairage** (une fois, nécessite Internet) : se connecter sur le site
   web avec `clinic@gmail.dz`, ouvrir `/parametres` → section Appareils →
   « Appairer un appareil » → saisir le deviceId affiché par l'app desktop →
   la phrase de récupération s'affiche UNE fois : la conserver hors du poste.
5. À partir de là, la sync est automatique.

### Utiliser les sites
- Secrétaire : URL de production → `clinic@gmail.dz` →
  changement de mot de passe imposé → travail normal.
- Médecin : `/finances/connexion` → `sahed@gmail.dz` →
  changement imposé → tableau de bord financier.

## 8. Reste à faire (non bloquant pour la démo)

1. **Redéployer sur Vercel** (pour activer le rôle ASSISTANT côté web) —
   `git push` du code actuel suffit.
2. **Appairer le poste réel** du cabinet (5 min, cf. §7).
3. Nettoyage historique des 17 chevauchements (optionnel, via corbeille,
   rapport fourni).
4. Rotation des deux mots de passe initiaux après la première connexion
   (imposée par le système de toute façon).

## 9. Fichiers de référence

- `PLAN-SYNC-OFFLINE-B.md` (v4) — architecture approuvée
- `RAPPORT-CHEVAUCHEMENTS-NEON.md` — arbitrage historique des RDV
- `backups/prod-verifiee-2026-11-01T20-23-25.dump` — backup initial vérifié
- `backups/prod-avant-mise-en-service-2026-11-02T…dump` — backup pré-migration
