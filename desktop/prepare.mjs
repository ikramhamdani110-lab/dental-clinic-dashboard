// =============================================================================
//  PREPARATION DES RESSOURCES DE BUREAU (desktop/runtime)
// =============================================================================
//  Assemble tout ce dont l'application Electron a besoin a l'execution dans
//  `desktop/runtime`, copie TEL QUEL dans resources/runtime par electron-builder
//  (extraResources). On ne met RIEN de runtime dans le dossier de l'application
//  Electron elle-meme (desktop/resources) : electron-builder re-colle et
//  re-prune systematiquement les node_modules du dossier "app", ce qui
//  supprimait embedded-postgres, pg et node_modules/.prisma du bundle final —
//  c'etait la cause premiere de l'echec de demarrage apres installation.
//
//  Contenu de runtime/ :
//    - standalone/      : serveur Next.js autonome + node_modules (Prisma, argon2)
//    - prisma/          : schema + migrations (pour la migration locale)
//    - desktop/         : scripts migrate.mjs / migrate-local.mjs / seed.cjs
//    - node.exe         : runtime Node embarque
//    - node_modules/    : embedded-postgres, @embedded-postgres (binaires PG),
//                         pg et ses dependances (pour createDatabase)
//
//  Aucune modification du code source : c'est une etape de packaging pure.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const versionApplication = '1.0.0'
const cible = path.join(racine, 'desktop', 'runtime')
const ressourcesNext = path.join(cible, 'standalone')

function copier(from, to) {
  fs.cpSync(from, to, { recursive: true })
}

// 1. Repartir d'un dossier propre.
fs.rmSync(cible, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
try {
  fs.rmSync(path.join(racine, 'desktop', 'resources'), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  })
} catch {
  // Le dossier app peut être verrouillé : electron-builder le recrée de toute
  // façon à partir des fichiers ci-dessous.
}
fs.mkdirSync(ressourcesNext, { recursive: true })
fs.mkdirSync(path.join(cible, 'desktop'), { recursive: true })

// 2. Serveur Next.js autonome (deja produit par `next build`).
const sourceStandalone = path.join(racine, '.next', 'standalone')
if (!fs.existsSync(sourceStandalone)) {
  throw new Error(
    'Le build autonome est absent : executez `BUILD_TARGET=desktop npm run build` avant.',
  )
}
copier(sourceStandalone, ressourcesNext)

// 3. Fichiers statiques publics (assets, styles, illustrations).
copier(path.join(racine, '.next', 'static'), path.join(ressourcesNext, '.next', 'static'))
if (fs.existsSync(path.join(racine, 'public'))) {
  copier(path.join(racine, 'public'), path.join(ressourcesNext, 'public'))
}

// 4. Schema + migrations Prisma (requis par `prisma migrate deploy`).
copier(path.join(racine, 'database', 'prisma'), path.join(cible, 'prisma'))

// 5. Scripts de migration + seed (executables par le node embarque).
for (const f of ['seed.cjs', 'migrate.mjs', 'migrate-local.mjs']) {
  fs.copyFileSync(path.join(racine, 'desktop', f), path.join(cible, 'desktop', f))
}

// 5b. Supprimer le .env copié par le build standalone : les variables de
//     production n'ont rien à faire dans l'application de bureau. Toutes les
//     variables nécessaires sont fournies par desktop/main.mjs.
fs.rmSync(path.join(ressourcesNext, '.env'), { force: true })

// 6. Binaires PostgreSQL embarques + dependances npm dont embedded-postgres a
//    besoin a l'execution (pg pour createDatabase, async-exit-hook).
//    On copie chaque paquet avec TOUTES ses dependances transitives.
const nodeModulesCible = path.join(cible, 'node_modules')
fs.mkdirSync(nodeModulesCible, { recursive: true })
const nodeModulesSource = path.join(racine, 'node_modules')

const dejaCopies = new Set()
function copierPaquet(nom) {
  if (dejaCopies.has(nom)) return
  dejaCopies.add(nom)
  const source = path.join(nodeModulesSource, ...nom.split('/'))
  const dest = path.join(nodeModulesCible, ...nom.split('/'))
  if (!fs.existsSync(path.join(source, 'package.json'))) {
    throw new Error(`Paquet npm introuvable pour le bundle bureau : ${nom}`)
  }
  copier(source, dest)
  const manifeste = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  for (const d of Object.keys(manifeste.dependencies ?? {})) copierPaquet(d)
}

for (const nom of ['embedded-postgres', 'pg', 'async-exit-hook']) {
  copierPaquet(nom)
}
copierPaquet('@embedded-postgres/windows-x64')

// 6b. Runtime Node.js embarque (l'application n'exige aucune installation de Node chez l'utilisateur).
//     Le serveur Next et les scripts de migration/seed sont lances avec ce node.exe.
const nodeExeSource = process.execPath
fs.copyFileSync(nodeExeSource, path.join(cible, 'node.exe'))

// 7. Supprime les utilitaires PostgreSQL inutiles a l'execution.
const pgBin = path.join(
  nodeModulesCible,
  '@embedded-postgres',
  'windows-x64',
  'native',
  'bin',
)
for (const f of fs.readdirSync(pgBin)) {
  if (!/\.(exe|dll)$/i.test(f)) continue
  if (/^(dropdb|dropuser|createdb|createuser|clusterdb|reindexdb|vacuumdb|pg_(dump|dumpall|basebackup|receive?|verifybackup)|ecpg|oid2name|pg_amcheck|pg_isready|pg_test_fsync|pg_test_timing|pg_upgrade|pg_waldump|pgbench|pg_checksums|pg_controldata|pg_resetwal|pg_rewind|psql)/i.test(f)) {
    fs.rmSync(path.join(pgBin, f))
  }
}

// 8. Dossier de l'application Electron (desktop/resources) : point d'entree
//    uniquement. Tout le reste vit dans runtime/ (extraResources, jamais prune).
const dossierApp = path.join(racine, 'desktop', 'resources')
fs.mkdirSync(dossierApp, { recursive: true })
fs.copyFileSync(
  path.join(racine, 'desktop', 'main.mjs'),
  path.join(dossierApp, 'main.mjs'),
)

// 9. Manifeste de l'application Electron : nom, point d'entrée main.
fs.writeFileSync(
  path.join(dossierApp, 'package.json'),
  JSON.stringify(
    {
      name: 'clinique-sahed',
      productName: 'Clinique Sahed',
      version: versionApplication,
      description: 'Application de bureau de la clinique dentaire Sahed',
      main: 'main.mjs',
      private: true,
    },
    null,
    2,
  ),
)

console.log('Runtime de bureau assemble dans', cible)
console.log('Application Electron assemblee dans', dossierApp)
