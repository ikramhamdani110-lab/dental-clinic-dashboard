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

import { app, BrowserWindow, dialog, Menu, Tray, ipcMain, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_DEV = !!process.env.DESKTOP_DEV

// -----------------------------------------------------------------------------
//  GARDE-FOU : MODE NODE ACCIDENTEL
// -----------------------------------------------------------------------------
//  Si la variable `ELECTRON_RUN_AS_NODE` est presente dans l'environnement, le
//  binaire Electron s'execute comme un simple Node : AUCUNE fenetre n'apparait
//  et le processus se termine aussitot, sans le moindre message.
//
//  Panne reellement constatee : une session de developpement avait exporte
//  cette variable. L'application « ne demarrait pas » alors qu'elle etait saine,
//  et le diagnostic etait impossible — pas de fenetre, pas de journal.
//
//  Ce bloc ne peut pas empecher Electron d'adopter le mode Node (la decision est
//  prise avant l'execution de ce fichier), MAIS il laisse une trace explicite
//  dans le journal de demarrage, et il retire la variable pour tous les
//  processus enfants (node.exe du serveur Next, migration, seed) : sans cela,
//  le serveur embarque demarrerait lui aussi en mode degrade.
// -----------------------------------------------------------------------------
if (process.env.ELECTRON_RUN_AS_NODE) {
  const avertissement =
    'ATTENTION : ELECTRON_RUN_AS_NODE est definie dans l environnement. ' +
    'L application ne peut pas ouvrir de fenetre dans cet etat. ' +
    'Lancez-la depuis une session normale (ou supprimez cette variable).'
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'startup.log'),
      `[${new Date().toISOString()}] ${avertissement}\n`,
    )
  } catch {}
  console.error(avertissement)
  // Les enfants ne doivent pas heriter de ce mode.
  delete process.env.ELECTRON_RUN_AS_NODE
}

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
const DB_PORT_BASE = Number(process.env.DESKTOP_DB_PORT ?? 54329)
const WEB_PORT = Number(process.env.DESKTOP_WEB_PORT ?? 43177)

// Ports PostgreSQL candidats. Le port de base reste 54329 (comportement
// historique), mais si un socket FANTOME d'un postgres tue monopolise ce port
// (cas reel au cabinet : le handle survit au processus et refuse tout), on
// bascule automatiquement sur le port suivant. Les donnees ne dependent PAS
// du port : le dossier PG_DIR est identique, rien n'est perdu.
const DB_PORT_CANDIDATS = [DB_PORT_BASE, DB_PORT_BASE + 1, DB_PORT_BASE + 2]
let DB_PORT = DB_PORT_BASE
let DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${DB_PORT}/sahed_clinic`

function definirDbPort(/** @type {number} */ port) {
  DB_PORT = port
  DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${port}/sahed_clinic`
}

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
let tray = null

// SYNCHRONISATION — modules chargés après le démarrage de PostgreSQL
// (voir demarrerSync plus bas). Audit G1 : le watcher était du code mort.
let watcher = null
let etatSync = { mode: 'NON_APPAIRE' }
let fileSync = null
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

