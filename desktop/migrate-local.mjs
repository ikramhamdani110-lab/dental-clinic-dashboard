// =============================================================================
//  MIGRATION LOCALE SANS CLI PRISMA
// =============================================================================
//  Applique les migrations SQL (*.sql) de resources\prisma\migrations dans
//  l'ordre, en s'enregistrant dans la table _prisma_migrations — même
//  convention que `prisma migrate deploy`. Exécuté par Electron au premier
//  lancement. Utilise le client Prisma déjà présent dans le bundle standalone.
// =============================================================================

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const dossierScript = path.dirname(fileURLToPath(import.meta.url))
const dossierStandalone = path.resolve(dossierScript, '..', 'standalone')
const dossierMigrations = path.resolve(dossierScript, '..', 'prisma', 'migrations')

// Le client Prisma vit dans standalone\node_modules : on l'importe par chemin.
// ATTENTION : l'entree du paquet est `default.js` (re-export de
// `.prisma/client/default`) — importer `index.js` echoue avec
// ERR_MODULE_NOT_FOUND : `@prisma/client` n'a pas de fichier `index.js`.
const cheminClient =
  'file:///' +
    path
      .join(dossierStandalone, 'node_modules', '@prisma', 'client', 'default.js')
      .replace(/\\/g, '/')
const { PrismaClient } = await import(cheminClient)

const prisma = new PrismaClient()

async function tableMigrationsExiste() {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`,
  )
  return r.length > 0
}

async function dejaApplique(nom) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`,
    nom,
  )
  return r.length > 0
}

// ---------------------------------------------------------------------------
//  Découpage d'un fichier SQL en instructions individuelles en respectant :
//  - les guillemets simples et doubles (avec échappement '')
//  - les commentaires -- et /* */
//  - les chaînes dollar-quotées ($$ … $$, $tag$ … $tag$) — utilisées pour les
//    corps de fonctions PL/pgSQL dans les migrations PostgreSQL de Prisma.
// ---------------------------------------------------------------------------
function decouperSql(sql) {
  const instructions = []
  let courant = ''
  let i = 0
  const n = sql.length

  const ajouterCourant = () => {
    const t = courant.trim()
    if (t) instructions.push(t)
    courant = ''
  }

  while (i < n) {
    const c = sql[i]

    // Commentaire ligne
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i)
      const fin2 = fin === -1 ? n : fin
      courant += sql.slice(i, fin2)
      i = fin2
      continue
    }
    // Commentaire bloc
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      const fin2 = fin === -1 ? n : fin + 2
      courant += sql.slice(i, fin2)
      i = fin2
      continue
    }
    // Chaîne dollar-quotée ($$ ou $tag$)
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) {
        const balise = m[0]
        const finContenu = sql.indexOf(balise, i + balise.length)
        const fin = finContenu === -1 ? n : finContenu + balise.length
        courant += sql.slice(i, fin)
        i = fin
        continue
      }
    }
    // Guillemet simple (chaîne) — gère aussi '' échappé
    if (c === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          j += 1
          break
        }
        j += 1
      }
      courant += sql.slice(i, j)
      i = j
      continue
    }
    // Guillemet double (identifiant quoté)
    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue }
          j += 1
          break
        }
        j += 1
      }
      courant += sql.slice(i, j)
      i = j
      continue
    }
    // Séparateur d'instruction
    if (c === ';') {
      ajouterCourant()
      i += 1
      continue
    }
    courant += c
    i += 1
  }
  ajouterCourant()
  return instructions
}

async function main() {
  await prisma.$connect()

  if (!(await tableMigrationsExiste())) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "_prisma_migrations" (
        id                      VARCHAR(36) PRIMARY KEY,
        checksum                VARCHAR(64) NOT NULL,
        finished_at             TIMESTAMPTZ,
        migration_name          VARCHAR(255) NOT NULL,
        logs                    TEXT,
        rolled_back_at          TIMESTAMPTZ,
        started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count     INTEGER NOT NULL DEFAULT 0
      )
    `)
    console.log('Table _prisma_migrations créée')
  }

  const entrees = fs
    .readdirSync(dossierMigrations, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  for (const nom of entrees) {
    if (await dejaApplique(nom)) {
      console.log('Déjà appliquée :', nom)
      continue
    }

    const cheminSql = path.join(dossierMigrations, nom, 'migration.sql')
    if (!fs.existsSync(cheminSql)) {
      console.warn('Pas de migration.sql dans', nom, '— ignorée')
      continue
    }

    const sql = fs.readFileSync(cheminSql, 'utf8')
    const instructions = decouperSql(sql)
    console.log('Application de', nom, '(' + instructions.length + ' instructions)…')
    try {
      // On enchaîne dans une transaction implicite : si une instruction
      // échoue, rien n'est appliqué de cette migration.
      await prisma.$transaction(async (tx) => {
        for (const instruction of instructions) {
          await tx.$executeRawUnsafe(instruction)
        }
      })
    } catch (e) {
      console.error('ÉCHEC de', nom, ':', e.message)
      await prisma.$disconnect()
      process.exit(1)
    }

    const crypto = await import('node:crypto')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, now(), 1)`,
      crypto.randomUUID(),
      checksum,
      nom,
    )
    console.log('OK :', nom)
  }

  console.log('MIGRATIONS TERMINÉES')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Erreur migration:', e)
  await prisma.$disconnect()
  process.exit(1)
})
