// =============================================================================
//  LANCEUR DES TESTS D'INTEGRATION SUR BASE JETABLE — scripts/test-sync.mjs
// =============================================================================
//  Démarre une instance PostgreSQL jetable (embedded-postgres), applique le
//  schéma via les migrations Prisma, exécute `vitest run tests/sync
//  tests/integration`, puis détruit la base. JAMAIS la base du cabinet.
// =============================================================================

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function portLibre(depart) {
  for (let port = depart; port < depart + 50; port++) {
    const libre = await new Promise((resoudre) => {
      const s = net.createServer()
      s.once('error', () => resoudre(false))
      s.once('listening', () => s.close(() => resoudre(true)))
      s.listen(port, '127.0.0.1')
    })
    if (libre) return port
  }
  throw new Error('Aucun port libre pour la base jetable.')
}

async function principal() {
  const { default: EmbeddedPostgres } = require('embedded-postgres')
  const port = await portLibre(54410)
  const dossier = fs.mkdtempSync(path.join(process.env.TEMP ?? racine, 'sahed-test-pg-'))
  // eslint-disable-next-line no-console -- outil de ligne de commande
  console.log(`Base jetable : ${dossier} (port ${port})`)
  const pg = new EmbeddedPostgres({
    databaseDir: dossier,
    user: 'sahed_test',
    password: 'sahed_test_pw',
    port,
    persistent: false,
    onLog: () => {},
    onError: (m) => console.error('[pg]', m),
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('sahed_test_db')
  const url = `postgresql://sahed_test:sahed_test_pw@127.0.0.1:${port}/sahed_test_db`

  // Migrations.
  execFileSync(
    process.execPath,
    [path.join(racine, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', '--schema', path.join(racine, 'database', 'prisma', 'schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit', timeout: 180_000 },
  )

  // Tests d'intégration : suites sync + integration.
  const enfant = spawn(
    process.execPath,
    [path.join(racine, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/sync', 'tests/integration', '--reporter=dot'],
    { env: { ...process.env, TEST_DATABASE_URL: url, DATABASE_URL: url, DATABASE_PROVIDER: 'postgresql' }, stdio: 'inherit' },
  )
  enfant.on('exit', async (code) => {
    try { await pg.stop() } catch {}
    try { fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    // eslint-disable-next-line no-console -- outil de ligne de commande
    console.log(`Base jetable détruite : ${dossier}`)
    process.exit(code ?? 0)
  })
}

principal().catch((e) => {
  console.error('Échec du harnais de test :', e)
  process.exit(1)
})
