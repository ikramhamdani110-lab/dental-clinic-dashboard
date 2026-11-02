// Instance PostgreSQL jetable pour les tests desktop (port 54331)
// Donnees dans .desktop-test/pgdata-test — supprimee apres les tests.
const { spawn, spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, rmSync } = require('node:fs')
const path = require('node:path')
const DOSSIER = path.resolve(__dirname, '..', '.desktop-test', 'pgdata-test')
const PORT = '54331'
const BIN = 'C:\\Program Files\\PostgreSQL\\16\\bin'
const action = process.argv[2]

if (action === 'init') {
  if (existsSync(DOSSIER)) { console.log('deja initialise'); process.exit(0) }
  mkdirSync(DOSSIER, { recursive: true })
  const r = spawnSync(path.join(BIN, 'initdb.exe'), ['-D', DOSSIER, '-U', 'test', '-A', 'trust', '-E', 'UTF8'], { stdio: 'inherit' })
  process.exit(r.status)
}
if (action === 'start') {
  const fils = spawn(path.join(BIN, 'postgres.exe'), ['-D', DOSSIER, '-p', PORT], { detached: true, stdio: 'ignore' })
  fils.unref()
  console.log('demarre sur ' + PORT)
  process.exit(0)
}
if (action === 'stop') {
  const r = spawnSync(path.join(BIN, 'pg_ctl.exe'), ['stop', '-D', DOSSIER, '-m', 'fast'], { stdio: 'inherit' })
  process.exit(r.status ?? 0)
}
if (action === 'clean') {
  try { spawnSync(path.join(BIN, 'pg_ctl.exe'), ['stop', '-D', DOSSIER, '-m', 'fast'], { stdio: 'ignore' }) } catch { }
  rmSync(DOSSIER, { recursive: true, force: true })
  console.log('supprime')
}
