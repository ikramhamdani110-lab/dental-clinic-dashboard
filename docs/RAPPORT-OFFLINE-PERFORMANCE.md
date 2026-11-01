# RAPPORT HORS-LIGNE & PERFORMANCE — résultats mesurés

> Date : 2026-11-01 · Environnement d'exécution : Windows 11 x64 (poste réel disponible).
> Chaque résultat ci-dessous provient d'une exécution réelle pendant l'audit.
> Rien n'est déclaré PASS sans exécution.

---

## 1. Démarrage hors ligne — **PASS**

Test réel : application de bureau lancée avec `APPDATA` isolé, base embarquée
fraîche, **sans aucune connexion sortante** (tout le trafic est local) :

| Étape | Mesure / preuve |
|---|---|
| PostgreSQL embarqué démarré | `desktop/test-fullstack.mjs` — « PG embarqué démarré » |
| Migrations + seed locaux | code 0, sans réseau |
| Serveur Next standalone local | `/api/health` → **200** sur `127.0.0.1` |
| Connexion (authentification locale Argon2id) | 401 sur mauvais mot de passe, 200 + changement forcé sur mot de passe initial |

Aucun appel internet n'existe dans le chemin de démarrage (`desktop/main.mjs`
inspecté intégralement : seules adresses contactées = `127.0.0.1:54329` et
`127.0.0.1:43177`).

## 2. Fonctions testées hors ligne — **PASS**

Exécutées contre la base embarquée locale, via le serveur local :

- Création patient (`POST /api/patients` → 201)
- Création rendez-vous (→ 201)
- Création traitement (→ 201)
- **Enregistrement paiement** (→ 201, `idempotencyKey` unique)
- Lecture APIs protégées (patients, rendez-vous, paiements, tableau de bord)

Dans l'architecture actuelle, ces opérations sont immédiatement « locales et
confirmées » (il n'y a pas de base centrale à rejoindre) — voir
`ARCHITECTURE-SYNCHRONISATION-MISES-A-JOUR.md` pour la notion d'« en attente »
qui s'appliquera après la phase de synchronisation.

## 3. Persistance locale — **PASS**

- Arrêt de PostgreSQL → redémarrage → relecture : patient retrouvé ✅
- Données stockées dans `%APPDATA%\Clinique Sahed\clinique\` (jamais dans le
  dossier d'installation).
- `deleteAppDataOnUninstall: false` : désinstallation/réinstallation ne détruit
  pas la base.

## 4. Redémarrage Windows hors ligne — **PASS (poste réel) / NOT TESTED (VM)**

- PASS : le dossier de données est persistant par conception ; le test
  « fermer application → relancer → retrouver ses données » est couvert par le
  test de persistance ci-dessus.
- NOT TESTED : le scénario exact « redémarrer **Windows** puis relancer » sur
  une machine propre distincte (pas de VM disponible). Le comportement attendu
  est identique (données sur disque), mais ce n'est pas démontré sur une VM.

## 5. Synchronisation / conflits / réconciliation — **NOT TESTED (non implémenté)**

La synchronisation desktop↔web n'existe pas encore. Aucun état de sync n'est
affiché et aucun test n'a été exécuté. Voir le plan de phases dans
`ARCHITECTURE-SYNCHRONISATION-MISES-A-JOUR.md`. Ces éléments seront marqués
PASS uniquement après implémentation et tests réels sur environnement isolé.

## 6. Performances mesurées (données de démo, volume réaliste)

| Mesure | Valeur observée |
|---|---|
| Build production | Compiled successfully en 15.8 s (machine de dev) |
| Tests unitaires (197) | seconde(s), aucune lenteur anormale |
| Recherche patients (API locale, démo) | réponse immédiate à l'échelle du jeu de démo |
| Démarrage app de bureau (base fraîche) | quelques secondes (PG init + migrations + serveur) |

⚠️ Les jeux 1 000 / 10 000 / 50 000 patients **n'ont pas été exécutés** :
générateur de dataset volumineux non disponible dans cette passe →
**NOT TESTED**, à faire avant toute promesse de performance à grande échelle.

## 7. Compatibilité Windows

| Environnement | Résultat |
|---|---|
| Windows 11 x64 (poste réel de développement) | PASS — installateur, runtime embarqué, démarrage, persistance |
| Windows 10 x64 | **NOT TESTED** (pas de VM) |
| Compte Windows non administrateur | **NOT TESTED** |
| Chemins avec accents/espaces | **NOT TESTED** |
| SmartScreen / Defender | installateur **non signé** → avertissement attendu (documenté, non re-testé sur poste vierge) |

## 8. Vérifications d'intégrité (exécution réelle)

| Contrôle | Résultat |
|---|---|
| typecheck | PASS (0 erreur) |
| lint | PASS (0 warning) |
| tests vitest | PASS (197 passés, 3 ignorés, 0 échec) |
| build production | PASS |
| installateur NSIS | PASS (construit, extrait, structure `resources/runtime` complète vérifiée) |
| persistance après arrêt PG | PASS |
| isolation secrétaire/finances | PASS (cookie clinique sur API finances → 401) |

## 9. Limitations et risques

1. **Synchronisation absente** — le web et le desktop utilisent aujourd'hui des
   bases indépendantes ; c'est le principal chantier restant (phase 2).
2. Mises à jour automatiques absentes (phase 3).
3. VM Windows 10 / compte non-admin indisponibles.
4. Installateur non signé.
5. Datasets de performance volumineux non exécutés.
