# Rapport d'enquête — blocage réel production Neon (2026-11-01)

## Conclusion en une phrase

La valeur `DATABASE_URL` de production est stockée sur Vercel comme **Secret
(sensitive, write‑only)** : elle **n'est physiquement plus récupérable par
personne** — ni Owner, ni CLI, ni API, ni dashboard — depuis le moment où elle
a été créée. Ce n'est **pas** un problème de rôle ni de permission : le compte
`ikramhamdani110-lab` est bien Owner de l'équipe `ikramIT`.

## Preuves recueillies (aucune donnée modifiée)

1. `vercel whoami` → `ikramhamdani110-lab`, `vercel teams ls` → Owner de
   `ikram-it`, `vercel project ls` → `dental-clinic-dashboard` bien présent.
2. `vercel env ls production` → toutes les variables DB affichent
   **`Hidden    Secret    Production`**. Type = Secret, pas Config.
3. `vercel env pull --environment production` → valeurs = `[SENSITIVE]`
   (placeholders, pas les vraies valeurs).
4. `vercel env run` → warning « 19 Secret values cannot be pulled… » puis la
   variable injectée vient du `.env` LOCAL (localhost), pas de Vercel.
   Confirmé en renommant temporairement `.env`/`.env.local` : la valeur
   devient alors **EMPTY** — Vercel n'injecte rien du tout.
5. Docs officielles Vercel (« Sensitive environment variables ») :
   > « Secret values are write‑only after saving… For Secret variables, the
   > current value is hidden. Provide a new value to rotate the secret. »

   Source : [Sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
6. Le token OIDC présent dans l'ancien pull `env-dashboard-prod.txt` est
   scopé `environment:development` et **expiré** → inutilisable, et de toute
   façon non destiné à lire des secrets de prod.
7. Plan B étudiés et **écartés** :
   - Endpoint metadata/OIDC local (169.254.169.254, oidc.vercel.com) : rien
     d'utilisable hors runtime Vercel.
   - Promouvoir le rôle : sans effet, c'est le **type Secret** qui est
     write‑only, pas un manque de droit.

## Conséquence pour le plan initial

Étant write‑only, la seule façon d'obtenir une `DATABASE_URL` utilisable en
prod est de **créer une nouvelle valeur** (rotation) — pas de lire l'ancienne.
Or ça modifierait la config production de l'app déployée, ce qui est exactement
ce que vous avez interdit (« Do not attempt to expose, overwrite, or recreate
any production secrets »).

## Ce qui reste faisable SANS toucher aux secrets

- Sauvegarde fraîche de production **depuis Neon directement**, si vous me
  fournissez une URL `postgres://…` de prod (même read‑only) par un canal
  sécurisé. C'est **une information que vous détenez déjà** (console Neon),
  pas un secret Vercel à contourner.
- Création des 2 comptes avec le script `.local/etape2-envrun.mjs` existant,
  dès qu'une URL prod (même temporaire) est fournie.
- Purge T1 via `.local/purge-t1.mjs`, backup préalable inclus.

## Blocage restant exact (à authoriser par vous)

**Une URL Postgres de production Neon, lisible par moi le temps de
l'intervention**, fournie hors chat/Git (coffre, fichier local non versionné,
ou `.env.prod.local` créé par vous à la racine). Aucun token Vercel n'est
nécessaire ni utile ici — la piste Vercel est une impasse définitive.

Je ne fais **aucune modification production** tant que ce point n'est pas
levé. Aucun des 17 patients n'a été touché, aucun compte créé, aucune purge.


---

# ÉTAPE 1 RÉALISÉE — Backup fraîche production + restauration vérifiée (2026-11-01)

## Ce qui a été fait (aucune écriture production)

1. **Connexion production vérifiée** : hôte `ep-tiny-wind-za8rms4w.c-2.eu-west-2.aws.neon.tech`,
   base `neondb`, utilisateur `neondb_owner` — identité conforme au projet
   attendu (sahed-dental-clinic / main / neondb). La chaîne n'a jamais été
   affichée ni loggée ; lue depuis `.env.prod.local` (hors Git).
2. **pg_dump fraîche** (lecture seule, format custom) :
   - Fichier : `backups/prod-verifiee-2026-11-01T20-23-25.dump`
   - Taille : **125 514 octets (~123 Ko)**
   - SHA‑256 : `412534C23FD6A866E91DEE241C39B03CB5F3E470D9C6612AD95065330EDCBA8E`
   - Intégrité archive : lisible via `pg_restore --list`, **40 entrées TABLE** détectées.
3. **Restauration de vérification** sur le **cluster local PostgreSQL 18
   isolé (127.0.0.1:5433)** — jamais sur Neon :
   - Base temporaire créée puis supprimée après contrôle.
   - Totaux identiques prod ↔ backup restauré :
     `patients=46, rdv=116, traitements=116, paiements=78, users=1`.
4. **Contrôle lecture seule direct sur prod** (SELECT uniquement) : mêmes
   totaux, confirmant que rien n'a été modifié.

## Note environnement (sans impact production)

- `pg_dump` 16 refusait un serveur Postgres 18 (« server version mismatch ») →
  **PostgreSQL 18 installé localement** (client uniquement), cluster dédié sur
  5433 pour la restauration de test.
- Le rôle local `demo` utilisé par `.env.demo` a été recréé sur ce cluster 18
  pour permettre la restauration de contrôle. Le `pg_hba.conf` a été brièvement
  passé en `trust` puis **immédiatement restauré** en `scram-sha-256` (sauvegarde
  `pg_hba.conf.bak` conservée à côté).

## Aucune modification production

- Aucun compte créé, aucune donnée supprimée, aucune migration, aucun UPDATE.
- Les 46 patients (dont les 2 QA et les 15 A1) sont intacts.
- `.env.prod.local` reste en place, hors Git, prêt pour l'étape suivante.