// -----------------------------------------------------------------------------
//  NETTOYAGE DES ORPHELINS POSTGRESQL
// -----------------------------------------------------------------------------
//  Probleme reel observe sur le poste du cabinet : apres un arret brutal
//  (coupure, fermeture forcee), un postgres.exe orphelin garde le port 54329
//  en LISTENING mais ne repond PLUS jamais (socket fantome : TCP accepte,
//  aucune reponse au protocole). La verification de port le voyait « occupe »
//  et l'application refusait de demarrer — ou migrait en boucle infinie.
//
//  Remede : si un postgres.exe orphelin utilise NOTRE dossier de donnees
//  (PG_DIR), on le termine — c'est notre propre serveur, pas la base d'un
//  tiers. On supprime aussi le postmaster.pid perime. Aucune donnee n'est
//  touchee : le dossier PG_DIR reste intact et PostgreSQL redemarre dessus.
//
//  PORTEE DU NETTOYAGE — POINT CRITIQUE
//  On ne cible PAS « tout postgres.exe ». Un postgres.exe peut appartenir a une
//  autre application du poste (un autre logiciel, un serveur de developpement) :
//  le tuer serait une faute grave. Le filtre exige que la ligne de commande
//  contienne LE CHEMIN EXACT de notre dossier de donnees (PG_DIR), qui est
//  propre a cet utilisateur Windows et a cette application.
function arreterOrphelinsPostgres() {
  const pidFile = path.join(PG_DIR, 'postmaster.pid')
  /** @type {number[]} */
  let pids = []
  try {
    /*
     * La comparaison porte sur `PG_DIR` (ex.
     * `C:\Users\pc\AppData\Roaming\Clinique Sahed\clinique\pg`).
     *
     * Le chemin est passé par variable d'environnement plutôt qu'inséré dans
     * la commande PowerShell : il contient un espace (« Clinique Sahed ») et
     * pourrait contenir une apostrophe dans le nom d'utilisateur. Une
     * interpolation directe casserait la condition et, au mieux, ne
     * nettoierait rien ; au pire, elle ciblerait le mauvais processus.
     */
    const sortie = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | " +
          'Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:SAHED_PG_DIR) } | ' +
          'Select-Object -ExpandProperty ProcessId) -join \',\'',
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, SAHED_PG_DIR: PG_DIR },
      },
    )
    pids = String(sortie || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch {
    pids = []
  }
  if (pids.length > 0) {
    log('Nettoyage : processus PostgreSQL orphelins a arreter : ' + pids.join(', '))
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        })
      } catch {}
    }
  }
  // postmaster.pid perime : PostgreSQL refuserait de demarrer ou signalerait
  // un serveur « deja en cours ». Le supprimer est sans danger quand aucun
  // processus n'ecoute reellement notre port.
  try {
    if (fs.existsSync(pidFile)) {
      const premiereLigne = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]
      const pid = Number(premiereLigne)
      let vivant = false
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          vivant = true
        } catch {
          vivant = false
        }
      }
      if (!vivant) {
        fs.rmSync(pidFile, { force: true })
        log('Nettoyage : postmaster.pid perime supprime')
      }
    }
  } catch {}
  return pids.length
}

/** Le port accepte-t-il VRAIMENT le protocole PostgreSQL (et pas un socket fantome) ? */
async function portRepondVraiment(port, timeoutMs = 2500) {
  const net = await import('node:net')
  return new Promise((resolve) => {
    let fini = false
    const terminer = (/** @type {boolean} */ v) => {
      if (fini) return
      fini = true
      try { socket.destroy() } catch {}
      resolve(v)
    }
    const socket = net.default.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      // SSLRequest PostgreSQL : reponse attendue 'S' (SSL) ou 'N' (non SSL).
      const buf = Buffer.alloc(8)
      buf.writeInt32BE(8, 0)
      buf.writeInt32BE(80877103, 4)
      socket.write(buf)
    })
    socket.once('data', () => terminer(true))
    socket.once('error', () => terminer(false))
    socket.once('close', () => terminer(false))
    socket.setTimeout(timeoutMs, () => terminer(false))
  })
}

async function verifierPortsLibres() {
  // ---- PostgreSQL : nettoyage des orphelins puis selection d'un port sain ----
  // Un port est « sain » s'il est libre OU occupé par un PostgreSQL qui répond
  // réellement (instance déjà lancée par cette application). Un socket fantôme
  // ne répond jamais : on le contourne en changeant de port.
  arreterOrphelinsPostgres()
  await delay(300)

  let portChoisi = null
  for (const port of DB_PORT_CANDIDATS) {
    const occupe = await portDejaOccupe(port)
    if (!occupe) {
      portChoisi = port
      break
    }
    if (await portRepondVraiment(port)) {
      // Un vrai PostgreSQL écoute déjà : c'est probablement une instance
      // résiduelle de CETTE application. On ne tue pas les données, on
      // réutilise ce port uniquement si c'est bien le nôtre ; sinon on
      // passe au suivant pour rester prudent.
      log(`Port ${port} occupé par un PostgreSQL actif — essai du port suivant`)
      continue
    }
    log(`Port ${port} en etat fantome (aucune reponse PostgreSQL) — ignore`)
  }

  if (portChoisi === null) {
    throw new Error(
      `Aucun port PostgreSQL disponible parmi ${DB_PORT_CANDIDATS.join(', ')}. ` +
        `Fermez les applications utilisant ces ports puis relancez. Journal : ${LOG_FILE}`,
    )
  }
  definirDbPort(portChoisi)
  log(`Port PostgreSQL retenu : ${DB_PORT}`)

  // ---- Serveur web local ----
  if (await portDejaOccupe(WEB_PORT)) {
    if (!(await portRepondAvecHttp(WEB_PORT))) {
      log(`Port ${WEB_PORT} en etat fantome — poursuite du demarrage`)
    } else {
      throw new Error(
        `Le port du serveur local (${WEB_PORT}) est déjà utilisé par une autre ` +
          `application. Fermez cette application puis relancez. Journal : ${LOG_FILE}`,
      )
    }
  }
}

