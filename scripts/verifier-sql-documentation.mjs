// =============================================================================
//  VERIFICATION DES BLOCS SQL DU DOCUMENT docs/NEON-FINAL-ACTIVATION.md
// =============================================================================
//  Extrait TOUS les blocs ```sql du document et les execute, dans l'ordre, sur
//  une base PostgreSQL JETABLE pré-remplie pour imiter Neon :
//    - les 9 migrations préalables déjà appliquées ;
//    - l'historique _prisma_migrations correspondant ;
//    - quelques lignes cliniques sentinelles.
//  Puis vérifie que chaque SELECT de contrôle renvoie exactement ce que le
//  document annonce. Aucune connexion production.
// =============================================================================
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MIGRATIONS = path.join(racine, 'database', 'prisma', 'migrations')
const DOC = path.join(racine, 'docs', 'NEON-FINAL-ACTIVATION.md')
const CIBLE = '20261114000000_sync_tombstones_durables'
const PRISMA = path.join(racine, 'node_modules', 'prisma', 'build', 'index.js')
const CLIENT = path.join(racine, 'node_modules', '@prisma', 'client')

const echecs = []
const verifier = (c, m, d = '') => {
  if (!c) echecs.push(m)
  console.log(`${c ? 'OK  ' : 'ECHEC'} | ${m}${d ? ' — ' + d : ''}`)
}

async function portLibre(depart) {
  for (let p = depart; p < depart + 50; p++) {
    const libre = await new Promise((r) => {
      const s = net.createServer()
      s.once('error', () => r(false))
      s.once('listening', () => s.close(() => r(true)))
      s.listen(p, '127.0.0.1')
    })
    if (libre) return p
  }
  throw new Error('aucun port libre')
}

