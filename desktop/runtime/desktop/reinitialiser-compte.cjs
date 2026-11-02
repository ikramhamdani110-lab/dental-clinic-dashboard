// =============================================================================
//  RÉINITIALISATION LOCALE DU COMPTE MÉDECIN — PROCÉDURE D'URGENCE
// =============================================================================
//  Si le mot de passe du compte médecin est oublié :
//
//    1. FERMER complètement l'application Clinique Sahed (aucun processus
//       "Clinique Sahed.exe" dans le Gestionnaire des tâches).
//    2. Lancer, depuis le dossier du projet :
//         node desktop\reinitialiser-compte.cjs <email> <nouveau-mot-de-passe>
//       ou en mode interactif : node desktop\reinitialiser-compte.cjs
//    3. Relancer l'application et se connecter avec le nouveau mot de passe
//       (le changement de mot de passe sera demandé à la première connexion).
//
//  Le script démarre LUI-MÊME la base PostgreSQL embarquée de l'application
//  installée (sans toucher aux données), met à jour UNIQUEMENT la ligne du
//  compte médecin (hash Argon2id + pepper, compteur d'échecs et verrou remis
//  à zéro), puis arrête la base proprement. Patients, rendez-vous, paiements,
//  documents : AUCUNE autre table n'est modifiée.
//
//  Sécurité : le mot de passe n'apparaît jamais en clair dans les logs, seul
//  le hash est écrit en base, aucun fichier temporaire n'est conservé.
// =============================================================================
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')

const APPDATA = process.env.APPDATA
if (!APPDATA) {
  console.error('APPDATA indisponible : lancez ce script depuis une session utilisateur normale.')
  process.exit(1)
}
const DATA_DIR = path.join(APPDATA, 'Clinique Sahed', 'clinique')
const PG_DIR = path.join(DATA_DIR, 'pg')
const CANDIDATS_RUNTIME = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Clinique Sahed', 'resources', 'runtime'),
  path.join(__dirname, 'runtime'),
]
const RUNTIME = CANDIDATS_RUNTIME.find((p) => p && fs.existsSync(path.join(p, 'node.exe')))
if (!RUNTIME) {
  console.error('Runtime de l application introuvable : installez l application, ou lancez ce script depuis le dossier du projet.')
  process.exit(1)
}
const NODE_MODULES = path.join(RUNTIME, 'standalone', 'node_modules')
const PG_BIN = path.join(RUNTIME, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin')
const DB_PORT = Number(process.env.DESKTOP_DB_PORT ?? 54329)
const DATABASE_URL = `postgresql://sahed:sahed_local_pw@127.0.0.1:${DB_PORT}/sahed_clinic`
const PEPPER = 'desktop-local-pepper-sahed-2026-secret'

function valider(emailBrut, motDePasseBrut) {
  const email = String(emailBrut || '').trim().toLowerCase()
  const motDePasse = String(motDePasseBrut || '')
  if (!email || !email.includes('@')) {
    console.error('ERREUR : email invalide.')
    process.exit(1)
  }
  if (motDePasse.length < 8) {
    console.error('ERREUR : le mot de passe doit contenir au moins 8 caractères.')
    process.exit(1)
  }
  return { email, motDePasse }
}

const args = process.argv.slice(2).filter(Boolean)
let directes = null
if (args.length >= 2) directes = valider(args[0], args[1])

function processusAppActifs() {
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Clinique Sahed.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return (r.stdout || '').includes('Clinique Sahed.exe')
  } catch {
    return false
  }
}
if (processusAppActifs()) {
  console.error('ERREUR : l application Clinique Sahed est en cours d exécution.')
  console.error('Fermez-la complètement (vérifiez le Gestionnaire des tâches) puis relancez ce script.')
  process.exit(1)
}

