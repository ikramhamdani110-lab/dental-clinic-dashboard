# Rapport — final handover (2026-11-02)

Complète `RAPPORT-FINAL-MISE-EN-SERVICE.md`.

## Déploiement Vercel (vérifié réel)

- 3 commits poussés sur `main` : moteur de synchronisation, correction du
  schéma dupliqué, schemas financiers + tableau de bord sans finance.
  Commit final sur origin/main : **`b8b1c07`**.
- Dernier déploiement prod : **READY**
  `https://dental-clinic-dashboard-6p4vcr9sd-ikram-it.vercel.app` (branche main).
- ⚠ **Alias projet obsolète** : `dental-clinic-dashboard.vercel.app` répond
  avec une version antérieure (405 sur POST /api). Utilisez l'URL de
  déploiement directe OU promouvez l'alias depuis le dashboard Vercel
  (Deployments → ⋯ → Promote to Production Alias) — 30 secondes, aucun code.
- Logs runtime : 0 erreur.

## Comptes (vérifiés par login réel sur le déploiement prod)

| | statut |
|---|---|
| Secrétaire `clinic@gmail.dz` ASSISTANT, changement forcé | **200** ✅ |
| Médecin `sahed@gmail.dz` MEDECIN, changement forcé | **200** ✅ |
| `demo@cabinet.dz` désactivé (`isActive=false`) | ✅ |

## Isolation des rôles (testée en prod réel)

| Test | Résultat |
|---|---|
| Médecin → `/api/finances/summary` avec SESSION FINANCIÈRE | **200** ✅ |
| Médecin → `/api/finances/summary` avec SESSION CLINIQUE | **401** ✅ — les deux mondes ne partagent aucun cookie |
| Secrétaire → `/api/finances/summary` | **401** ✅ |
| Secrétaire → `/api/finances/auth` | **422** ✅ (rôle ASSISTANT refusé par `connexionFinanciere`, côté serveur) |

## Vercel Deployment Protection

Les URLs de déploiement individuelles (`*-ikram-it.vercel.app`) peuvent être
protégées par « Vercel Authentication ». Cela ne bloque PAS l'usage réel :
le domaine de production (alias promu ou domaine personnalisé) est public.

## Tests automatiques (tous exécutés)

- vitest : **241/241** (base PostgreSQL réelle jetable)
- typecheck ✔ · lint ✔ (`--max-warnings=0`) · build ✔

## Actions restantes (nécessitent votre matériel ou décision)

1. **Promotion de l'alias** (30 s dans le dashboard Vercel) OU configuration
   d'un domaine personnalisé — sinon donnez aux utilisateurs l'URL de
   déploiement directe ci-dessus.
2. **Appairage du poste Windows réel** : installer l'exe, se connecter avec
   `clinic@gmail.dz`, puis `/parametres` → Appareils → appairer. La phrase de
   récupération s'affiche une seule fois.
3. Rotation des mots de passe après première connexion (imposée par le
   système).
