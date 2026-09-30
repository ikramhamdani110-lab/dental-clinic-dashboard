/**
 * Initialisation commune des tests.
 *
 * Les tests s'executent dans un environnement Node sans base de donnees
 * PostgreSQL sur la machine de developpement. Les tests d'integration sont
 * donc conditionnes par la disponibilite d'une base (voir `tests/helpers/db.ts`),
 * tandis que les tests de logique metier pure (calculs financiers, fenetre de
 * 24 h, validation, anonymisation des journaux) s'executent partout.
 */

// Valeurs d'environnement minimales pour que `getEnv()` soit valide pendant les
// tests de logique. Aucune n'est un secret reel.
//
// `NODE_ENV` est une propriete en lecture seule dans les types Node : on ecrit
// via `Reflect.set` pour l'assigner sans casser le typage strict.
const env: NodeJS.ProcessEnv = process.env
if (!env.NODE_ENV) Reflect.set(env, 'NODE_ENV', 'test')
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/sahed_test'
process.env.DATABASE_PROVIDER = process.env.DATABASE_PROVIDER ?? 'postgresql'
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'test-secret-au-moins-32-caracteres-ok'
process.env.APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error'
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE ?? 'false'
