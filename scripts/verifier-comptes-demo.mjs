// Verification des comptes utilisateurs de la base de demonstration (lecture seule).
import { execSync } from 'node:child_process'

const motDePasse = execSync('node scripts/env-demo-parse.mjs password', {
  encoding: 'utf8',
}).trim()
const hote = execSync('node scripts/env-demo-parse.mjs host', { encoding: 'utf8' }).trim()
const port = execSync('node scripts/env-demo-parse.mjs port', { encoding: 'utf8' }).trim()
const base = execSync('node scripts/env-demo-parse.mjs database', { encoding: 'utf8' }).trim()
const utilisateur = execSync('node scripts/env-demo-parse.mjs user', { encoding: 'utf8' }).trim()

const { Client } = await import('pg')
const client = new Client({
  host: hote,
  port: Number(port),
  database: base,
  user: utilisateur,
  password: motDePasse,
})

await client.connect()
const r = await client.query(
  `SELECT email, "displayName", role, "isActive",
          CASE WHEN "passwordChangedAt" IS NOT NULL THEN 'oui' ELSE 'non' END AS mdp_change
   FROM "users" ORDER BY "createdAt"`,
)
process.stdout.write(JSON.stringify(r.rows, null, 1) + '\n')
await client.end()
