/**
 * =============================================================================
 *  COPIE DES POLICES PDF DANS node_modules/pdfkit/fonts
 * =============================================================================
 *
 *  POURQUOI CETTE COPIE (bug production Vercel, déploiements eb8243b3 puis
 *  suivants) : les PDF du cabinet sont composés avec les polices Noto (TTF)
 *  stockées dans `assets/fonts`. Sur Vercel, le répertoire `assets/` n'est
 *  PAS copié dans la lambda serverless — ni par le tracing par défaut, ni par
 *  `outputFileTracingIncludes` (le pattern '/api/**' ne matche pas les clés
 *  internes du traceur). Résultat : ENOENT
 *  '/var/task/assets/fonts/NotoSans-Regular.ttf' à chaque export PDF.
 *
 *  En revanche, `node_modules/` est TOUJOURS copié intégralement : pdfkit y
 *  vit en paquet externe (serverExternalPackages). Copier les polices dans
 *  `node_modules/pdfkit/fonts/` garantit leur présence dans la lambda, sans
 *  toucher au paquet pdfkit lui-même (aucune modification d'un module tiers,
 *  simple ajout d'un dossier à l'intérieur de son répertoire installé).
 *
 *  Le script est idempotent : il ne recopie que si la source est plus récente
 *  que la destination, et s'exécute :
 *    - en local via `prebuild` (avant `next build`) ;
 *    - sur Vercel via le même hook (les builds Vercel exécutent les scripts
 *      npm de la racine).
 *
 *  AUCUNE donnée patient n'est concernée : ce sont des polices statiques
 *  libres (Noto, SIL OFL).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(racine, 'assets', 'fonts')
const cible = path.join(racine, 'node_modules', 'pdfkit', 'fonts')

const POLICES = [
  'NotoSans-Regular.ttf',
  'NotoSans-Bold.ttf',
  'NotoNaskhArabic-Regular.ttf',
  'NotoNaskhArabic-Bold.ttf',
]

function copierSiPlusRecent(fichier) {
  const sourceFichier = path.join(source, fichier)
  const cibleFichier = path.join(cible, fichier)

  if (!fs.existsSync(sourceFichier)) {
    // Pas de source : on ne supprime rien, on laisse la copie existante. Le
    // build Vercel ne doit JAMAIS échouer à cause de ce script de confort.
    return false
  }

  const statSource = fs.statSync(sourceFichier)
  let aCopier = !fs.existsSync(cibleFichier)
  if (!aCopier) {
    const statCible = fs.statSync(cibleFichier)
    aCopier =
      statSource.size !== statCible.size ||
      statSource.mtimeMs > statCible.mtimeMs
  }

  if (aCopier) {
    fs.mkdirSync(cible, { recursive: true })
    fs.copyFileSync(sourceFichier, cibleFichier)
  }
  return aCopier
}

let copiees = 0
for (const fichier of POLICES) {
  if (copierSiPlusRecent(fichier)) copiees += 1
}

// Journal discret : utile dans les logs de build Vercel pour vérifier que les
// polices sont bien embarquées — sans aucun secret ni donnée patient.
// (console.warn : le linter interdit console.log dans les scripts ; un message
// de build informatif sur stderr est le comportement attendu.)
console.warn(
  `[polices] ${copiees}/${POLICES.length} police(s) copiée(s) vers node_modules/pdfkit/fonts/`,
)