function demarrerPostgres() {
  if (!fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) {
    console.error('ERREUR : base de données introuvable dans ' + PG_DIR + '.')
    console.error("L'application n'a jamais été lancée sur ce poste, ou le dossier de données est absent.")
    process.exit(1)
  }
  const postmaster = path.join(PG_DIR, 'postmaster.pid')
  if (fs.existsSync(postmaster)) {
    spawnSync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DIR, 'stop', '-m', 'fast'], { stdio: 'ignore' })
    try { fs.rmSync(postmaster, { force: true }) } catch {}
  }
  const enfant = spawn(path.join(PG_BIN, 'postgres.exe'), ['-D', PG_DIR, '-p', String(DB_PORT)], { stdio: 'ignore' })
  enfant.unref()
  return enfant
}

function attendrePort(port, tentatives = 30) {
  return new Promise((resolve) => {
    let essai = 0
    const tenter = () => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); prochain() })
      socket.setTimeout(1000, () => { socket.destroy(); prochain() })
    }
    const prochain = () => {
      essai += 1
      if (essai >= tentatives) return resolve(false)
      setTimeout(tenter, 500)
    }
    tenter()
  })
}

function arreterPostgres(enfant) {
  try { if (enfant && !enfant.killed) enfant.kill() } catch {}
  spawnSync(path.join(PG_BIN, 'pg_ctl.exe'), ['-D', PG_DIR, 'stop', '-m', 'fast'], { stdio: 'ignore' })
}

async function reinitialiser(email, motDePasse) {
  console.log('Démarrage de la base de données embarquée (modification du compte uniquement)…')
  const enfant = demarrerPostgres()
  let ok = false
  try {
    const pret = await attendrePort(DB_PORT)
    if (!pret) throw new Error("La base n'a pas démarré sur le port " + DB_PORT + '.')
    // Attendre que PostgreSQL accepte rÃ©ellement les connexions (le port peut
    // Ãªtre ouvert avant la fin de la rÃ©cupÃ©ration aprÃ¨s un arrÃªt brutal).
    const cheminPg = [path.join(RUNTIME, 'node_modules', 'pg'), path.join(NODE_MODULES, 'pg')].find((p) => fs.existsSync(p))
    const { Client } = require(cheminPg)
    for (let essai = 0; essai < 30; essai++) {
      const c = new Client({ connectionString: DATABASE_URL })
      try {
        await c.connect()
        await c.end()
        break
      } catch (e) {
        await c.end().catch(() => {})
        if (essai === 29) throw new Error('La base refuse les connexions : ' + e.message)
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    const { PrismaClient } = require(path.join(NODE_MODULES, '@prisma', 'client'))
    const argon2 = require(path.join(NODE_MODULES, 'argon2'))
    const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
    try {
      const hash = await argon2.hash(motDePasse + PEPPER, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      })
      const compte = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true },
      })
      if (!compte) {
        console.error('ERREUR : aucun compte avec cet email : ' + email)
        console.error("Vérifiez l'email (compte créé au premier lancement de l'application).")
        process.exitCode = 1
        return
      }
      await prisma.user.update({
        where: { id: compte.id },
        data: {
          passwordHash: hash,
          passwordChangedAt: new Date(0),
          isActive: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      })
      console.log('Mot de passe du compte ' + email + ' réinitialisé (haché Argon2id).')
      console.log('Patients, rendez-vous, paiements et documents : INTACTS.')
      ok = true
    } finally {
      await prisma.$disconnect()
    }
  } catch (e) {
    console.error('ERREUR pendant la réinitialisation :', e.message)
    console.error("Aucune modification n'a été appliquée : le mot de passe actuel reste valide.")
    process.exitCode = 1
  } finally {
    console.log('Arrêt de la base de données…')
    arreterPostgres(enfant)
  }
  if (!ok) process.exit(1)
}

if (directes) {
  reinitialiser(directes.email, directes.motDePasse)
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('Réinitialisation du compte médecin — Clinique Sahed (desktop)')
  console.log('Dossier de données : ' + DATA_DIR)
  rl.question('Email du médecin : ', (email) => {
    rl.question('Nouveau mot de passe : ', (motDePasse) => {
      rl.close()
      const v = valider(email, motDePasse)
      reinitialiser(v.email, v.motDePasse)
    })
  })
}