/** Le port web répond-il à une requête HTTP (et pas un socket fantome) ? */
async function portRepondAvecHttp(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let fini = false
    const terminer = (/** @type {boolean} */ v) => {
      if (fini) return
      fini = true
      resolve(v)
    }
    try {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
        (res) => {
          res.resume()
          terminer(true)
        },
      )
      req.on('timeout', () => { req.destroy(); terminer(false) })
      req.on('error', () => terminer(false))
    } catch {
      terminer(false)
    }
  })
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

// Attend la disponibilité de PostgreSQL AVANT toute requête.
// IMPORTANT : on ne se contente PAS d'un TCP-connect réussi. Un socket
// fantome (postgres orphelin tué, handle survécu) accepte la connexion TCP
// mais ne répond JAMAIS : l'ancien test passait alors que le serveur était
// mort, et la migration restait bloquée indéfiniment (cause du blocage
// observé au cabinet). On exige donc une VRAIE réponse au protocole
// PostgreSQL (réponse 'S' ou 'N' à SSLRequest).
async function waitForPg(port, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (await portRepondVraiment(port)) return
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
          DOCTOR_EMAIL: process.env.DOCTOR_EMAIL ?? 'clinic@gmail.dz',
          DOCTOR_NAME: process.env.DOCTOR_NAME ?? 'Secrétaire',
          // Mot de passe initial demandé par le cabinet — DOIT être changé à
          // la première connexion (voir `passwordChangedAt`).
          DOCTOR_INITIAL_PASSWORD: process.env.DOCTOR_INITIAL_PASSWORD ?? 'Clinic+123',
          DOCTOR_ROLE: process.env.DOCTOR_ROLE ?? 'ASSISTANT',
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
    nextProcess = null
    if (quitting) return
    // SUPERVISION (audit G8) : le backend se relance TOUT SEUL après un crash,
    // avec un backoff et un plafond — jamais de boucle infinie.
    planifierRelanceNext()
  })
}

// -----------------------------------------------------------------------------
//  SUPERVISION DU BACKEND — relance automatique après un crash.
//  Backoff exponentiel 2 s → 60 s, plafonné à 5 essais consécutifs : au-delà,
//  un message explicite s'affiche au lieu de tourner en boucle. Un démarrage
//  réussi réinitialise le compteur.
// -----------------------------------------------------------------------------
let essaisRelanceNext = 0

function planifierRelanceNext() {
  if (quitting || essaisRelanceNext >= 5) {
    if (essaisRelanceNext >= 5) {
      const message =
        `Le serveur local n'a pas réussi à redémarrer après ${essaisRelanceNext} tentatives.\n\n` +
        `Fermez complètement l'application (icône tray → Quitter) puis relancez-la.\n` +
        `Journal complet : ${LOG_FILE}`
      log('SUPERVISION : plafond de relances atteint — intervention requise.')
      dialog.showErrorBox('Serveur local indisponible', message)
    }
    return
  }
  essaisRelanceNext += 1
  const attente = Math.min(60_000, 2 ** essaisRelanceNext * 1000)
  log(`SUPERVISION : relance du serveur local dans ${attente / 1000} s (essai ${essaisRelanceNext}/5)`)
  setTimeout(async () => {
    if (quitting) return
    try {
      if (await portRepondAvecHttp(WEB_PORT, 1500)) {
        // Quelque chose répond déjà : pas besoin de relancer.
        essaisRelanceNext = 0
        return
      }
      startNext()
      await waitForHttp(`${APP_URL}/api/health`)
      essaisRelanceNext = 0
      log('SUPERVISION : serveur local relancé avec succès.')
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(APP_URL).catch(() => {})
    } catch (e) {
      log('SUPERVISION : échec de relance — ' + String(e?.message ?? e))
      planifierRelanceNext()
    }
  }, attente)
}