async function principal() {
  const doc = fs.readFileSync(DOC, 'utf8')
  // Tous les blocs ```sql — dans l'ordre du document.
  const blocs = [...doc.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1])
  console.log(`[doc] ${blocs.length} blocs SQL trouves dans ${path.basename(DOC)}`)
  verifier(blocs.length >= 5, 'le document contient les blocs SQL attendus', `n=${blocs.length}`)
  // Le document ne doit proposer AUCUNE instruction destructive.
  const sqlTotal = blocs.join('\n')
  verifier(!/^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im.test(sqlTotal), 'aucune instruction destructive (DROP/TRUNCATE/DELETE/UPDATE)')
  verifier(!/\.\.\./.test(blocs.join('\n')), 'aucune ellipse dans le SQL')
  verifier(!/passwo?rd\s*=\s*\S|postgres(ql)?:\/\/[^@\s]+@/i.test(doc), 'aucun identifiant de connexion dans le document')

  const { default: EmbeddedPostgres } = require('embedded-postgres')
  const port = await portLibre(54520)
  const dossier = fs.mkdtempSync(path.join(process.env.TEMP ?? racine, 'sahed-sqldoc-pg-'))
  console.log(`[doc] PostgreSQL jetable : ${dossier} (port ${port})`)
  const pg = new EmbeddedPostgres({
    databaseDir: dossier, user: 'doc', password: 'doc', port, persistent: false,
    onLog: () => {}, onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('doc')
  const url = `postgresql://doc:doc@127.0.0.1:${port}/doc`
  const db = new (require(path.join(CLIENT))).PrismaClient({ datasources: { db: { url } } })

  try {
    // Pré-remplissage : 9 migrations préalables + historique, comme Neon.
    const arbre = path.join(dossier, 'arbres')
    fs.mkdirSync(path.join(arbre, 'migrations'), { recursive: true })
    for (const d of fs.readdirSync(MIGRATIONS).filter((x) => fs.statSync(path.join(MIGRATIONS, x)).isDirectory() && x < CIBLE)) {
      fs.mkdirSync(path.join(arbre, 'migrations', d), { recursive: true })
      fs.copyFileSync(path.join(MIGRATIONS, d, 'migration.sql'), path.join(arbre, 'migrations', d, 'migration.sql'))
    }
    fs.writeFileSync(path.join(arbre, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n')
    const r = spawnSync(process.execPath, [PRISMA, 'migrate', 'deploy', '--schema', path.join(arbre, 'schema.prisma')],
      { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 180_000 })
    verifier(r.status === 0, 'base de depart preparee (9 migrations)', `exit ${r.status}`)

    // Données cliniques sentinelles.
    await db.$executeRawUnsafe(`INSERT INTO patients (id, nom, prenom, telephone, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(),'SENTINELLE-DOC','Patient','0000000000',now(),now())`)

    // ── Execution des blocs, dans l'ordre du document.
    //  L'editeur SQL de Neon accepte plusieurs instructions par requete (un jeu
    //  de resultats par instruction). L'API `$queryRawUnsafe` de Prisma, elle,
    //  passe par un prepared statement qui n'accepte QU'UNE instruction : on
    //  decoupe donc chaque bloc en instructions, exactement comme le fait
    //  l'editeur, et on execute dans l'ordre.
    for (let i = 0; i < blocs.length; i++) {
      const bloc = blocs[i]
      const instructions = bloc
        .split(/\r?\n/)
        .filter((l) => l.trim() && !/^\s*--/.test(l))
        .join('\n')
        .split(/;\s*(?=\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (instructions.length === 0) { console.log(`[bloc ${i + 1}] vide — ignore`); continue }
      try {
        let derniere = []
        for (const instruction of instructions) {
          derniere = await db.$queryRawUnsafe(instruction)
        }
        console.log(`[bloc ${i + 1}] OK (${instructions.length} instruction(s), ` +
          `${Array.isArray(derniere) ? derniere.length : 0} ligne(s) au dernier SELECT)`)
      } catch (e) {
        verifier(false, `bloc SQL ${i + 1} executable`, String(e?.meta?.message ?? e).slice(0, 200))
      }
    }

    // ── Contrôles finaux attendus par le document.
    const tables = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('sync_tombstones','sync_tombstone_cursors','sync_tombstone_retention')`)
    verifier(Number(tables[0].n) === 3, 'les 3 tables existent', `n=${tables[0].n}`)

    const hist = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n, min(checksum) AS c FROM _prisma_migrations WHERE migration_name='${CIBLE}'`)
    verifier(Number(hist[0].n) === 1, 'historique : exactement 1 ligne pour la migration', `n=${hist[0].n}`)
    verifier(hist[0].c === '68b8eda7f7d98da577d75f3a34ec1f031e8b2b7d59b97107dfe70920726fb385',
      'checksum enregistre correct', String(hist[0].c))

    const sent = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM patients WHERE nom='SENTINELLE-DOC'`)
    verifier(Number(sent[0].n) === 1, 'donnee clinique sentinelle intacte')

    // Colonnes : le document annonce 15 lignes (8 + 4 + 3).
    const cols = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name IN ('sync_tombstones','sync_tombstone_cursors','sync_tombstone_retention')`)
    verifier(Number(cols[0].n) === 15, 'le document annonce 15 colonnes', `n=${cols[0].n}`)

    // Index : le document annonce exactement ces 6 noms.
    const idx = await db.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public'
        AND tablename IN ('sync_tombstones','sync_tombstone_cursors','sync_tombstone_retention') ORDER BY 1`)
    const noms = idx.map((x) => x.indexname)
    const attendus = ['sync_tombstone_cursors_device_key', 'sync_tombstone_cursors_pkey',
      'sync_tombstone_retention_pkey', 'sync_tombstones_deletedAt_idx',
      'sync_tombstones_entity_idx', 'sync_tombstones_pkey']
    verifier(noms.length === 6 && attendus.every((a) => noms.includes(a)),
      'les 6 index annonces existent exactement', JSON.stringify(noms))

    // Defaut documente : now() - 100 ans sur lastTombstoneAt seul.
    const defaut = await db.$queryRawUnsafe(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name='sync_tombstone_cursors' AND column_name='lastTombstoneAt'`)
    verifier(/100 years/.test(String(defaut[0].column_default)), 'defaut lastTombstoneAt = now() - 100 ans',
      String(defaut[0].column_default))

    // Prisma doit considérer la base comme a jour.
    for (const d of fs.readdirSync(MIGRATIONS).filter((x) => fs.statSync(path.join(MIGRATIONS, x)).isDirectory())) {
      fs.mkdirSync(path.join(arbre, 'migrations', d), { recursive: true })
      if (!fs.existsSync(path.join(arbre, 'migrations', d, 'migration.sql'))) {
        fs.copyFileSync(path.join(MIGRATIONS, d, 'migration.sql'), path.join(arbre, 'migrations', d, 'migration.sql'))
      }
    }
    const st = spawnSync(process.execPath, [PRISMA, 'migrate', 'status', '--schema', path.join(arbre, 'schema.prisma')],
      { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000 })
    const sortie = (st.stdout || '') + (st.stderr || '')
    console.log('\n===== migrate status =====\n' + sortie.trim())
    verifier(st.status === 0 && /up to date/i.test(sortie), 'prisma migrate status : base a jour')
  } finally {
    try { await db.$disconnect() } catch {}
    try { await pg.stop() } catch {}
    try { fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    console.log('\n[doc] base jetable detruite.')
  }

  if (echecs.length) {
    console.log(`\nRESULTAT : ECHEC (${echecs.length})`)
    for (const e of echecs) console.log(' - ' + e)
    process.exit(1)
  }
  console.log('\nRESULTAT : OK — tous les blocs SQL du document sont executables et coherents.')
}

principal().catch((e) => { console.error(e); process.exit(1) })
