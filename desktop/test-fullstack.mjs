// =============================================================================
//  TEST PILE COMPLETE : PG embarqué + serveur Next standalone
// =============================================================================
//  Démarre la base, applique les migrations + seed, lance le serveur Next de
//  resources\standalone sur 127.0.0.1, puis teste : santé, login, patients,
//  rendez-vous, paiements, rapports. Arrête tout proprement à la fin.
// =============================================================================

import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const APP_ROOT = path.join(racine, 'desktop', 'resources')
const DATA_DIR = path.join(racine, '.desktop-test', 'clinique')
const PG_DIR = path.join(DATA_DIR, 'pg')
const DB_PORT = 54329
const WEB_PORT = 58440
const DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${DB_PORT}/sahed_clinic`
const BASE = `http://127.0.0.1:${WEB_PORT}`

const enfants = []
let pg // eslint-disable-line -- assigné puis lu (arrêt propre)

async function arreterTout(code) {
  for (const e of enfants) { try { e.kill() } catch {} }
  try { if (pg) await pg.stop() } catch {}
  process.exit(code ?? 0)
}

process.on('SIGINT', () => arreterTout(0))
process.on('SIGTERM', () => arreterTout(0))

function attendre(reponseOk, msMax, libelle) {
  return new Promise((resolve, reject) => {
    const debut = Date.now()
    const verif = async () => {
      try {
        const r = await reponseOk()
        if (r) return resolve(r)
      } catch (e) {
        if (process.env.DESKTOP_TEST_DEBUG) console.log('  [attente]', libelle, e.message)
      }
      if (Date.now() - debut > msMax) {
        console.log('---- Logs serveur (au moment du délai dépassé) ----\n' + sortieServeur.slice(-2500))
        return reject(new Error('Délai dépassé : ' + libelle))
      }
      setTimeout(verif, 500)
    }
    verif()
  })
}

function requete(url, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, options, (res) => {
      let corps = ''
      res.on('data', (d) => (corps += d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corps }))
    })
    r.on('error', reject)
    if (options.body) r.write(options.body)
    r.end()
  })
}

// --- 1. Base embarquée -----------------------------------------------------
const { default: EmbeddedPostgres } = await import(
  'file:///' + path.join(APP_ROOT, 'node_modules', 'embedded-postgres', 'dist', 'index.js').replace(/\\/g, '/')
)
pg = new EmbeddedPostgres({
  databaseDir: PG_DIR, user: 'sahed', password: 'sahed_local_pw',
  port: DB_PORT, persistent: true, onLog: () => {}, onError: (m) => console.error('[pg]', m),
})
const fresh = !fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))
if (fresh) await pg.initialise()
await pg.start()
if (fresh) await pg.createDatabase('sahed_clinic')
console.log('[1] PG embarqué démarré (fresh =', fresh, ')')

// --- 2. Migrations + seed --------------------------------------------------
const env = {
  ...process.env, DATABASE_URL,
  PASSWORD_PEPPER: 'desktop-local-pepper-sahed-2026-secret',
  DOCTOR_EMAIL: 'sahed@gmail.dz',
  DOCTOR_NAME: 'Dr. Sahed',
  DOCTOR_INITIAL_PASSWORD: 'sahed2026',
  FORCE_FIRST_LOGIN_PASSWORD_CHANGE: 'true',
  NODE_ENV: 'production',
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env, cwd: APP_ROOT, stdio: 'inherit' })
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('exit ' + code + ' : ' + args.join(' ')))))
    c.on('error', reject)
  })
}
await run(process.execPath, [path.join(APP_ROOT, 'desktop', 'migrate.mjs')])
await run(process.execPath, [path.join(APP_ROOT, 'desktop', 'seed.cjs')])
console.log('[2] Migrations + seed OK')

// --- 3. Serveur Next standalone --------------------------------------------
const serveur = spawn(process.execPath, ['server.js'], {
  cwd: path.join(APP_ROOT, 'standalone'),
  env: {
    ...env,
    PORT: String(WEB_PORT),
    HOSTNAME: '127.0.0.1',
    APP_URL: BASE,
    SESSION_SECRET: 'desktop-test-secret-32-chars-minimum-OK',
    COOKIE_SECURE: 'false',
    COOKIE_DOMAIN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
enfants.push(serveur)
let sortieServeur = ''
serveur.stdout.on('data', (d) => (sortieServeur += d))
serveur.stderr.on('data', (d) => (sortieServeur += d))
await attendre(async () => (await requete(BASE + '/api/health')).status === 200, 30000, 'serveur Next')
console.log('[3] Serveur Next démarré sur', BASE)

// --- 4. Login ---------------------------------------------------------------
const mdpInvalide = await requete(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'sahed@gmail.dz', password: 'MAUVAIS' }),
})
console.log('[4a] Login mot de passe invalide →', mdpInvalide.status, '(attendu 401)')

const login = await requete(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'sahed@gmail.dz', password: 'sahed2026' }),
})
console.log('[4b] Login valide →', login.status, '(attendu 200/2xx)')
if (login.status >= 300) {
  console.log('Réponse:', login.corps.slice(0, 300))
  console.log('---- Logs serveur ----\n' + sortieServeur.slice(-2000))
  await arreterTout(1)
}
const listeCookies = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0])
const cookies = listeCookies.join('; ')
const csrf = listeCookies.find((c) => c.startsWith('sahed_csfr=') || c.startsWith('sahed_csrf='))?.split('=').slice(1).join('=') ?? ''
console.log('Cookie de session récupéré:', cookies ? 'OUI' : 'NON', '| jeton CSRF:', csrf ? 'OUI' : 'NON')

