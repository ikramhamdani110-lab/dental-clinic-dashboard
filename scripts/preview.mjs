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
 *  Usage : node scripts/preview.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FICHIER = resolve(process.cwd(), '.env.preview')

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

const base = {
  ...process.env,
  DATABASE_URL: url,
  SESSION_SECRET: lireVariable('SESSION_SECRET'),
  PASSWORD_PEPPER: lireVariable('PASSWORD_PEPPER'),
  COOKIE_SECURE: 'false',
  NODE_ENV: 'production',
}

function demarrer(nom, port, appUrl) {
  const fils = spawn(
    process.execPath,
    [resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)],
    { stdio: 'inherit', shell: false, env: { ...base, APP_URL: appUrl } },
  )
  fils.on('exit', (code) => process.stdout.write(`[${nom}] arrete (code ${code}).\n`))
  process.stdout.write(`[${nom}] http://localhost:${port}\n`)
}

demarrer('secretaire', 3100, 'http://localhost:3100')
demarrer('finances', 3200, 'http://localhost:3200')
