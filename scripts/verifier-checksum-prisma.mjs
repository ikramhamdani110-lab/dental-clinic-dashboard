﻿// =============================================================================
//  VÃ‰RIFICATION DU CHECKSUM PRISMA â€” mÃ©thode empirique, zÃ©ro approximation
// =============================================================================
//  DÃ©marre un PostgreSQL JETABLE, y applique la migration avec le `prisma
//  migrate deploy` DU PROJET (celui qui tournera en production), puis lit la
//  ligne `_prisma_migrations` Ã©crite PAR PRISMA LUI-MÃŠME :
//    1. checksum exact attendu ;
//    2. valeurs exactes de chaque colonne (pour calquer l'INSERT manuel) ;
//    3. comportement de `migrate deploy` APRÃˆS insertion manuelle de cette
//       ligne (tables prÃ©-existantes) : doit dÃ©clarer la migration dÃ©jÃ 
//       appliquÃ©e, JAMAIS la rejouer.
//  Base 100 % jetable â€” aucun accÃ¨s production.
// =============================================================================

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MIGRATION = '20261114000000_sync_tombstones_durables'

async function portLibre(depart) {
  for (let port = depart; port < depart + 50; port++) {
    const libre = await new Promise((r) => {
      const s = net.createServer()
      s.once('error', () => r(false))
      s.once('listening', () => s.close(() => r(true)))
      s.listen(port, '127.0.0.1')
    })
    if (libre) return port
  }
  throw new Error('aucun port libre')
}

