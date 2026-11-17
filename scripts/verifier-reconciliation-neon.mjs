// =============================================================================
//  VERIFICATION DE LA RECONCILIATION NEON — base jetable, historique COMPLET
// =============================================================================
//  Reproduit EXACTEMENT la situation de production :
//    1. Prisma 6.1.0 applique les 9 migrations PREALABLES (deja en prod) ;
//    2. on simule le chemin manuel : tables de la migration 10 creees a la
//       main + ligne `_prisma_migrations` inseree a la main (checksum mesure) ;
//    3. `prisma migrate deploy` doit repondre « No pending migrations » ;
//    4. controle final : une seule ligne pour la migration 10, schema conforme,
//       donnees cliniques pre-existantes intactes.
//  Base 100 % jetable. Aucune connexion production.
// =============================================================================
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MIGRATIONS = path.join(racine, 'database', 'prisma', 'migrations')
const CIBLE = '20261114000000_sync_tombstones_durables'
const PRISMA = path.join(racine, 'node_modules', 'prisma', 'build', 'index.js')
const CLIENT = path.join(racine, 'node_modules', '@prisma', 'client')

const echecs = []
function verifier(condition, libelle, detail = '') {
  const ok = Boolean(condition)
  if (!ok) echecs.push(libelle)
  console.log(`${ok ? 'OK  ' : 'ECHEC'} | ${libelle}${detail ? ' — ' + detail : ''}`)
  return ok
}

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

