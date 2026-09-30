import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Configuration des tests.
 *
 * Les tests s'executent dans un environnement Node. Les tests de logique metier
 * pure (calculs financiers, fenetre de 24 h, validation, anonymisation des
 * journaux) ne dependent d'aucune base et s'executent partout.
 *
 * Les tests d'integration, qui necessitent une base PostgreSQL, sont decrits
 * dans docs/TESTS.md : ils s'executent contre une instance reelle et ne sont
 * jamais simules.
 *
 * Les tests s'executent en serie (`fileParallelism: false`) : ceux qui
 * partagent un etat (base, compteurs) produiraient autrement des assertions
 * instables, donc trompeuses.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@backend': fileURLToPath(new URL('./backend', import.meta.url)),
      '@database': fileURLToPath(new URL('./database', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
})
