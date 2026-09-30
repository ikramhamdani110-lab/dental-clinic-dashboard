#!/usr/bin/env node
/**
 * =============================================================================
 *  SAUVEGARDE POSTGRESQL (§40)
 * =============================================================================
 *
 *  Produit un `pg_dump` COMPRESSÉ (format custom, restaurable avec `pg_restore`).
 *
 *  POURQUOI UN SCRIPT ET NON UNE SIMPLE LIGNE DE COMMANDE ?
 *    Parce que les exigences de la specification (§40) depassent la simple
 *    execution de `pg_dump` :
 *      - le fichier doit etre horodate et range dans un repertoire de retention ;
 *      - l'anciennete des sauvegardes doit etre purgee selon une politique ;
 *      - le script doit echouer BRUYAMMENT si la sauvegarde est vide ou
 *        tronquee (une sauvegarde silencieusement vide est pire que pas de
 *        sauvegarde : elle donne une fausse assurance) ;
 *      - il doit pouvoir etre planifie (cron / Planificateur de taches).
 *
 *  CHIFFREMENT
 *    Le chiffrement de la sauvegarde est confie a l'OUTILLAGE systeme
 *    (chiffrement du volume, `age`/`gpg`, ou stockage objet chiffre cote
 *    fournisseur). Ce script produit le fichier brut et documente les etapes ;
 *    il n'invente pas un chiffrement maison, qui serait un faux sentiment de
 *    securite. Voir docs/BACKUP.md.
 *
 *  Usage :
 *    node database/scripts/backup-postgres.mjs
 *
 *  Variables :
 *    DATABASE_URL             chaine de connexion PostgreSQL (obligatoire)
 *    BACKUP_DIR               repertoire de destination (defaut : ./backups)
 *    BACKUP_RETENTION_JOURS   duree de conservation en jours (defaut : 30)
 *    PGPASSWORD / PGPASSFILE  authentification (jamais en ligne de commande)
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const executer = promisify(execFile)

const TAILLE_MIN_OCTETS = 1024 // un dump plus petit est suspect

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    process.stderr.write('DATABASE_URL est obligatoire pour la sauvegarde.\n')
    process.exit(1)
  }

  const dossier = resolve(process.env.BACKUP_DIR ?? './backups')
  const retentionJours = Number.parseInt(process.env.BACKUP_RETENTION_JOURS ?? '30', 10)

  await mkdir(dossier, { recursive: true })

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const fichier = join(dossier, `sahed-${horodatage}.dump`)

  process.stdout.write(`Sauvegarde en cours vers ${fichier}...\n`)

  try {
    // `--format=custom` produit un fichier compresse et restaurable de facon
    // selective ; `--no-owner` rend la restauration portable entre serveurs.
    await executer(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', '--file', fichier, url],
      {
        maxBuffer: 1024 * 1024 * 64,
      },
    )
  } catch (erreur) {
    process.stderr.write(
      '[sauvegarde] pg_dump a echoue : ' +
        (erreur instanceof Error ? erreur.message : String(erreur)) +
        '\n',
    )
    process.stderr.write(
      'Verifiez que `pg_dump` est installe et accessible, et que DATABASE_URL est correcte.\n',
    )
    process.exit(1)
  }

  // Verification de la taille : un dump quasi vide signale un echec silencieux.
  const informations = await stat(fichier)
  if (informations.size < TAILLE_MIN_OCTETS) {
    process.stderr.write(
      `[sauvegarde] Le fichier produit est suspicieusement petit (${informations.size} octets). Sauvegarde consideree comme invalide.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`Sauvegarde reussie : ${(informations.size / 1024 / 1024).toFixed(1)} Mo.\n`)

  // Purge des sauvegardes plus anciennes que la retention.
  const limite = Date.now() - retentionJours * 24 * 60 * 60 * 1000
  const fichiers = await readdir(dossier)
  let purges = 0
  for (const nom of fichiers) {
    if (!nom.endsWith('.dump')) continue
    const chemin = join(dossier, nom)
    const info = await stat(chemin)
    if (info.mtimeMs < limite) {
      await unlink(chemin)
      purges += 1
    }
  }

  process.stdout.write(
    [
      `Retention : ${retentionJours} jours.`,
      `Anciennes sauvegardes supprimees : ${purges}.`,
      '',
      'ETAPES SUIVANTES OBLIGATOIRES (voir docs/BACKUP.md) :',
      '  1. CHIFFRER le fichier (age, gpg) avant tout transfert.',
      '  2. COPIER le fichier chiffre vers un stockage HORS SITE.',
      '  3. TESTER une restauration periodiquement (procedure documentee).',
      '',
    ].join('\n'),
  )
}

main().catch((erreur) => {
  process.stderr.write(
    '[sauvegarde] Echec : ' + (erreur instanceof Error ? erreur.message : String(erreur)) + '\n',
  )
  process.exit(1)
})
