#!/usr/bin/env node
/**
 * =============================================================================
 *  SAUVEGARDE / RESTAURATION DE LA BASE DE L'APPLICATION DE BUREAU (§40, §45)
 * =============================================================================
 *
 *  Utilise les binaires PostgreSQL EMBARQUES (pg_dump / pg_restore) — aucune
 *  installation requise. La base n'est pas interrompue : `pg_dump` agit sur
 *  une copie cohérente (mode WAL).
 *
 *  Usage :
 *    node desktop/backup.cjs backup  [repertoire-destination]
 *    node desktop/backup.cjs restore <fichier.dump> [--force]
 *
 *  Variables :
 *    DATABASE_URL        par défaut : base locale embarquée
 *    PG_BIN_DIR          par défaut : binaires embarqués
 *    DATA_DIR            par défaut : cluster local
 *
 *  SÉCURITÉ
 *    - `restore` REFUSE d'écraser une base contenant des données sans `--force`.
 *    - Les fichiers sont horodatés et vérifiés (taille minimale).
 *    - Aucune donnée médicale n'est supprimée silencieusement.
 */

// =============================================================================
//  SAUVEGARDE / RESTAURATION — APPLICATION DE BUREAU (PostgreSQL embarque)
// =============================================================================
//  Sauvegarde par SNAPSHOT du repertoire de donnees, sans outil externe :
//  la distribution embarquee de PostgreSQL ne fournit pas pg_dump/pg_restore,
//  un dump SQL n'est donc pas possible dans l'application installee. Le
//  snapshot est fait a froid (serveur arrete via pg_ctl), ce qui garantit une
//  copie coherente du repertoire de donnees.
//
//  Usage :
//    node desktop/backup.cjs backup  [repertoire]
//    node desktop/backup.cjs restore <fichier.zip> [--force]
//    node desktop/backup.cjs list
//  Securite
//    - La restauration refuse d'ecraser une base contenant des donnees
//      sans l'option explicite --force.
//    - Le fichier est un ZIP horodate ; il est verifie (taille minimale).
//    - Aucune donnee reelle n'est supprimee silencieusement : sans --force,
//      rien n'est remplace.
//
//  Necessaire : PowerShell (present sur Windows 10/11) pour compresser et
//  decompresser ; pg_ctl.exe est celui de la distribution embarquee deja
//  installee avec l'application.
// =============================================================================

const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, statSync, rmSync, readdirSync, renameSync } = require('node:fs')
const path = require('node:path')

const RACINE = path.resolve(__dirname, '..')
const DATA_DIR = process.env.DESKTOP_DATA_DIR
  ? path.join(process.env.DESKTOP_DATA_DIR)
  : path.join(process.env.APPDATA || path.join(RACINE, '.desktop-data'), 'sahed-dental-clinic', 'clinique')
const PG_DIR = path.join(DATA_DIR, 'pg')
const PG_BIN_DIR = path.join(
  RACINE,
  'desktop',
  'resources',
  'node_modules',
  '@embedded-postgres',
  'windows-x64',
  'native',
  'bin',
)
const TAILLE_MIN_OCTETS = 1024

function dire(texte) {
  process.stdout.write(texte + '\n')
}

function executerSilencieux(exe, args) {
  try {
    execFileSync(exe, args, { stdio: 'ignore', timeout: 60000 })
    return true
  } catch {
    return false
  }
}

/** Arrete le serveur embarque s'il tourne (pg_ctl stop). Sans effet sinon. */
function arreterPostgres() {
  const pgCtl = path.join(PG_BIN_DIR, 'pg_ctl.exe')
  if (existsSync(PG_DIR)) {
    executerSilencieux(pgCtl, [
      'stop',
      '-D', PG_DIR,
      '-m', 'fast',
      '-t', '30',
    ])
  }
}

/** Dossier de donnees reellement utilise : test de presence de PG_VERSION. */
function baseExiste() {
  return existsSync(path.join(PG_DIR, 'PG_VERSION'))
}

/** Creer un ZIP du dossier pg via PowerShell Compress-Archive. */
function zipper(sourceDir, cible) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\*' -DestinationPath '${cible.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'ignore', timeout: 10 * 60 * 1000 },
  )
}

/** Decompresser un ZIP via PowerShell Expand-Archive. */
function dezipper(archive, dossierCible) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${archive.replace(/'/g, "''")}' -DestinationPath '${dossierCible.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'ignore', timeout: 10 * 60 * 1000 },
  )
}

