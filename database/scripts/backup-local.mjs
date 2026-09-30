#!/usr/bin/env node
/**
 * =============================================================================
 *  SAUVEGARDE DE LA BASE LOCALE (developpement / verification)
 * =============================================================================
 *
 *  Copie la base SQLite locale `.local/dev.db` vers `backups/`.
 *
 *  Ce script ne remplace PAS la sauvegarde de production (§40), qui porte sur
 *  PostgreSQL via `backup-postgres.mjs`. Il sert uniquement a ne pas perdre un
 *  jeu de verification local en cours de travail.
 *
 *  Usage : node database/scripts/backup-local.mjs
 */

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const racine = resolve(__dirname, '..', '..')
const source = join(racine, '.local', 'dev.db')
const dossier = join(racine, 'backups')

async function main() {
  let taille = 0
  try {
    const info = await stat(source)
    taille = info.size
  } catch {
    process.stderr.write(
      `Base locale introuvable : ${source}\n` +
      'Executez d’abord `npm run db:sqlite:setup`.\n',
    )
    process.exit(1)
  }

  await mkdir(dossier, { recursive: true })
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const cible = join(dossier, `dev-local-${horodatage}.db`)

  await copyFile(source, cible)

  process.stdout.write(
    [
      'Sauvegarde locale effectuee.',
      `  Source : ${source}`,
      `  Cible  : ${cible}`,
      `  Taille : ${(taille / 1024).toFixed(0)} Ko`,
      '',
      'Rappel : cette base est une base de DEVELOPPEMENT. La source de verite',
      'en production est PostgreSQL (voir docs/BACKUP.md).',
      '',
    ].join('\n'),
  )
}

main().catch((erreur) => {
  process.stderr.write(
    '[sauvegarde-locale] Echec : ' + (erreur instanceof Error ? erreur.message : String(erreur)) + '\n',
  )
  process.exit(1)
})