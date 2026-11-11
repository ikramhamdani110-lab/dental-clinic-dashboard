/**
 * =============================================================================
 *  SERVEURS DE PREVISUALISATION LOCALE (port 3100 = secretaire, 3200 = finances)
 * =============================================================================
 *
 *  Ce script demarre DEUX instances de production (`next start`) contre la base
 *  DE DEMONSTRATION isolee (port 5433). Il refuse de demarrer si l'URL ne vise
 *  pas `sahed_demo_clinic` sur le port 5433 : la base du cabinet (5432) est
 *  donc inatteignable depuis ces serveurs.
 *
 *  L'ENVIRONNEMENT EST STRUCTURELLEMENT FERME. Le prochain `next start` charge
 *  automatiquement `.env`, `.env.local` et `.env.production` a la racine
 *  (comportement standard de Next) : ces fichiers peuvent viser la base de
 *  production. Deux garde-fous, cumulatifs :
 *
 *   1. `DATABASE_URL` est POSEE dans l'environnement du processus ;
 *      `@next/env` ne remplace pas une variable deja presente.
 *   2. `.env.local` / `.env.production` / `.env.production.local` pointant vers
 *      une autre base sont ecartees du repertoire de travail le temps du
 *      lancement, puis remises en place (descripteur + restauration a l'arret).
 *      Rien n'est supprime : le fichier est deplace d'un cran et remis a sa
 *      place exacte par le nettoyage, meme en cas d'arret brutal (Ctrl+C).
 *
 *  Usage : node scripts/preview.mjs
 */
import { spawn } from 'node:child_process'
import { closeSync, lstatSync, openSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const RACINE = process.cwd()
const FICHIER = resolve(RACINE, '.env.preview')

/** Fichiers que `next start` chargerait et qui pourraient viser la production. */
const FICHIERS_ECARTES = ['.env.local', '.env.production', '.env.production.local']

function lireVariable(nom) {
  for (const ligne of readFileSync(FICHIER, 'utf8').split(/\r?\n/)) {
    const debut = ligne.match(new RegExp(`^${nom}=(.*)$`))
    if (!debut) continue
    let valeur = debut[1].trim()
    // Depouille UN couple de guillemets englobants, sans rien manger d'autre.
    if (valeur.startsWith('"') && valeur.endsWith('"') && valeur.length >= 2) {
      valeur = valeur.slice(1, -1)
    }
    return valeur
  }
  throw new Error(`${nom} est absent de .env.preview`)
}

const url = lireVariable('DATABASE_URL')
const cible = new URL(url)
if (cible.port !== '5433' || !cible.pathname.includes('sahed_demo_clinic')) {
  process.stderr.write(
    'REFUS : .env.preview doit viser sahed_demo_clinic sur le port 5433.\n',
  )
  process.exit(1)
}

/** URL de base visee par une valeur `DATABASE_URL=...` d'un fichier .env. */
function baseVisee(contenu) {
  const ligne = contenu.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m)
  if (!ligne) return null
  const valeur = ligne[1].trim().replace(/^["']|["']$/g, '')
  try {
    return new URL(valeur)
  } catch {
    return null
  }
}

/** Met de cote les fichiers qui detourneraient le serveur, et memorise comment les remettre. */
const ecartes = []
for (const nom of FICHIERS_ECARTES) {
  const chemin = resolve(RACINE, nom)
  let statut
  try {
    statut = lstatSync(chemin)
  } catch {
    continue // absent : rien a faire
  }
  let contenu = null
  try {
    contenu = statut.isSymbolicLink() ? readFileSync(chemin, 'utf8') : null
  } catch {
    contenu = null
  }
  const viseProduction =
    contenu === null || (baseVisee(contenu)?.port ?? '5432') !== '5433'
  if (!viseProduction) continue

  const sauvegarde = `${chemin}.preview-retire`
  // `rename` sur le fichier lui-meme : aucun contenu n'est lu ni modifie.
  renameSync(chemin, sauvegarde)
  ecartes.push({ nom, chemin, sauvegarde, lien: statut.isSymbolicLink() })
  process.stdout.write(`[garde-fou] ${nom} ecarte (ne vise pas la base de demonstration).\n`)
}

let dejaRestaure = false
function restaurer() {
  if (dejaRestaure) return
  dejaRestaure = true
  for (const f of ecartes) {
    try {
      rmSync(f.chemin, { force: true }) // au cas ou next en aurait recree un
      if (f.lien) {
        symlinkSync(readFileSync(f.sauvegarde, 'utf8'), f.chemin)
        rmSync(f.sauvegarde, { force: true })
      } else {
        renameSync(f.sauvegarde, f.chemin)
      }
    } catch (e) {
      process.stderr.write(`[garde-fou] restauration impossible de ${f.nom} : ${e.message}\n`)
      process.stderr.write(`[garde-fou] copie intacte : ${f.sauvegarde}\n`)
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    restaurer()
    process.exit(0)
  })
}
process.on('exit', restaurer)

const base = {
  ...process.env,
  DATABASE_URL: url,
  SESSION_SECRET: lireVariable('SESSION_SECRET'),
  PASSWORD_PEPPER: lireVariable('PASSWORD_PEPPER'),
  COOKIE_SECURE: 'false',
  NODE_ENV: 'production',
}

function demarrer(nom, port, appUrl) {
  // `detached` + `unref` : les serveurs survivent a la fin de la session qui les
  // a lances. Leurs sorties vont dans `.preview-<nom>.log`.
  const journal = resolve(RACINE, `.preview-${nom}.log`)
  const flux = openSync(journal, 'w')
  const fils = spawn(
    process.execPath,
    [resolve(RACINE, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)],
    {
      stdio: ['ignore', flux, flux],
      shell: false,
      cwd: RACINE,
      detached: true,
      windowsHide: true,
      env: { ...base, APP_URL: appUrl },
    },
  )
  closeSync(flux)
  fils.unref()
  process.stdout.write(`[${nom}] http://localhost:${port} (pid ${fils.pid}, journal ${journal})\n`)
  return fils
}

demarrer('secretaire', 3100, 'http://localhost:3100')
demarrer('finances', 3200, 'http://localhost:3200')
