# Migrations Prisma — SAHED DENTAL CLINIC

Les migrations de ce repertoire sont **versionnees** et **ecrites pour
PostgreSQL**. Chaque changement de schema doit passer par une migration : jamais
par une modification manuelle des tables en production.

## Contenu

| Migration | Objet |
|---|---|
| `20250101000000_initial_schema` | Tables, enums, index, cles etrangeres |
| `20250101000001_postgresql_integrity` | Contraintes `CHECK`, index partiels, extension `pg_trgm`, fonctions de verification |

La deuxieme migration ajoute des garanties que Prisma ne peut pas exprimer.
Voir `docs/DATABASE.md` (section 3) pour leur description complete, et
`docs/POSTGRESQL-VERIFICATION.md` pour la procedure de verification.

## Commandes

```bash
npm run db:migrate:dev      # creer une nouvelle migration (developpement)
npm run db:migrate:deploy   # appliquer les migrations (production)
npm run db:reset            # REMET LA BASE A ZERO (destructif, developpement)
```

## Regles

1. **Ne modifiez jamais une migration deja appliquee.** Prisma enregistre une
   empreinte de chaque migration ; la modifier provoquerait une divergence entre
   environnements. Creez une nouvelle migration.

2. **Toute migration doit etre reproductible** et testee avant la production.

3. **Suppression de colonne en deux temps.** Pour un champ contenant des
   donnees medicales ou financieres, ne supprimez pas directement la colonne :
   ajoutez la nouvelle, migrez les donnees, verifiez, puis supprimez l'ancienne
   dans une migration ulterieure.

4. **Les migrations sont additives autant que possible**, afin qu'un retour
   arriere de l'application reste possible sans revenir sur la base.

## Verification avant production

Sur une instance PostgreSQL reelle :

```bash
createdb sahed_verification
DATABASE_URL="postgresql://.../sahed_verification" npm run db:migrate:deploy
```

Puis appliquez la procedure de `docs/POSTGRESQL-VERIFICATION.md`.

> **Etat actuel :** ces migrations ont ete ecrites et versionnees, mais la
> migration `postgresql_integrity` **n'a pas ete executee** sur une instance
> PostgreSQL reelle au moment de la construction du projet (aucun PostgreSQL
> disponible sur la machine de developpement). Elle doit etre verifiee avant la
> mise en production, conformement a `docs/POSTGRESQL-VERIFICATION.md`.
