import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Demarre / arrete l'instance PostgreSQL de DEMONSTRATION.
 *
 * Cette instance est un cluster SEPARE : son repertoire de donnees est
 * `.demo-pg/data`, distinct de celui de la base du cabinet, et il ecoute sur le
 * port 5433. Aucune commande de ce script ne peut atteindre `sahed_clinic`.
 */

const DOSSIER = resolve(process.cwd(), '.demo-pg', 'data')
const PORT = '5433'
const BIN = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\16\\bin'
const action = process.argv[2]

if (!existsSync(DOSSIER)) {
  console.error(
    `Le cluster de demonstration est absent (${DOSSIER}).\n` +
      'Executez : npm run db:demo:install',
  )
  process.exit(1)
}

if (action === 'start') {
  const fils = spawn(
    resolve(BIN, 'postgres.exe'),
    ['-D', DOSSIER, '-p', PORT],
    { detached: true, stdio: 'ignore' },
  )
  fils.unref()
  process.stdout.write(`Instance de demonstration demarree sur le port ${PORT}.\n`)
  process.exit(0)
}

if (action === 'stop') {
  // `pg_ctl` attend la fin du processus : on l'appelle de maniere synchrone.
  const resultat = spawnSync(resolve(BIN, 'pg_ctl.exe'), ['stop', '-D', DOSSIER, '-m', 'fast'], {
    stdio: 'inherit',
    shell: true,
  })
  process.exit(resultat.status ?? 0)
}

console.error('Usage : node scripts/demo-db.mjs <start|stop>')
process.exit(1)
