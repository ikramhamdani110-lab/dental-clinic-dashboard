// =============================================================================
//  SAHED DENTAL CLINIC — ELECTRON MAIN PROCESS
// =============================================================================
//  Orchestre le cycle de vie de l'application de bureau :
//    1. Demarrage d'un serveur PostgreSQL EMBARQUE (aucune installation requise)
//    2. Migration + seed de la base locale si premier lancement
//    3. Demarrage du serveur Next.js autonome (build de production)
//    4. Ouverture de la fenetre Electron pointant sur ce serveur local
//
//  Aucune connexion Internet n'est requise : la base, les pages et les donnees
//  residuent integralement sur le poste.
// =============================================================================

import { app, BrowserWindow, dialog, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_DEV = !!process.env.DESKTOP_DEV

// -----------------------------------------------------------------------------
//  Journal de demarrage (fichier dans AppData) : indispensable pour diagnostiquer
//  un echec de lancement sur le poste du medecin, sans console visible.
// -----------------------------------------------------------------------------
const LOG_FILE = path.join(app.getPath('userData'), 'startup.log')
function log(/** @type {string} */ message) {
  const line = `[${new Date().toISOString()}] ${message}`
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {}
  console.log(line)
}
process.on('uncaughtException', (e) => {
  log('EXCEPTION NON CAPTURÉE : ' + (e?.stack || String(e)))
})

// -----------------------------------------------------------------------------
//  Emplacements des fichiers de l'application
// -----------------------------------------------------------------------------
//  PACKAGÉ : le runtime complet (standalone, node.exe, node_modules PostgreSQL)
//  réside dans resources/runtime/ — copié verbatim par extraResources, jamais
//  élagué par electron-builder.
//  DEV : main.mjs réside dans desktop/, la racine du projet est au-dessus.
const APP_ROOT = IS_DEV ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'runtime')
const NEXT_STANDALONE = path.join(APP_ROOT, 'standalone')
// Les donnees persistent hors du dossier d'installation (AppData) : la
// desinstallation/mise a jour n'efface jamais le dossier clinique.
const DATA_DIR = path.join(app.getPath('userData'), 'clinique')
const PG_DIR = path.join(DATA_DIR, 'pg')
const DB_PORT = Number(process.env.DESKTOP_DB_PORT ?? 54329)
const WEB_PORT = Number(process.env.DESKTOP_WEB_PORT ?? 43177)

const DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${DB_PORT}/sahed_clinic`
const SESSION_SECRET =
  'desktop-local-secret-sahed-dental-clinic-2026-not-for-production'
const APP_PASSWORD_PEPPER = 'desktop-local-pepper-sahed-2026-secret'
const APP_URL = `http://127.0.0.1:${WEB_PORT}`

// Node embarqué dans l'application (aucune installation requise chez le
// medecin). En dev, on utilise celui de la machine.
const NODE_EXE = IS_DEV
  ? process.execPath
  : path.join(APP_ROOT, 'node.exe')

