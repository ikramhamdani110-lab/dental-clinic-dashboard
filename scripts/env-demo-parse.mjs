/** Affiche des champs parsés de DATABASE_URL_DEMO sans exposer le mot de passe. */
import { readFileSync } from 'node:fs'

const envDemo = readFileSync('.env.demo', 'utf8')
const correspondance = envDemo.match(/DATABASE_URL_DEMO\s*=\s*"([^"]+)"/)
if (!correspondance) {
  console.error('DATABASE_URL_DEMO introuvable dans .env.demo')
  process.exit(1)
}
const url = new URL(correspondance[1])
const champ = process.argv[2]
const sortie = {
  host: url.hostname,
  port: url.port,
  database: url.pathname.replace(/^\//, ''),
  user: url.username,
}
if (champ === 'password') {
  process.stdout.write(decodeURIComponent(url.password))
} else {
  process.stdout.write(`${sortie[champ] ?? JSON.stringify(sortie)}\n`)
}
