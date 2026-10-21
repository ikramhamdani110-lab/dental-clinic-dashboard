// =============================================================================
//  PREPARATION DES RESSOURCES DE BUREAU (desktop/resources)
// =============================================================================
//  Assemble tout ce dont l'application Electron a besoin a l'execution :
//    - le serveur Next.js autonome (next build avec output: 'standalone')
//    - le client Prisma + le schema (pour la migration locale)
//    - le script de seed (compte medecin initial)
//    - les binaires PostgreSQL embarques (@embedded-postgres/windows-x64)
//
//  Aucune modification du code source : c'est une Etape de packaging pure.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const versionApplication = '1.0.0'
const cible = path.join(racine, 'desktop', 'resources')
const ressourcesNext = path.join(cible, 'standalone')

function copier(from, to) {
  fs.cpSync(from, to, { recursive: true })
}

// 1. Repartir d'un dossier propre.
fs.rmSync(cible, { recursive: true, force: true })
fs.mkdirSync(ressourcesNext, { recursive: true })

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

// 5. Script de seed compile en CJS (executable par node sans transpilation).
fs.mkdirSync(path.join(cible, 'desktop'), { recursive: true })
fs.copyFileSync(
  path.join(racine, 'desktop', 'seed.cjs'),
  path.join(cible, 'desktop', 'seed.cjs'),
)
fs.copyFileSync(
  path.join(racine, 'desktop', 'migrate.mjs'),
  path.join(cible, 'desktop', 'migrate.mjs'),
)
fs.copyFileSync(
  path.join(racine, 'desktop', 'migrate-local.mjs'),
  path.join(cible, 'desktop', 'migrate-local.mjs'),
)

// 5b. Supprimer le .env copié par le build standalone : les variables de
//     production n'ont rien à faire dans l'application de bureau. Toutes les
//     variables nécessaires sont fournies par desktop/main.mjs.
fs.rmSync(path.join(ressourcesNext, '.env'), { force: true })

// 6. Client Prisma + argon2 : dependances natives requises a l'execution.
const nodeModulesCible = path.join(ressourcesNext, 'node_modules')
fs.mkdirSync(nodeModulesCible, { recursive: true })
for (const nom of ['@prisma', 'argon2']) {
  copier(
    path.join(racine, 'node_modules', nom),
    path.join(nodeModulesCible, nom),
  )
}

// 6b. Runtime Node.js embarque (l'application n'exige aucune installation de Node chez l'utilisateur).
//     Le serveur Next et les scripts de migration/seed sont lances avec ce node.exe.
const nodeExeSource = process.execPath
fs.copyFileSync(nodeExeSource, path.join(cible, 'node.exe'))

// 7. Binaires PostgreSQL embarques (Windows x64 uniquement pour la cible de bureau).
const enginePg = path.join(racine, 'node_modules', '@embedded-postgres')
copier(enginePg, path.join(cible, 'node_modules', '@embedded-postgres'))
copier(
  path.join(racine, 'node_modules', 'embedded-postgres'),
  path.join(cible, 'node_modules', 'embedded-postgres'),
)
const pg = path.join(cible, 'node_modules', '@embedded-postgres', 'windows-x64', 'native')
const pgBin = path.join(pg, 'bin')
for (const f of fs.readdirSync(pgBin)) {
  if (!/\.(exe|dll)$/i.test(f)) continue
  // Supprime les utilitaires inutiles a l'execution (pg_dump, createdb, ...).
  if (/^(dropdb|dropuser|createdb|createuser|clusterdb|reindexdb|vacuumdb|pg_(dump|dumpall|basebackup|receive?|verifybackup)|ecpg|oid2name|pg_amcheck|pg_isready|pg_test_fsync|pg_test_timing|pg_upgrade|pg_waldump|pgbench|pg_checksums|pg_controldata|pg_resetwal|pg_rewind|psql)/i.test(f)) {
    fs.rmSync(path.join(pgBin, f))
  }
}

// 8. Point d'entree Electron.
fs.copyFileSync(
  path.join(racine, 'desktop', 'main.mjs'),
  path.join(cible, 'main.mjs'),
)

// 9. Manifeste de l'application Electron : nom, point d'entrée main.
fs.writeFileSync(
  path.join(cible, 'package.json'),
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

console.log('Ressources de bureau assemblees dans', cible)