// -----------------------------------------------------------------------------
//  Etat global
// -----------------------------------------------------------------------------
let pgProcess = null
let nextProcess = null
let mainWindow = null
let quitting = false
// -----------------------------------------------------------------------------
//  Instance unique : un second lancement de l'application ne doit JAMAIS
//  entrer en conflit avec la première (mêmes ports, même base). Le second
//  processus se termine immédiatement (code 0), et la fenêtre existante est
//  ramenée au premier plan. Sans ce verrou, deux instances s'affronteraient
//  sur les ports 54329/43177 — et l'échec de la seconde resterait silencieux.
// -----------------------------------------------------------------------------
const aObtenuLeVerrou = app.requestSingleInstanceLock()
if (!aObtenuLeVerrou) {
  // Ce processus est le second : il se termine proprement, la première
  // instance (déjà en cours) gère l'affichage via 'second-instance'. Aucune
  // donnée n'est touchée, aucun nettoyage n'est requis.
  app.quit()
} else {
  app.on('second-instance', () => {
    // Un second lancement a été détecté : ramener la fenêtre au premier plan
    // pour que le médecin retrouve son travail au lieu de croire à un bug.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// -----------------------------------------------------------------------------
//  Vérification AMONT du port : si le port PostgreSQL ou Web est déjà occupé
//  (processus orphelin après un arrêt brutal, ou autre application), on
//  l'annonce CLAIREMENT avant tout démarrage, avec le PID du fautif. Sans ce
//  contrôle, `pg.start()` échouait avec une erreur interne peu claire, et le
//  médecin n'avait aucune piste.
// -----------------------------------------------------------------------------
async function portDejaOccupe(port) {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const socket = net.default.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function verifierPortsLibres() {
  const occupes = []
  for (const [nom, port] of [
    ['PostgreSQL', DB_PORT],
    ['serveur local', WEB_PORT],
  ]) {
    if (await portDejaOccupe(port)) {
      occupes.push(`${nom} (port ${port})`)
    }
  }
  if (occupes.length > 0) {
    throw new Error(
      `Le port de ${occupes.join(' et ')} est déjà utilisé par une autre ` +
        `application (ou un processus orphelin d'un arrêt brutal). ` +
        `Fermez cette application puis relancez. Journal : ${LOG_FILE}`,
    )
  }
}

// -----------------------------------------------------------------------------
//  PostgreSQL embarque
// -----------------------------------------------------------------------------
async function startDatabase() {
  const cheminModule = path.join(
    APP_ROOT,
    'node_modules',
    'embedded-postgres',
    'dist',
    'index.js',
  )
  if (!fs.existsSync(cheminModule)) {
    throw new Error(
      `Module PostgreSQL embarqué introuvable : ${cheminModule} (installation incomplète ?)`,
    )
  }
  const { default: EmbeddedPostgres } = await import(
    'file:///' + cheminModule.replace(/\\/g, '/')
  )
  const pg = new (/** @type {any} */ (EmbeddedPostgres))({
    databaseDir: PG_DIR,
    user: 'sahed',
    password: 'sahed_local_pw',
    port: DB_PORT,
    persistent: true,
    onLog: () => {},
    onError: (/** @type {unknown} */ msg) => console.error('[pg]', msg),
  })

  const alreadyInitialised = fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))
  if (!alreadyInitialised) {
    await pg.initialise()
  }
  await pg.start()
  if (!alreadyInitialised) {
    await pg.createDatabase('sahed_clinic')
  }
  pgProcess = pg
  return { pg, fresh: !alreadyInitialised }
}

// Attend la disponibilité de PostgreSQL (port ouvert) avant toute requête.
async function waitForPg(port, attempts = 60) {
  const net = await import('node:net')
  for (let i = 0; i < attempts; i++) {
    const ouvert = await new Promise((resolve) => {
      const socket = net.default.connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.setTimeout(1500, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ouvert) return
    await delay(500)
  }
  throw new Error(
    `PostgreSQL embarqué n'a pas démarré sur le port ${port} (données : ${PG_DIR})`,
  )
}

// -----------------------------------------------------------------------------
//  Migration (systematique) + seed (premier lancement uniquement)
// -----------------------------------------------------------------------------
//  La migration s'applique A CHAQUE demarrage : elle est idempotente (les
//  migrations deja appliquees sont ignorees), et le couvre le cas d'une base
//  initialisee puis abandonnée (crash, coupure) qui resterait sinon vide pour
//  toujours — bug observe : « fresh=false » sautait la migration alors que les
//  tables n'existaient pas, et la connexion echouait en 500.
// -----------------------------------------------------------------------------
async function migrateAndSeed(fresh) {
  // MIGRATION : TOUJOURS (idempotente — les migrations déjà appliquées sont
  // ignorées). Couvre le cas d'une base initialisée puis abandonnée (crash,
  // coupure) qui resterait sinon vide pour toujours.
  // SEED : uniquement au premier lancement (base fraîche).
  const scriptMigration = path.join(APP_ROOT, 'desktop', 'migrate.mjs')
  const scripts = [['migration', scriptMigration]]
  if (fresh) {
    scripts.push(['seed', path.join(APP_ROOT, 'desktop', 'seed.cjs')])
  }
  // NOTE SECURITE : ces identifiants initiaux ne sont PAS des secrets — c'est
  // une provenance connue pour le premier lancement, et le compte DOIT changer
  // son mot de passe des la premiere connexion (voir passwordChangedAt 1970).
  // Le hachage Argon2id est fait par le seed, jamais stocke en clair.
  const env = {
    ...process.env,
    DATABASE_URL,
    NODE_ENV: 'production',
    PASSWORD_PEPPER: APP_PASSWORD_PEPPER,
    ...(fresh
      ? {
          DOCTOR_EMAIL: process.env.DOCTOR_EMAIL ?? 'sahed@gmail.dz',
          DOCTOR_NAME: process.env.DOCTOR_NAME ?? 'Dr. Sahed',
          // Mot de passe initial demandé par le cabinet — DOIT être changé à
          // la première connexion (voir `passwordChangedAt`).
          DOCTOR_INITIAL_PASSWORD: process.env.DOCTOR_INITIAL_PASSWORD ?? 'sahed2026',
          // Le seed positionne `passwordChangedAt` à l'époque Unix pour forcer
          // le changement de mot de passe à la première connexion.
          FORCE_FIRST_LOGIN_PASSWORD_CHANGE: 'true',
        }
      : {}),
  }
  for (const [nom, script] of scripts) {
    if (!fs.existsSync(script)) {
      throw new Error(`Script ${nom} introuvable : ${script}`)
    }
    await run(NODE_EXE, [script], env)
  }
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    log(`Exécution : ${cmd} ${args.join(' ')}`)
    // stdio 'pipe' (PAS 'inherit') : l'application en GUI n'a pas de console,
    // la sortie des scripts de migration/seed serait perdue. Tout est re-dirigé
    // vers le journal de démarrage pour diagnostic post-installation.
    const child = spawn(cmd, args, { env, cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => log(`[${path.basename(String(cmd))}] ${String(d).trim()}`))
    child.stderr.on('data', (d) => log(`[${path.basename(String(cmd))}] ERREUR : ${String(d).trim()}`))
    child.on('exit', (code) => {
      if (code === 0) return resolve()
      const erreur = new Error(
        `Échec de ${path.basename(String(cmd))} (code ${code}) — détails dans le journal : ${LOG_FILE}`,
      )
      reject(erreur)
    })
    child.on('error', (e) => {
      log(`Erreur de lancement ${cmd} : ${e.message}`)
      reject(e)
    })
  })
}

// -----------------------------------------------------------------------------
//  Serveur Next.js autonome
// -----------------------------------------------------------------------------
function startNext() {
  const serverJs = path.join(NEXT_STANDALONE, 'server.js')
  if (!fs.existsSync(serverJs)) {
    dialog.showErrorBox(
      'Fichiers manquants',
      `Le serveur de l'application est introuvable :\n${serverJs}\n\nL'installation semble incomplète. Réinstallez l'application.`,
    )
    throw new Error(`server.js introuvable : ${serverJs}`)
  }
  log(`Démarrage du serveur local : ${NODE_EXE} ${serverJs}`)
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(WEB_PORT),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL,
    SESSION_SECRET,
    PASSWORD_PEPPER: APP_PASSWORD_PEPPER,
    APP_URL,
    COOKIE_SECURE: 'false',
    COOKIE_DOMAIN: '',
    LOG_LEVEL: 'warn',
    DOCUMENTS_STORAGE_PATH: path.join(DATA_DIR, 'documents'),
  }
  // stdio 'pipe' (PAS 'inherit') : l'application en GUI n'a pas de console —
  // la sortie du serveur (erreurs de démarrage Next.js, écoute du port) serait
  // perdue. Redirigée vers le journal pour tout diagnostic post-installation.
  nextProcess = spawn(NODE_EXE, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  nextProcess.stdout.on('data', (d) => log(`[next] ${String(d).trim()}`))
  nextProcess.stderr.on('data', (d) => log(`[next] ERREUR : ${String(d).trim()}`))
  nextProcess.on('error', (e) => log('Erreur node/next : ' + e.message))
  nextProcess.on('exit', (code) => {
    log(`Serveur local arrêté (code ${code})`)
    if (code !== 0 && !quitting) {
      dialog.showErrorBox(
        'Erreur interne',
        `Le serveur local s'est arrêté (code ${code}). Relancez l'application.`,
      )
    }
  })
}

// -----------------------------------------------------------------------------
//  Attente de disponibilite HTTP
// -----------------------------------------------------------------------------
async function waitForHttp(url, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume()
          resolve()
        })
        req.on('error', reject)
        req.setTimeout(2000, () => {
          req.destroy()
          reject(new Error('timeout'))
        })
      })
      return
    } catch {
      await delay(500)
    }
  }
  throw new Error(`Le serveur local n'a pas répondu : ${url}`)
}