/** Surveillant de santé : sonde /api/health toutes les 30 s ; relance si mort. */
function demarrerSurveillantSante() {
  setInterval(async () => {
    if (quitting) return
    const vivant = await portRepondAvecHttp(WEB_PORT, 2500)
    if (!vivant && !nextProcess) {
      log('SURVEILLANT : backend injoignable — relance programmée.')
      planifierRelanceNext()
    }
  }, 30_000).unref()
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
      // Preload étroit : expose UNIQUEMENT l'état de sync + l'appairage
      // (audit G9). Aucune API Node, aucun fichier, aucun secret.
      preload: path.join(__dirname, 'preload.cjs'),
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
//  TRAY — FERMER LA FENÊTRE ≠ ARRÊTER LE BACKEND (audit G8)
// -----------------------------------------------------------------------------
//  La fenêtre de l'application peut être fermée (le médecin passe à autre
//  chose) : le backend et la base CONTINUENT de tourner en arrière-plan, et
//  la synchronisation aussi. L'icône tray permet de rouvrir la fenêtre ou de
//  QUITTER réellement l'application (arrêt propre de Next puis PostgreSQL).
//  Comportement standard d'une application Windows de fond de poste.
// -----------------------------------------------------------------------------
let exitDemandeParUtilisateur = false

function creerTray() {
  try {
    const iconePath = path.join(IS_DEV ? path.resolve(__dirname, '..') : process.resourcesPath, 'ico', 'icon.ico')
    const image = fs.existsSync(iconePath)
      ? nativeImage.createFromPath(iconePath)
      : nativeImage.createEmpty()
    tray = new Tray(image.isEmpty() ? path.join(APP_ROOT, 'ico', 'icon.ico') : image)
  } catch {
    // Repli : tray avec une image vide (16x16 transparent) plutôt qu'un crash.
    try {
      tray = new Tray(nativeImage.createEmpty())
    } catch (e) {
      log('Tray indisponible : ' + String(e?.message ?? e))
      return
    }
  }
  tray.setToolTip('Clinique Sahed')
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
  const menu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir Clinique Sahed',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      },
    },
    {
      label: 'Synchroniser maintenant',
      click: () => {
        watcher?.cycleMaintenant().catch(() => {})
      },
    },
    { type: 'separator' },
    {
      label: 'Quitter (arrête le serveur local)',
      click: () => {
        exitDemandeParUtilisateur = true
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

// -----------------------------------------------------------------------------
//  Arret propre
// -----------------------------------------------------------------------------
async function shutdown() {
  quitting = true
  try {
    watcher?.arreter()
  } catch {}
  try {
    const { fermerWatcher } = await import('./sync/net-watcher.mjs')
    await fermerWatcher()
  } catch {}
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
  // AUDIT G8 : la fermeture de la fenêtre N'ARRÊTE PAS le backend. L'icône
  // tray reste active ; l'application ne quitte que par « Quitter » du menu
  // tray (exitDemandeParUtilisateur) ou par l'arrêt de Windows.
  if (exitDemandeParUtilisateur) {
    shutdown()
  }
  // Sinon : rien — le backend continue en arrière-plan.
})
app.on('before-quit', (e) => {
  if (!quitting && !exitDemandeParUtilisateur) {
    // Quitter via Windows (arrêt système) : arrêt propre.
    e.preventDefault()
    shutdown()
    return
  }
  if (!quitting) {
    e.preventDefault()
    shutdown()
  }
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// -----------------------------------------------------------------------------
//  SYNCHRONISATION — démarrage après le serveur local (audit G1)
// -----------------------------------------------------------------------------
async function demarrerSync() {
  try {
    // La file (CommonJS) résout @prisma/client depuis le node_modules du
    // runtime embarqué : DESKTOP_SEED_STANDALONE pointe dessus.
    process.env.DESKTOP_SEED_STANDALONE = path.join(NEXT_STANDALONE, 'node_modules')
    process.env.APP_ROOT = APP_ROOT
    process.env.DESKTOP_DATA_DIR = DATA_DIR
    process.env.SAHED_DESKTOP_LOCAL = '1'
    const queueModule = await import('./sync/queue.mjs')
    fileSync = queueModule
    const { demarrerWatcher } = await import('./sync/net-watcher.mjs')
    watcher = demarrerWatcher({
      queue: fileSync,
      log,
      surEtat: (etat) => {
        etatSync = etat
        // Propagation à l'interface via le canal preload (audit G9).
        try {
          mainWindow?.webContents.send('sahed:sync-etat', etat)
        } catch {}
        try {
          tray?.setToolTip(`Clinique Sahed — ${libelleEtatSync(etat)}`)
        } catch {}
      },
    })
    log('Surveillant de synchronisation démarré.')
  } catch (e) {
    log('Sync NON démarrée : ' + String(e?.stack ?? e))
  }
}

function libelleEtatSync(etat) {
  switch (etat?.mode) {
    case 'SYNCED': return 'Synchronisé'
    case 'SYNCING': return 'Synchronisation en cours…'
    case 'OFFLINE': return 'Hors ligne — données enregistrées sur cet ordinateur'
    case 'ERREUR': return 'Échec de synchronisation'
    case 'SESSION_EXPIREE': return 'Session en ligne expirée — reconnexion requise'
    case 'APPAREIL_REVOQUE': return 'Appareil révoqué — synchronisation désactivée'
    case 'NON_APPAIRE': return 'Synchronisation désactivée (appairage requis)'
    default: return 'Clinique Sahed'
  }
}

// -----------------------------------------------------------------------------
//  IPC — ÉTAT DE SYNC + APPAIRAGE (audit G9, §4 sécurité)
// -----------------------------------------------------------------------------
function enregistrerIpc() {
  ipcMain.handle('sahed:sync-etat-actuel', () => etatSync)
  ipcMain.handle('sahed:sync-derniere', async () => {
    try {
      const { obtenirDerniereSynchro } = await import('./sync/config.mjs')
      return await obtenirDerniereSynchro()
    } catch {
      return null
    }
  })
  ipcMain.handle('sahed:sync-compteurs', async () => {
    try {
      return await fileSync.compteurs()
    } catch {
      return null
    }
  })
  ipcMain.handle('sahed:sync-configurer', async (_e, { url, jetonSession }) => {
    try {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error('L’URL doit être en HTTPS.')
      }
      if (typeof jetonSession !== 'string' || jetonSession.length < 20) {
        throw new Error('Session de connexion invalide.')
      }
      const { definirUrlServeur, definirAppareil } = await import('./sync/config.mjs')
      const { appairer } = await import('./sync/client.mjs')
      const { randomUUID } = await import('node:crypto')
      await definirUrlServeur(url)
      const deviceId = randomUUID()
      const { jeton, phraseRecuperation } = await appairer(url, jetonSession, deviceId, 'Bureau Windows')
      await definirAppareil(deviceId, jeton)
      watcher?.definirSession(jetonSession)
      watcher?.cycleMaintenant().catch(() => {})
      return { ok: true, phraseRecuperation }
    } catch (e) {
      return { ok: false, erreur: String(e?.message ?? e) }
    }
  })
  ipcMain.handle('sahed:sync-cycle', async () => {
    try {
      await watcher?.cycleMaintenant()
      return { ok: true }
    } catch (e) {
      return { ok: false, erreur: String(e?.message ?? e) }
    }
  })
}

// -----------------------------------------------------------------------------
//  Demarrage
// -----------------------------------------------------------------------------
app.whenReady().then(async () => {
  try {
    log(`Démarrage — APP_ROOT=${APP_ROOT} DATA_DIR=${DATA_DIR} NODE_EXE=${NODE_EXE}`)
    enregistrerIpc()
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
    creerTray()
    demarrerSurveillantSante()
    // SYNCHRONISATION (audit G1) : démarrée APRÈS que la base et le serveur
    // local sont prêts. Elle tourne en arrière-plan et ne bloque jamais l'UI.
    await demarrerSync()
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
