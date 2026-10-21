// Harness de test : démarre le PG embarqué exactement comme main.mjs, puis
// applique migrations + seed, et laisse la base tourner pour tests manuels.
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const APP_ROOT = path.join(racine, 'desktop', 'resources')
const DATA_DIR = path.join(racine, '.desktop-test', 'clinique')
const PG_DIR = path.join(DATA_DIR, 'pg')
const DB_PORT = 54329
const DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${DB_PORT}/sahed_clinic`
try {
  console.log('[0] Chargement embedded-postgres depuis', path.join(APP_ROOT, 'node_modules', 'embedded-postgres'))
  const mod = await import(
    'file:///' + path.join(APP_ROOT, 'node_modules', 'embedded-postgres', 'dist', 'index.js').replace(/\\/g, '/')
  )
  console.log('[0] embedded-postgres charge, default =', typeof mod.default, Object.keys(mod).slice(0, 5))
  var EmbeddedPostgres = mod.default ?? mod.EmbeddedPostgres
  console.log('[0] point d entree du package:', JSON.stringify(fs.readFileSync(path.join(APP_ROOT, 'node_modules', 'embedded-postgres', 'package.json'), 'utf8').slice(0, 400)))
} catch (e) {
  console.error('[0] ECHEC import :', e && e.message)
  throw e
}

const pg = new EmbeddedPostgres({
  databaseDir: PG_DIR,
  user: 'sahed',
  password: 'sahed_local_pw',
  port: DB_PORT,
  persistent: true,
  onLog: () => {},
  onError: (m) => console.error('[pg]', m),
})
try {
  const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))
  console.log('[1] PG_VERSION existe ?', !fresh, '-> fresh =', fresh)
  if (fresh) {
    console.log('[1a] Initialisation du cluster...')
    await pg.initialise()
    console.log('[1a] Cluster initialise.')
  }
  await pg.start()
  console.log('[1] pg.start() OK')
  // Création idempotente : si la base existe déjà, on ignore l'erreur.
  try {
    await pg.createDatabase('sahed_clinic')
    console.log('[1b] Base sahed_clinic créée.')
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e)
    if (/already exists/i.test(msg)) {
      console.log('[1b] Base sahed_clinic déjà présente.')
    } else {
      console.error('[1b] createDatabase a échoué avec :', msg)
      throw e
    }
  }
} catch (e) {
  console.error('[1] ERREUR PG (catch externe) :', typeof e, e === undefined ? 'UNDEF' : (e && e.message ? e.message : String(e)))
  if (e && e.stack) console.error(e.stack)
  process.exit(1)
}
console.log('[1] PG embarque demarre sur port', DB_PORT)

// Applique les migrations via notre runner (meme logique que main.mjs)
const nodeExe = path.join(APP_ROOT, 'node.exe')
const envMig = {
  ...process.env,
  DATABASE_URL,
  PASSWORD_PEPPER: 'desktop-local-pepper-sahed-2026-secret',
    DOCTOR_EMAIL: 'sahed@gmail.dz',
    DOCTOR_NAME: 'Dr. Sahed',
    DOCTOR_INITIAL_PASSWORD: 'sahed2026',
    FORCE_FIRST_LOGIN_PASSWORD_CHANGE: 'true',
    NODE_ENV: 'production',
  }

function lancer(script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(nodeExe, [script, ...args], {
      cwd: APP_ROOT,
      env: envMig,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('exit ' + code + ' : ' + out.slice(-800)))))
  })
}

const mig = path.join(APP_ROOT, 'desktop', 'migrate.mjs')
const seed = path.join(APP_ROOT, 'desktop', 'seed.cjs')
console.log('[2] Migrations...')
await lancer(mig, [])
console.log('[3] Seed...')
await lancer(seed, [])
console.log('[4] OK — base prete et donnees semées.')
console.log('    DATABASE_URL :', DATABASE_URL)
console.log('    Le processus PG reste actif. Ctrl+C pour arreter.')

const arret = async () => {
  try { await pg.stop() } catch {}
  process.exit(0)
}
process.on('SIGINT', arret)
process.on('SIGTERM', arret)
// Sur Windows, garder le processus vivant indéfiniment.
setInterval(() => {}, 1 << 30)