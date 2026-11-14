// =============================================================================
//  HARNES DE BASE JETABLE POUR LES TESTS D'INTEGRATION — tests/helpers/pg-jetable.mjs
// =============================================================================
//  Audit G13 : la suite `tests/sync` était ignorée sans TEST_DATABASE_URL, et
//  donc « jamais prouvée » sur la machine de développement. Ce harnais démarre
//  AUTOMATIQUEMENT une instance PostgreSQL jetable (embedded-postgres, déjà
//  présent pour le runtime desktop), applique les migrations, puis expose
//  TEST_DATABASE_URL aux tests.
//
//  GARDE-FOUS :
//    - le dossier de données vit dans %TEMP%\sahed-test-pg-<pid>, détruit à la fin ;
//    - le port est choisi libre (54400+) pour éviter tout conflit ;
//    - JAMAIS la base du cabinet : le garde-fou de tests/helpers/db.ts reste actif ;
//    - sans succès de démarrage, on sort proprement : les suites restent
//      IGNORÉES (jamais simulées).
// =============================================================================

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

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
  throw new Error('Aucun port libre trouvé pour la base de test.')
}

/** Démarre la base jetable et renvoie DATABASE_URL, ou null si impossible. */
export async function demarrerBaseJetable() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  try {
    const { default: EmbeddedPostgres } = require('embedded-postgres')
    const port = await portLibre(54400)
    const dossier = path.join(fs.mkdtempSync(path.join(process.env.TEMP ?? '.', 'sahed-test-pg-')))
    const pg = new EmbeddedPostgres({
      databaseDir: dossier,
      user: 'sahed_test',
      password: 'sahed_test_pw',
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    })
    await pg.initialise()
    await pg.start()
    await pg.createDatabase('sahed_test_db')
    const url = `postgresql://sahed_test:sahed_test_pw@127.0.0.1:${port}/sahed_test_db`
    process.env.TEST_DATABASE_URL = url
    process.env.SAHED_TEST_PG_DOSSIER = dossier
    // Migrations : via le CLI Prisma du projet (présent dans node_modules).
    const { execFileSync } = require('node:child_process')
    const racine = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..', '..')
    execFileSync(
      process.execPath,
      [
        path.join(racine, 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate', 'deploy',
        '--schema', path.join(racine, 'database', 'prisma', 'schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 120_000 },
    )
    process.env.SAHED_TEST_PG = JSON.stringify({ port, dossier })
    return url
  } catch {
    return null
  }
}

/** Arrête et détruit la base jetable (appelé en fin de suite). */
export async function arreterBaseJetable() {
  if (!process.env.SAHED_TEST_PG) return
  const { port, dossier } = JSON.parse(process.env.SAHED_TEST_PG)
  try {
    const { execFileSync } = require('node:child_process')
    execFileSync('taskkill', ['/F', '/IM', 'postgres.exe', '/FI', `WINDOWTITLE eq sah-test-${port}`], { stdio: 'ignore' })
  } catch {}
  try {
    fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {}
  delete process.env.SAHED_TEST_PG
}
