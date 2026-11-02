/**
 * Écrit l'URL d'une base d'intégration jetable (sahed_test_integration) dans
 * `.env.test-url.tmp`, dérivée de DATABASE_URL_DEMO (même instance PostgreSQL
 * isolée du port 5433 — la base de production 5432 reste physiquement
 * inaccessible). Usage :
 *   node scripts/test-db-url.mjs      -> écrit .env.test-url.tmp
 *   node scripts/test-db-url.mjs clean -> supprime .env.test-url.tmp
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'

const FICHIER = '.env.test-url.tmp'
const ARG = process.argv[2]

if (ARG === 'clean') {
  if (existsSync(FICHIER)) unlinkSync(FICHIER)
  process.exit(0)
}

const envDemo = readFileSync('.env.demo', 'utf8')
const m = envDemo.match(/DATABASE_URL_DEMO\s*=\s*"([^"]+)"/)
if (!m) {
  console.error('DATABASE_URL_DEMO introuvable dans .env.demo')
  process.exit(1)
}
const urlTest = m[1].replace(/\/[A-Za-z0-9_]+\?/, '/sahed_test_integration?')
if (urlTest === m[1]) {
  console.error('Impossible de dériver l URL de test')
  process.exit(1)
}
writeFileSync(FICHIER, urlTest + '\n')
console.error('URL de test écrite (identifiants masqués) : ' + urlTest.replace(/\/\/[^@]*@/, '//***@'))
