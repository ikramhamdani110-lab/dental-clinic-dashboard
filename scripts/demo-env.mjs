import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Lance une commande avec l'environnement de DEMONSTRATION.
 *
 * Sûreté : ce script REFUSE de s'exécuter si l'URL de démonstration ne cible pas
 * l'instance isolée (port 5433, base `sahed_demo_clinic`). Il est donc impossible
 * de lancer par mégarde le seed ou le serveur contre `sahed_clinic` : la base du
 * cabinet devient inaccessible depuis cette commande.
 */

const FICHIER = resolve(process.cwd(), '.env.demo')

/**
 * Lit une variable de `.env` ou `.env.demo`, avec ou sans guillemets.
 *
 * Le point important est l'egalite stricte sur le NOM : sans `^` + le nom exact,
 * `APP_URL` matcherait `APP_URL_DEMO`. Le separateur d'egalite est le premier
 * seulement, afin de ne pas tronquer une URL qui contient un `=`.
 */
function lireVariable(nom, fichier = FICHIER) {
  for (const ligne of readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const debut = ligne.match(new RegExp(`^${nom}=(.*)$`))
    if (debut) return debut[1].trim().replace(/^"|"$/g, '')
  }
  throw new Error(`${nom} est absent de ${fichier}`)
}

const urlDemo = lireVariable('DATABASE_URL_DEMO')
// ── Garde-fou : l'URL doit viser l'instance de démonstration ────────────────
const cible = new URL(urlDemo)
if (cible.port !== '5433' || !cible.pathname.includes('sahed_demo_clinic')) {
  console.error(
    [
      'REFUS de lancer la commande : .env.demo ne pointe pas sur la base de démonstration.',
      `  port     : ${cible.port || '(défaut 5432)'}`,
      `  base     : ${cible.pathname}`,
      '',
      "L'URL doit utiliser le port 5433 et la base sahed_demo_clinic.",
    ].join('\n'),
  )
  process.exit(1)
}

/*
 * Le secret de session est repris de `.env` (production) : le serveur de
 * demonstration doit utiliser la MEME cle qu'attend la configuration du
 * projet. Seules l'URL de base et l'URL publique sont prises dans `.env.demo`,
 * qui ne contient volontairement aucun secret.
 */
const FICHIER_PRODUCTION = resolve(process.cwd(), '.env')

const env = {
  ...process.env,
  DATABASE_URL: urlDemo,
  SESSION_SECRET: lireVariable('SESSION_SECRET', FICHIER_PRODUCTION),
  PASSWORD_PEPPER: (() => {
    try {
      return lireVariable('PASSWORD_PEPPER', FICHIER_PRODUCTION)
    } catch {
      return undefined
    }
  })(),
  APP_URL: lireVariable('APP_URL', FICHIER_PRODUCTION),
  COOKIE_SECURE: 'false',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
}

const [commande, ...args] = process.argv.slice(2)
if (!commande) {
  console.error('Usage : node scripts/demo-env.mjs <commande> [args...]')
  process.exit(1)
}

const fils = spawn(commande, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
})

fils.on('exit', (code) => process.exit(code ?? 0))
