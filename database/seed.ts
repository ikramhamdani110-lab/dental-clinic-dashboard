/**
 * =============================================================================
 *  CREATION DU COMPTE MEDECIN INITIAL
 * =============================================================================
 *
 *  Ce script cree le SEUL compte de l'application : celui du medecin (§2).
 *  Il s'execute UNE FOIS, au deploiement.
 *
 *  Usage :
 *    npm run db:seed
 *
 *  Variables requises (voir `.env.example`) :
 *    DOCTOR_EMAIL, DOCTOR_NAME, DOCTOR_INITIAL_PASSWORD
 *
 *  SECURITE
 *    - Le mot de passe n'est jamais passe en argument de ligne de commande (il
 *      apparaitrait dans l'historique du shell et dans la liste des processus) :
 *      il est lu dans l'environnement.
 *    - Le mot de passe est hache avec Argon2id, jamais stocke en clair (§6).
 *    - Le script est IDEMPOTENT : relance, il met a jour le compte existant
 *      sans creer de doublon.
 *
 *  Ce script ne cree AUCUN patient, AUCUN rendez-vous, AUCUN paiement : la base
 *  de production ne contient jamais de fausses donnees (§52).
 */

import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const email = process.env.DOCTOR_EMAIL
  const nom = process.env.DOCTOR_NAME
  const motDePasse = process.env.DOCTOR_INITIAL_PASSWORD
  const pepper = process.env.PASSWORD_PEPPER

  const manquants: string[] = []
  if (!email) manquants.push('DOCTOR_EMAIL')
  if (!nom) manquants.push('DOCTOR_NAME')
  if (!motDePasse) manquants.push('DOCTOR_INITIAL_PASSWORD')

  if (manquants.length > 0 || !email || !nom || !motDePasse) {
    process.stderr.write(
      [
        'Variables manquantes pour la creation du compte medecin :',
        ...manquants.map((variable) => `  - ${variable}`),
        '',
        'Renseignez-les dans `.env` (voir `.env.example`), puis relancez `npm run db:seed`.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  if (motDePasse.length < 12) {
    process.stderr.write(
      'DOCTOR_INITIAL_PASSWORD doit contenir au moins 12 caracteres. Le seed est interrompu.\n',
    )
    process.exit(1)
  }

  const valeurHachee = await argon2.hash(pepper ? `${motDePasse}${pepper}` : motDePasse, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  // Email normalise : l'unicite en base est insensible a la casse.
  const emailNormalise = email.trim().toLowerCase()

  const existant = await prisma.user.findFirst({
    where: { email: { equals: emailNormalise, mode: 'insensitive' } },
    select: { id: true },
  })

  if (existant) {
    await prisma.user.update({
      where: { id: existant.id },
      data: {
        displayName: nom,
        passwordHash: valeurHachee,
        role: 'MEDECIN',
        isActive: true,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
    })
    process.stdout.write(`Compte medecin mis a jour : ${emailNormalise}\n`)
  } else {
    await prisma.user.create({
      data: {
        email: emailNormalise,
        displayName: nom,
        role: 'MEDECIN',
        passwordHash: valeurHachee,
        isActive: true,
      },
    })
    process.stdout.write(`Compte medecin cree : ${emailNormalise}\n`)
  }

  process.stdout.write(
    [
      '',
      'Le compte medecin est pret. Connectez-vous sur /connexion.',
      'Changez le mot de passe initial des la premiere connexion (Parametres > Securite).',
      '',
    ].join('\n'),
  )
}

main()
  .catch((erreur: unknown) => {
    process.stderr.write(
      'Echec du seed : ' + (erreur instanceof Error ? erreur.message : String(erreur)) + '\n',
    )
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
