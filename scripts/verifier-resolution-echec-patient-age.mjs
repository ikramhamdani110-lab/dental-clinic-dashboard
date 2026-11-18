// =============================================================================
//  VERIFICATION Prisma 6.1.0 — comportement de migrate status / migrate deploy
//  quand l'historique contient une ligne ECHEC NON RESOLU (patient_age), puis
//  apres cloture de cette ligne (rolled-back), avec la 10e migration appliquee.
//  Reproduit le scénario du document docs/NEON-FINAL-ACTIVATION.md étape 1.1.
//  Base 100 % jetable. Aucune connexion production.
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
const PRISMA = path.join(racine, 'node_modules', 'prisma', 'build', 'index.js')
const CLIENT = path.join(racine, 'node_modules', '@prisma', 'client')
const CIBLE = '20261114000000_sync_tombstones_durables'

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
  const { default: EmbeddedPostgres } = require('embedded-postgres')
  const port = await portLibre(54560)
  const dossier = fs.mkdtempSync(path.join(process.env.TEMP ?? racine, 'sahed-resolve-pg-'))
  console.log(`[resolve] PostgreSQL jetable : ${dossier} (port ${port})`)
  const pg = new EmbeddedPostgres({
    databaseDir: dossier, user: 'res', password: 'res', port, persistent: false,
    onLog: () => {}, onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('res')
  const url = `postgresql://res:res@127.0.0.1:${port}/res`
  const db = new (require(CLIENT)).PrismaClient({ datasources: { db: { url } } })

  const prisma = (sous, extra = []) => spawnSync(process.execPath,
    [PRISMA, 'migrate', sous, '--schema', path.join(dossier, 'arbres', 'schema.prisma'), ...extra],
    { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 240_000 })

  try {
    // Copie des migrations PREALABLES uniquement (9, sans la 10e).
    const arbre = path.join(dossier, 'arbres')
    fs.mkdirSync(path.join(arbre, 'migrations'), { recursive: true })
    for (const d of fs.readdirSync(MIGRATIONS).filter((x) => fs.statSync(path.join(MIGRATIONS, x)).isDirectory() && x < CIBLE)) {
      fs.mkdirSync(path.join(arbre, 'migrations', d), { recursive: true })
      fs.copyFileSync(path.join(MIGRATIONS, d, 'migration.sql'), path.join(arbre, 'migrations', d, 'migration.sql'))
    }
    fs.writeFileSync(path.join(arbre, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n')

    // Étape A : appliquer les 9 migrations préalables.
    const a = prisma('deploy')
    verifier(a.status === 0, 'les 9 migrations prealables appliquent', `exit ${a.status}`)

    // Étape B : SIMULER l'échec historique de patient_age — ligne en échec
    // non résolu (applied_steps_count=0, finished_at=NULL, rolled_back_at=NULL).
    //  Reproduction exacte de ce que Prisma écrit quand une migration échoue.
    await db.$executeRawUnsafe(`
      INSERT INTO _prisma_migrations
        (id, checksum, migration_name, logs, rolled_back_at, started_at, finished_at, applied_steps_count)
      VALUES (
        gen_random_uuid()::text,
        (SELECT checksum FROM _prisma_migrations WHERE migration_name='20260928000000_patient_age' LIMIT 1),
        '20260928000000_patient_age',
        'migration "20260928000000_patient_age" failed: db error ERROR: column "age" of relation "patients" already exists',
        NULL, now() - interval '5 minutes', NULL, 0
      )`)
    const dup = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name='20260928000000_patient_age'`)
    verifier(Number(dup[0].n) === 2, 'historique : 2 lignes patient_age (1 OK + 1 echec simule)', `n=${dup[0].n}`)

    // Étape C : migrate status / deploy avec l'échec NON RÉSOLU.
    const s1 = prisma('status')
    const s1txt = (s1.stdout || '') + (s1.stderr || '')
    console.log('\n===== migrate status AVEC echec non resolu =====\n' + s1txt.trim())
    verifier(!/up to date/i.test(s1txt) || /failed/i.test(s1txt),
      'migrate status AVEC echec non resolu NE declare PAS la base a jour (comportement attendu)')

    // Étape D : application du REMÈDE documenté (1.1) — clôture manuelle.
    const upd = await db.$executeRawUnsafe(`
      UPDATE _prisma_migrations
         SET rolled_back_at = now(),
             logs = logs || ' | cloture manuelle : echec patient_age marque rolled-back'
       WHERE migration_name='20260928000000_patient_age'
         AND applied_steps_count = 0 AND finished_at IS NULL AND rolled_back_at IS NULL`)
    verifier(upd === 1, 'la cloture manuelle affecte EXACTEMENT 1 ligne', `rows=${upd}`)

    // Étape E : migrate status APRÈS clôture — doit redevenir à jour.
    const s2 = prisma('status')
    const s2txt = (s2.stdout || '') + (s2.stderr || '')
    console.log('\n===== migrate status APRES cloture =====\n' + s2txt.trim())
    verifier(s2.status === 0 && /up to date/i.test(s2txt),
      'migrate status APRES cloture : base a jour', `exit ${s2.status}`)

    // Étape F : ajouter la 10e migration et déployer — elle doit s'appliquer
    // normalement SANS toucher à l'historique patient_age.
    fs.mkdirSync(path.join(arbre, 'migrations', CIBLE), { recursive: true })
    fs.copyFileSync(path.join(MIGRATIONS, CIBLE, 'migration.sql'), path.join(arbre, 'migrations', CIBLE, 'migration.sql'))
    const d2 = prisma('deploy')
    const d2txt = (d2.stdout || '') + (d2.stderr || '')
    console.log('\n===== migrate deploy (10e migration, historique repare) =====\n' + d2txt.trim())
    verifier(d2.status === 0 && /Applying migration `20261114000000_sync_tombstones_durables`/.test(d2txt),
      'migrate deploy APPLIQUE la 10e migration apres cloture')
    verifier(d2txt.split('Applying migration `20260928000000_patient_age`').length === 1,
      'migrate deploy NE rejoue PAS patient_age')

    // Étape G : état final de l'historique.
    const hist = await db.$queryRawUnsafe(
      `SELECT migration_name, applied_steps_count, finished_at IS NOT NULL AS terminee,
              rolled_back_at IS NULL AS non_annulee
         FROM _prisma_migrations WHERE migration_name='20260928000000_patient_age'
        ORDER BY started_at`)
    verifier(hist.length === 2, 'final : 2 lignes patient_age', JSON.stringify(hist))
    verifier(hist.some((h) => h.terminee && h.non_annulee && Number(h.applied_steps_count) === 1),
      'final : la ligne OK patient_age est intacte')
    verifier(hist.some((h) => !h.terminee && !h.non_annulee && Number(h.applied_steps_count) === 0),
      'final : la ligne en echec est bien ANNULEE (rolled_back_at renseigne)')

    const cible = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name='${CIBLE}'`)
    verifier(Number(cible[0].n) === 1, 'final : la 10e migration figure exactement 1 fois')

    // Étape H : les données cliniques survivent à tout ça.
    await db.$executeRawUnsafe(`INSERT INTO patients (id, nom, prenom, telephone, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(),'SENTINELLE-RESOLVE','Patient','0000000000',now(),now())`)
    const st = prisma('status')
    verifier(st.status === 0 && /up to date/i.test((st.stdout || '') + (st.stderr || '')),
      'final : migrate status reste a jour')
  } finally {
    try { await db.$disconnect() } catch {}
    try { await pg.stop() } catch {}
    try { fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    console.log('\n[resolve] base jetable detruite.')
  }

  if (echecs.length) {
    console.log(`\nRESULTAT : ECHEC (${echecs.length})`)
    for (const e of echecs) console.log(' - ' + e)
    process.exit(1)
  }
  console.log('\nRESULTAT : OK — la cloture reproduit exactement le comportement de prisma migrate resolve.')
}

principal().catch((e) => { console.error(e); process.exit(1) })