// -----------------------------------------------------------------------------
//  Fenetre
// -----------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#05316E',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  Menu.setApplicationMenu(null)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.loadURL(APP_URL)
}

// -----------------------------------------------------------------------------
//  Arret propre
// -----------------------------------------------------------------------------
async function shutdown() {
  quitting = true
  try {
    nextProcess?.kill()
  } catch {}
  try {
    await pgProcess?.stop()
  } catch {}
  try {
    app.quit()
  } catch {}
}

app.on('window-all-closed', () => {
  // Pas de re-quitter ici : shutdown le fait deja.
  shutdown()
})
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault()
    shutdown()
  }
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// -----------------------------------------------------------------------------
//  Demarrage
// -----------------------------------------------------------------------------
app.whenReady().then(async () => {
  try {
    log(`Démarrage — APP_ROOT=${APP_ROOT} DATA_DIR=${DATA_DIR} NODE_EXE=${NODE_EXE}`)
    // Garde-fou AMONT : ports déjà pris ? (processus orphelin, autre app)
    await verifierPortsLibres()
    log('Ports libres — démarrage de PostgreSQL embarqué')
    const { fresh } = await startDatabase()
    log('PostgreSQL démarré — attente du port…')
    await waitForPg(DB_PORT)
    log(`PostgreSQL prêt sur le port ${DB_PORT}`)
    await migrateAndSeed(fresh)
    log('Migration/seed terminés')
    startNext()
    await waitForHttp(`${APP_URL}/api/health`)
    log(`Serveur Next.js prêt sur ${APP_URL} — ouverture de la fenêtre`)
    createWindow()
  } catch (erreur) {
    const details = String(
      erreur instanceof Error ? erreur.stack || erreur.message : erreur,
    )
    log('DÉMARRAGE ÉCHOUÉ : ' + details)
    dialog.showErrorBox(
      'Échec du démarrage',
      String(erreur instanceof Error ? erreur.stack || erreur.message : erreur),
    )
    app.quit()
  }
})