function deploy(url, arbre, etape) {
  const r = spawnSync(process.execPath, [PRISMA, 'migrate', 'deploy', '--schema', path.join(arbre, 'schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    timeout: 180_000,
  })
  const sortie = (r.stdout || '') + (r.stderr || '')
  console.log(`\n===== ${etape} (exit ${r.status}) =====`)
  console.log(sortie.trim())
  return { status: r.status, sortie }
}

// Decoupage SQL identique a celui de desktop/migrate-local.mjs (respecte
// chaines, commentaires et dollar-quotes).
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

async function principal() {
  const { default: EmbeddedPostgres } = require('embedded-postgres')
  const port = await portLibre(54480)
  const dossier = fs.mkdtempSync(path.join(process.env.TEMP ?? racine, 'sahed-recon-pg-'))
  console.log(`[reconciliation] PostgreSQL jetable : ${dossier} (port ${port})`)
  const pg = new EmbeddedPostgres({
    databaseDir: dossier, user: 'recon', password: 'recon', port, persistent: false,
    onLog: () => {}, onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('recon')
  const url = `postgresql://recon:recon@127.0.0.1:${port}/recon`
  const pg2 = new (require(path.join(CLIENT))).PrismaClient({ datasources: { db: { url } } })

  try {
    // Arbre de migration COMPLET (les 10 dossiers), comme en production.
    const arbre = path.join(dossier, 'arbres-migration')
    fs.mkdirSync(path.join(arbre, 'migrations'), { recursive: true })
    const dossiers = fs.readdirSync(MIGRATIONS).filter((d) => fs.statSync(path.join(MIGRATIONS, d)).isDirectory()).sort()
    for (const d of dossiers) {
      fs.mkdirSync(path.join(arbre, 'migrations', d), { recursive: true })
      fs.copyFileSync(path.join(MIGRATIONS, d, 'migration.sql'), path.join(arbre, 'migrations', d, 'migration.sql'))
    }
    fs.writeFileSync(path.join(arbre, 'schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n')
    console.log(`[reconciliation] ${dossiers.length} migrations copiees : ${dossiers.join(', ')}`)

    // ── ETAPE 1 : Prisma applique les 9 migrations PREALABLES.
    const nine = dossiers.filter((d) => d < CIBLE)
    for (const d of dossiers.filter((d) => d >= CIBLE)) {
      fs.rmSync(path.join(arbre, 'migrations', d), { recursive: true, force: true })
    }
    const r1 = deploy(url, arbre, 'ETAPE 1 — migrate deploy sur les 9 migrations prealables')
    verifier(r1.status === 0, 'les 9 migrations prealables s appliquent', `exit ${r1.status}`)

    const compte = async () => Number((await pg2.$queryRawUnsafe('SELECT count(*)::int AS n FROM _prisma_migrations'))[0].n)
    verifier((await compte()) === nine.length, 'historique = 9 lignes avant reconciliation', `n=${await compte()}`)

    // Donnee clinique sentinelle : doit survivre intacte a la reconciliation.
    const pid = (await pg2.$queryRawUnsafe(
      `INSERT INTO patients (id, nom, prenom, telephone, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), 'Reconciliation','Sentinelle','0000000000',now(),now()) RETURNING id`,
    ))[0].id
    verifier(Boolean(pid), 'donnee clinique sentinelle inseree', String(pid))

    // ── ETAPE 2 : chemin manuel — tables creees a la main (SQL exact du depot).
    const sql = fs.readFileSync(path.join(MIGRATIONS, CIBLE, 'migration.sql'), 'utf8')
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS, CIBLE, 'migration.sql'))).digest('hex')
    console.log(`\n[reconciliation] SHA-256 du fichier de migration : ${sha}`)

    // Empreinte de reference mesuree a l'etape precedente par Prisma lui-meme.
    const CLE = '68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385'
    verifier(sha === CLE, 'SHA-256 du fichier = checksum mesure par Prisma 6.1.0', sha)

    const instructions = decouperSql(sql)
    for (const instruction of instructions) await pg2.$executeRawUnsafe(instruction)
    console.log(`[reconciliation] ${instructions.length} instructions executees`)

    const tables = await pg2.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sync_tombstone%' ORDER BY 1`)
    verifier(tables.length === 3, 'les 3 tables existent', JSON.stringify(tables.map((t) => t.table_name)))

    // INSERT manuel de l'historique — forme EXACTE de la ligne (_prisma_migrations.id
    // est un varchar, pas un uuid : on utilise un uuid texte, comme Prisma).
    await pg2.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, migration_name, logs, rolled_back_at, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, '${CLE}', '${CIBLE}', NULL, NULL, now(), now(), 1)`)
    verifier((await compte()) === nine.length + 1, 'historique = 10 lignes apres INSERT manuel', `n=${await compte()}`)

    // ── ETAPE 3 : migrate deploy doit etre un no-op.
    for (const d of dossiers) {
      fs.mkdirSync(path.join(arbre, 'migrations', d), { recursive: true })
      if (!fs.existsSync(path.join(arbre, 'migrations', d, 'migration.sql'))) {
        fs.copyFileSync(path.join(MIGRATIONS, d, 'migration.sql'), path.join(arbre, 'migrations', d, 'migration.sql'))
      }
    }
    const r3 = deploy(url, arbre, 'ETAPE 3 — migrate deploy APRES reconciliation (doit etre un no-op)')
    verifier(r3.status === 0, 'migrate deploy exit 0', `exit ${r3.status}`)
    verifier(/No pending migrations/i.test(r3.sortie), 'sortie « No pending migrations to apply »')
    verifier(!/Applying migration/i.test(r3.sortie), 'AUCUNE migration rejouee')

    // ── ETAPE 4 : controles finaux.
    const ligne = await pg2.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${CIBLE}'`)
    verifier(Number(ligne[0].n) === 1, 'la migration figure EXACTEMENT une fois', `n=${ligne[0].n}`)

    const chk = await pg2.$queryRawUnsafe(
      `SELECT checksum, applied_steps_count, rolled_back_at, logs FROM _prisma_migrations WHERE migration_name = '${CIBLE}'`)
    verifier(chk[0].checksum === CLE, 'checksum enregistre = checksum du fichier')
    verifier(Number(chk[0].applied_steps_count) === 1, 'applied_steps_count = 1')
    verifier(chk[0].rolled_back_at === null, 'rolled_back_at IS NULL')

    const patient = await pg2.$queryRawUnsafe(`SELECT nom FROM patients WHERE id = '${pid}'::uuid`)
    verifier(patient.length === 1 && patient[0].nom === 'Reconciliation', 'donnee clinique sentinelle intacte')

    const idx = await pg2.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'sync_tombstone%' ORDER BY 1`)
    const noms = idx.map((i) => i.indexname)
    for (const attendu of [
      'sync_tombstones_pkey', 'sync_tombstones_deletedAt_idx', 'sync_tombstones_entity_idx',
      'sync_tombstone_cursors_pkey', 'sync_tombstone_cursors_device_key', 'sync_tombstone_retention_pkey',
    ]) {
      verifier(noms.includes(attendu), `index present : ${attendu}`)
    }

    // Confirmation : les tables pre-existantes peuvent etre lues/traversees
    // normalement (aucune donnee clinique touchee par la migration).
    const counts = await pg2.$queryRawUnsafe(
      `SELECT (SELECT count(*)::int FROM patients) AS patients, (SELECT count(*)::int FROM payments) AS paiements`)
    console.log(`[reconciliation] volumes cliniques : ${JSON.stringify(counts)}`)
    verifier(Number(counts[0].patients) === 1, 'aucune ligne patients perdue')

    // `prisma migrate status` doit rapporter une base a jour.
    const st = spawnSync(process.execPath, [PRISMA, 'migrate', 'status', '--schema', path.join(arbre, 'schema.prisma')],
      { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000 })
    const sortieSt = (st.stdout || '') + (st.stderr || '')
    console.log('\n===== migrate status =====\n' + sortieSt.trim())
    verifier(st.status === 0 && /up to date/i.test(sortieSt), 'migrate status : base a jour')
  } finally {
    try { await pg2.$disconnect() } catch {}
    try { await pg.stop() } catch {}
    try { fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    console.log('\n[reconciliation] base jetable detruite.')
  }

  if (echecs.length) {
    console.log(`\nRESULTAT : ECHEC (${echecs.length})`)
    for (const e of echecs) console.log(' - ' + e)
    process.exit(1)
  }
  console.log('\nRESULTAT : OK — reconciliation verifiee de bout en bout.')
}

principal().catch((e) => { console.error(e); process.exit(1) })