// Premier accès : la connexion avec le mot de passe initial DOIT signaler
// qu'un changement est requis avant toute autre action.
const corpsLogin = JSON.parse(login.corps || '{}')
console.log('doitChangerMotDePasse:', corpsLogin?.doitChangerMotDePasse ? 'OUI ✅' : 'NON ❌')

// Base propre : aucune donnée de démonstration ne doit exister après seed.
const patientsInitiaux = await requete(BASE + '/api/patients?page=1', { headers: { cookie: cookies } })
const nbPatients = (() => { try { const j = JSON.parse(patientsInitiaux.corps); return j?.data?.total ?? j?.total ?? (Array.isArray(j?.data) ? j.data.length : null) } catch { return null } })()
console.log('Patients en base après seed (attendu 0):', nbPatients ?? patientsInitiaux.corps.slice(0, 120))

// --- 5. API protégées -------------------------------------------------------
async function tester(nom, chemin) {
  const r = await requete(BASE + chemin, { headers: { cookie: cookies } })
  console.log(`[5] ${nom} ${chemin} →`, r.status)
  if (r.status >= 300) console.log('   corps:', r.corps.slice(0, 200))
  return r
}
const patients = await tester('Patients', '/api/patients?page=1')
await tester('Rendez-vous', '/api/appointments?page=1')
await tester('Paiements', '/api/payments?page=1')
await tester('Rapports revenus', '/api/reports/revenue')
await tester('Tableau de bord', '/api/dashboard')

// --- 6. Écriture : créer un patient ----------------------------------------
const creation = await requete(BASE + '/api/patients', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
  body: JSON.stringify({
    prenom: 'Test', nom: 'Offline', genre: 'M',
    telephone: '0555000111', dateNaissance: '1990-05-15',
  }),
})
console.log('[6] Création patient →', creation.status, '(attendu 201/200)')
if (creation.status >= 300) {
  console.log('   corps:', creation.corps.slice(0, 400))
  console.log('---- Logs serveur ----\n' + sortieServeur.slice(-2000))
}

// --- 6b. Écriture : rendez-vous et paiement ---------------------------------
const corpsPatient = JSON.parse(creation.corps || '{}')
const idPatient = corpsPatient?.data?.id ?? corpsPatient?.patient?.id ?? corpsPatient?.id
if (idPatient) {
  const rdv = await requete(BASE + '/api/appointments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
    body: JSON.stringify({
      patientId: idPatient,
      // Créneau futur unique par exécution : la base de test est persistante,
      // un créneau fixe entrerait en conflit avec le run précédent.
      dateDebut: new Date(Date.now() + (7 * 86400000) + Math.floor(Math.random() * 300) * 60000).toISOString(),
      dateFin: new Date(Date.now() + (7 * 86400000) + Math.floor(Math.random() * 300) * 60000 + 1800000).toISOString(),
      motif: 'Consultation',
      statut: 'PLANIFIE',
    }),
  })
  console.log('[6b] Création rendez-vous →', rdv.status, '(attendu 201/200)')
  if (rdv.status >= 300) console.log('   corps:', rdv.corps.slice(0, 400))
  const corpsRdv = JSON.parse(rdv.corps || '{}')
  // Un paiement est rattaché à un TRAITEMENT : on en crée un d'abord.
  const traitement = await requete(BASE + '/api/treatments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
    body: JSON.stringify({
      patientId: idPatient,
      typeTraitement: 'Consultation',
      prixTotalCentimes: 500000,
      statut: 'TERMINE',
      dateDebut: new Date().toISOString(),
    }),
  })
  console.log('[6c] Création traitement →', traitement.status, '(attendu 201/200)')
  if (traitement.status >= 300) console.log('   corps:', traitement.corps.slice(0, 400))
  const corpsTraitement = JSON.parse(traitement.corps || '{}')
  const idTraitement = corpsTraitement?.data?.id ?? corpsTraitement?.traitement?.id ?? corpsTraitement?.id
  if (idTraitement) {
    const paiement = await requete(BASE + '/api/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf },
      body: JSON.stringify({
        patientId: idPatient,
        treatmentId: idTraitement,
        montantCentimes: 500000,
        datePaiement: new Date().toISOString(),
        methode: 'ESPECES',
        idempotencyKey: 'test-e2e-' + Date.now(),
      }),
    })
    console.log('[6d] Création paiement →', paiement.status, '(attendu 201/200)')
    if (paiement.status >= 300) console.log('   corps:', paiement.corps.slice(0, 400))
  } else {
    console.log('[6d] idTraitement introuvable, paiement non testé :', traitement.corps.slice(0, 200))
  }
} else {
  console.log('[6b] idPatient introuvable, rendez-vous/paiement non testés :', creation.corps.slice(0, 200))
}

// --- 7. Persistance : arrêter PG, redémarrer, relire ------------------------
console.log('[7] Arrêt et redémarrage de la base pour test de persistance…')
await pg.stop()
await new Promise((r) => setTimeout(r, 2000))
await pg.start()
await new Promise((r) => setTimeout(r, 2000))
let trouve = false
for (let essai = 0; essai < 3 && !trouve; essai++) {
  const relire = await requete(BASE + '/api/patients?search=Offline', { headers: { cookie: cookies } })
  trouve = relire.corps.includes('Offline')
  if (!trouve) await new Promise((r) => setTimeout(r, 1500))
}
console.log('[7] Patient "Test Offline" retrouvé après redémarrage :', trouve ? 'OUI ✅' : 'NON ❌')

console.log('\n===== RÉSUMÉ =====')
console.log('Login:', login.status < 300 ? 'OK' : 'ÉCHEC')
console.log('APIs:', patients.status < 300 ? 'OK' : 'ÉCHEC')
console.log('Persistance:', trouve ? 'OK' : 'ÉCHEC')
await arreterTout(trouve ? 0 : 1)