async function principal() {
  const { default: EmbeddedPostgres } = require('embedded-postgres')
  const port = await portLibre(54450)
  const dossier = fs.mkdtempSync(path.join(process.env.TEMP ?? racine, 'sahed-cksum-pg-'))
  console.log(`[harnais] PostgreSQL jetable : ${dossier} (port ${port})`)
  const pg = new EmbeddedPostgres({
    databaseDir: dossier,
    user: 'cksum',
    password: 'cksum',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('cksum')
  const url = `postgresql://cksum:cksum@127.0.0.1:${port}/cksum`

  // Arbre de migration MINIMAL : uniquement la migration Ã  vÃ©rifier.
  const bac = path.join(dossier, 'arbres-migration')
  fs.mkdirSync(path.join(bac, 'migrations', MIGRATION), { recursive: true })
  fs.copyFileSync(
    path.join(racine, 'database', 'prisma', 'migrations', MIGRATION, 'migration.sql'),
    path.join(bac, 'migrations', MIGRATION, 'migration.sql'),
  )
  fs.writeFileSync(
    path.join(bac, 'schema.prisma'),
    `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`,
  )

  const prisma = path.join(racine, 'node_modules', 'prisma', 'build', 'index.js')

  function deploy(etape) {
    const r = spawnSync(process.execPath, [prisma, 'migrate', 'deploy', '--schema', path.join(bac, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      timeout: 120_000,
    })
    console.log(`\n===== ${etape} (exit ${r.status}) =====`)
    console.log((r.stdout || '') + (r.stderr || ''))
    return r
  }

  // â”€â”€ 1. Laisser PRISMA appliquer la migration : il Ã©crit le checksum de rÃ©fÃ©rence.
  deploy('Ã‰TAPE A â€” migrate deploy (Prisma applique la migration)')

  const lire = async () => {
    const r = spawnSync(
      process.execPath,
      ['-e', `
        const {PrismaClient} = require('${path.join(racine, 'node_modules', '@prisma/client').replace(/\\/g, '\\\\')}');
        const p = new PrismaClient({ datasources: { db: { url: '${url}' } } });
        p.$queryRawUnsafe('SELECT * FROM _prisma_migrations').then(l => { console.log(JSON.stringify(l, null, 2)); return p.$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
      `],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const sortie = (r.stdout || '') + (r.stderr || '')
    console.log(sortie)
    return JSON.parse(sortie.slice(sortie.indexOf('[')))
  }

  console.log('\n===== Ã‰TAPE B â€” ligne _prisma_migrations Ã©crite PAR PRISMA =====')
  const [ligne] = await lire()
  console.log(`>>> CHECKSUM DE RÃ‰FÃ‰RENCE : ${ligne.checksum}`)
  console.log(`>>> migration_name : ${JSON.stringify(ligne.migration_name)}`)
  console.log(`>>> applied_steps_count : ${ligne.applied_steps_count}`)
  console.log(`>>> started_at : ${ligne.started_at}`)
  console.log(`>>> finished_at : ${ligne.finished_at}`)
  console.log(`>>> logs : ${JSON.stringify(ligne.logs)}  rolled_back_at : ${ligne.rolled_back_at}`)
  console.log(`>>> id : ${ligne.id}  (type = ${typeof ligne.id})`)

  // â”€â”€ 2. Reproduire le scÃ©nario Neon manuel : tables SUPPRIMÃ‰ES puis
  //      recrÃ©Ã©es manuellement + INSERT manuel du checksum â€” `migrate deploy`
  //      doit alors considÃ©rer la migration comme dÃ©jÃ  appliquÃ©e.
  console.log('\n===== Ã‰TAPE C â€” simulation du chemin manuel Neon =====')
  const p = new (require(path.join(racine, 'node_modules', '@prisma', 'client'))).PrismaClient({
    datasources: { db: { url } },
  })
  // Supprimer tables + historique (base jetable : sans risque).
  // âš ï¸ Ordre inverse de crÃ©ation (rÃ©tention d'abord) pour respecter les
  // dÃ©pendances Ã©ventuelles ; CASCADE couvre le reste.
  await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "sync_tombstones" CASCADE;`)
  await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "sync_tombstone_cursors" CASCADE;`)
  await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "sync_tombstone_retention" CASCADE;`)
  await p.$executeRawUnsafe(`DELETE FROM _prisma_migrations;`)
  await p.$disconnect()

  // INSERT manuel CALQUÃ‰ sur la ligne lue en Ã©tape B (checksum de rÃ©fÃ©rence).
  const insertSql = `
    INSERT INTO _prisma_migrations
      (id, checksum, migration_name, logs, rolled_back_at, started_at, finished_at, applied_steps_count)
    VALUES (
      gen_random_uuid(),
      '${ligne.checksum}',
      '${ligne.migration_name}',
      NULL, NULL, now(), now(), 1
    );
  `
  const p2 = new (require(path.join(racine, 'node_modules', '@prisma', 'client'))).PrismaClient({
    datasources: { db: { url } },
  })
  await p2.$executeRawUnsafe(insertSql)
  await p2.$disconnect()

  // RecrÃ©er les tables avec le SQL manuel (identique Ã  la procÃ©dure Neon).
  // DÃ©coupe Ã©clairÃ©e (identique Ã  desktop/migrate-local.mjs) : respecte les
  // chaÃ®nes, les commentaires -- et /* */ et les dollar-quotes â€” Prisma
  // n'accepte qu'une commande par prepared statement.
  function decouperSql(sql) {
    const instructions = []
    let courant = ''
    let i = 0
    const n = sql.length
    const ajouter = () => { const t = courant.trim(); if (t) instructions.push(t); courant = '' }
    while (i < n) {
      const c = sql[i]
      if (c === '-' && sql[i + 1] === '-') { const f = sql.indexOf('\n', i); const fin = f === -1 ? n : f; courant += sql.slice(i, fin); i = fin; continue }
      if (c === '/' && sql[i + 1] === '*') { const f = sql.indexOf('*/', i + 2); const fin = f === -1 ? n : f + 2; courant += sql.slice(i, fin); i = fin; continue }
      if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const finC = sql.indexOf(m[0], i + m[0].length); const fin = finC === -1 ? n : finC + m[0].length; courant += sql.slice(i, fin); i = fin; continue } }
      if (c === "'") { let j = i + 1; while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } j += 1; break } j += 1 } courant += sql.slice(i, j); i = j; continue }
      if (c === '"') { let j = i + 1; while (j < n) { if (sql[j] === '"') { j += 1; break } j += 1 } courant += sql.slice(i, j); i = j; continue }
      if (c === ';') { ajouter(); i += 1; continue }
      courant += c; i += 1
    }
    ajouter()
    return instructions
  }
  const manuel = fs.readFileSync(
    path.join(racine, 'database', 'prisma', 'migrations', MIGRATION, 'migration.sql'),
    'utf8',
  )
  const instructions = decouperSql(manuel)
  console.log(`[harnais] ${instructions.length} instructions extraites du SQL manuel`)
  const p3 = new (require(path.join(racine, 'node_modules', '@prisma', 'client'))).PrismaClient({
    datasources: { db: { url } },
  })
  for (const instruction of instructions) {
    await p3.$executeRawUnsafe(instruction)
  }
  await p3.$disconnect()

  deploy('Ã‰TAPE D â€” migrate deploy APRÃˆS insertion manuelle (doit Ãªtre no-op)')

  const r2 = spawnSync(
    process.execPath,
    ['-e', `
      const {PrismaClient} = require('${path.join(racine, 'node_modules', '@prisma', 'client').replace(/\\/g, '\\\\')}');
      const p = new PrismaClient({ datasources: { db: { url: '${url}' } } });
      p.$queryRawUnsafe('SELECT count(*)::int AS n FROM _prisma_migrations').then(l => { console.log('LIGNES_HISTORIQUE=' + l[0].n); return p.$disconnect(); });
    `],
    { encoding: 'utf8', timeout: 60_000 },
  )
  console.log((r2.stdout || '') + (r2.stderr || ''))

  try { await pg.stop() } catch {}
  try { fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 3 }) } catch {}
  console.log('\n[harnais] base jetable dÃ©truite.')
}

principal().catch((e) => { console.error(e); process.exit(1) })
