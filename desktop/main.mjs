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
//  Emplacements des fichiers de l'application
// -----------------------------------------------------------------------------
const APP_ROOT = IS_DEV ? path.resolve(__dirname, '..') : process.resourcesPath
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
//  PostgreSQL embarque
// -----------------------------------------------------------------------------
async function startDatabase() {
  const { default: EmbeddedPostgres } = await import(
    'file:///' +
      path
        .join(APP_ROOT, 'node_modules', 'embedded-postgres', 'dist', 'index.js')
        .replace(/\\/g, '/')
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

// -----------------------------------------------------------------------------
//  Migration + seed (premier lancement uniquement)
// -----------------------------------------------------------------------------
async function migrateAndSeed(fresh) {
  if (!fresh) return
  // NOTE SECURITE : ces identifiants initiaux ne sont PAS des secrets — c'est
  // une provenance connue pour le premier lancement, et le compte DOIT changer
  // son mot de passe des la premiere connexion (voir passwordChangedAt 1970).
  // Le hachage Argon2id est fait par le seed, jamais stocke en clair.
  const env = {
    ...process.env,
    DATABASE_URL,
    NODE_ENV: 'production',
    PASSWORD_PEPPER: APP_PASSWORD_PEPPER,
    DOCTOR_EMAIL: process.env.DOCTOR_EMAIL ?? 'sahed@gmail.dz',
    DOCTOR_NAME: process.env.DOCTOR_NAME ?? 'Dr. Sahed',
    // Mot de passe initial demande par le cabinet — DOIT être changé à la
    // première connexion (voir `passwordChangedAt`).
    DOCTOR_INITIAL_PASSWORD: process.env.DOCTOR_INITIAL_PASSWORD ?? 'sahed2026',
    // Le seed positionne `passwordChangedAt` à l'époque Unix pour forcer le
    // changement de mot de passe à la première connexion (voir ci-dessous).
    FORCE_FIRST_LOGIN_PASSWORD_CHANGE: 'true',
  }
  await run(NODE_EXE, [path.join(APP_ROOT, 'desktop', 'migrate.mjs')], env)
  await run(NODE_EXE, [path.join(APP_ROOT, 'desktop', 'seed.cjs')], env)
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, cwd: APP_ROOT, stdio: 'inherit' })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    )
    child.on('error', reject)
  })
}

// -----------------------------------------------------------------------------
//  Serveur Next.js autonome
// -----------------------------------------------------------------------------
function startNext() {
  const serverJs = path.join(NEXT_STANDALONE, 'server.js')
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
  nextProcess = spawn(NODE_EXE, [serverJs], { env, stdio: 'inherit' })
  nextProcess.on('exit', (code) => {
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
    const { fresh } = await startDatabase()
    await migrateAndSeed(fresh)
    startNext()
    await waitForHttp(`${APP_URL}/api/health`)
    createWindow()
  } catch (erreur) {
    console.error('[desktop] démarrage échoué', erreur)
    dialog.showErrorBox(
      'Échec du démarrage',
      String(erreur instanceof Error ? erreur.stack || erreur.message : erreur),
    )
    app.quit()
  }
})