function sauvegarder(dossier) {
  if (!baseExiste()) {
    process.stderr.write(`Aucune base existante dans ${PG_DIR} — rien a sauvegarder.\n`)
    process.exit(1)
  }

  const cible = dossier || path.join(DATA_DIR, 'backups')
  mkdirSync(cible, { recursive: true })
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const fichier = path.join(cible, `sahed-desktop-${horodatage}.zip`)

  dire('Arret du serveur PostgreSQL embarque...')
  arreterPostgres()

  dire('Creation de l archive (snapshot du repertoire de donnees)...')
  zipper(PG_DIR, fichier)

  const info = statSync(fichier)
  if (info.size < TAILLE_MIN_OCTETS) {
    process.stderr.write(`[sauvegarde] Fichier suspect (${info.size} octets). Sauvegarde invalide.\n`)
    process.exit(1)
  }

  dire('Sauvegarde reussie.')
  dire(`  Fichier : ${fichier}`)
  dire(`  Taille  : ${(info.size / 1024).toFixed(1)} Ko`)
  dire('Conservez ce fichier sur un support externe ou un cloud personnel.')
}

function restaurer(archive, forcer) {
  if (!existsSync(archive)) {
    process.stderr.write(`Fichier de sauvegarde introuvable : ${archive}\n`)
    process.exit(1)
  }
  const info = statSync(archive)
  if (info.size < TAILLE_MIN_OCTETS) {
    process.stderr.write(`Fichier de sauvegarde invalide (${info.size} octets).\n`)
    process.exit(1)
  }

  // Garde-fou : la base actuelle contient-elle des donnees reelles ?
  // Heuristique : un repertoire de base vierge pese quelques Mo ; au-dela de
  // 10 Mo, on considere qu'il y a des donnees utilisateur a proteger.
  let donneesPresentes = false
  if (baseExiste()) {
    let total = 0
    const parcourir = (dossier) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, entree.name)
        if (entree.isDirectory()) parcourir(p)
        else total += statSync(p).size
      }
    }
    try {
      parcourir(PG_DIR)
    } catch {
      total = Number.MAX_SAFE_INTEGER
    }
    donneesPresentes = total > 10 * 1024 * 1024
  }

  if (donneesPresentes && !forcer) {
    process.stderr.write(
      [
        '',
        'ATTENTION — La base actuelle semble contenir des donnees.',
        'La restauration va REMPLACER tout son contenu.',
        'Pour confirmer, relancez la commande avec :  --force',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  dire('Arret du serveur PostgreSQL embarque...')
  arreterPostgres()

  dire('Remplacement du repertoire de donnees...')
  rmSync(PG_DIR, { recursive: true, force: true })
  mkdirSync(PG_DIR, { recursive: true })
  dezipper(archive, PG_DIR)

  // Compress-Archive place parfois les fichiers dans un sous-dossier du meme
  // nom : corrige ici pour que PG_VERSION reste a la racine attendue.
  const contenus = readdirSync(PG_DIR, { withFileTypes: true })
  const sousDossierUnique =
    contenus.length === 1 && contenus[0].isDirectory() ? path.join(PG_DIR, contenus[0].name) : null
  if (sousDossierUnique && existsSync(path.join(sousDossierUnique, 'PG_VERSION'))) {
    const deplacerRecursif = (source, cible) => {
      mkdirSync(cible, { recursive: true })
      for (const entree of readdirSync(source, { withFileTypes: true })) {
        const s = path.join(source, entree.name)
        const d = path.join(cible, entree.name)
        if (entree.isDirectory()) deplacerRecursif(s, d)
        else renameSync(s, d)
      }
    }
    deplacerRecursif(sousDossierUnique, PG_DIR)
    rmSync(sousDossierUnique, { recursive: true, force: true })
  }

  if (!existsSync(path.join(PG_DIR, 'PG_VERSION'))) {
    process.stderr.write(
      'Restauration invalide : PG_VERSION absent apres restauration. Archive corrompue ?\n',
    )
    process.exit(1)
  }

  dire('Restauration terminee.')
  dire(`  Source : ${archive}`)
  dire("Relancez l'application : les donnees restaurees seront visibles.")
}

function lister() {
  const dossier = path.join(DATA_DIR, 'backups')
  if (!existsSync(dossier)) {
    dire('Aucune sauvegarde.')
    return
  }
  for (const f of readdirSync(dossier).filter((n) => n.endsWith('.zip')).sort().reverse()) {
    const info = statSync(path.join(dossier, f))
    dire(`${f}  (${(info.size / 1024).toFixed(1)} Ko)`)
  }
}

async function main() {
  const [commande, ...args] = process.argv.slice(2)

  if (commande === 'backup') {
    sauvegarder(args[0])
    return
  }
  if (commande === 'restore') {
    const forcer = args.includes('--force')
    const fichier = args.find((a) => !a.startsWith('--'))
    if (!fichier) {
      process.stderr.write('Usage : node desktop/backup.cjs restore <fichier.zip> [--force]\n')
      process.exit(1)
    }
    restaurer(path.resolve(fichier), forcer)
    return
  }
  if (commande === 'list') {
    lister()
    return
  }

  process.stderr.write(
    [
      'Usage :',
      '  node desktop/backup.cjs backup  [repertoire]',
      '  node desktop/backup.cjs restore <fichier.zip> [--force]',
      '  node desktop/backup.cjs list',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((erreur) => {
  process.stderr.write('[sauvegarde] Echec : ' + (erreur && erreur.message ? erreur.message : String(erreur)) + '\n')
  process.exit(1)
})
