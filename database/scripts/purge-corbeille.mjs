#!/usr/bin/env node
/**
 * =============================================================================
 *  PURGE DE LA CORBEILLE — FENETRE DE 24 HEURES (§23)
 * =============================================================================
 *
 *  Applique la suppression DEFINITIVE des elements dont la fenetre de
 *  restauration de 24 heures est ecoulee.
 *
 *  POURQUOI UN SCRIPT PLUTOT QU'UN MINUTEUR NAVIGATEUR ?
 *    La specification est explicite (§23) : « le minuteur de l'interface n'est
 *    que visuel ; apres 24 heures, la suppression definitive peut intervenir ».
 *    L'application n'applique donc AUCUNE suppression declenchee par le
 *    navigateur. C'est un travail SERVEUR, planifie (cron, Planificateur de
 *    taches Windows, ou tache systemd).
 *
 *  IMPORTANT — INTEGRITE REFERENTIELLE (§23, §49)
 *    Toutes les entites ne sont pas supprimables definitivement :
 *      - Un PAIEMENT ne l'est JAMAIS (evenement financier : il se corrige).
 *      - Un PATIENT avec des traitements/paiements ne l'est PAS.
 *      - Un TRAITEMENT avec des paiements ne l'est PAS.
 *    Ces elements restent en base meme apres expiration. Le script signale le
 *    nombre d'elements conserves pour raison d'historique.
 *
 *  Usage :
 *    node database/scripts/purge-corbeille.mjs
 *
 *  Planification recommandee : toutes les heures.
 *    Windows (Planificateur de taches) :
 *      Programme : node
 *      Arguments : database/scripts/purge-corbeille.mjs
 *      Recurrence : toutes les heures
 *    Linux (cron) :
 *      0 * * * * cd /app && node database/scripts/purge-corbeille.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** Duree de la fenetre de restauration — DOIT rester egale a 24 heures. */
const FENETRE_MS = 24 * 60 * 60 * 1000

async function supprimerEntite(type, entityId) {
  switch (type) {
    case 'PAIEMENT':
      // Interdit : un paiement est un evenement financier historique.
      return false
    case 'PATIENT': {
      const [traitements, paiements] = await Promise.all([
        prisma.treatment.count({ where: { patientId: entityId } }),
        prisma.payment.count({ where: { patientId: entityId } }),
      ])
      if (traitements > 0 || paiements > 0) return false
      await prisma.patient.delete({ where: { id: entityId } })
      return true
    }
    case 'TRAITEMENT': {
      const paiements = await prisma.payment.count({ where: { treatmentId: entityId } })
      if (paiements > 0) return false
      await prisma.treatment.delete({ where: { id: entityId } })
      return true
    }
    case 'RENDEZ_VOUS':
      await prisma.appointment.delete({ where: { id: entityId } })
      return true
    case 'VISITE_TRAITEMENT':
      await prisma.treatmentVisit.delete({ where: { id: entityId } })
      return true
    case 'DOSSIER_MEDICAL':
      await prisma.medicalRecord.delete({ where: { id: entityId } })
      return true
    case 'ORDONNANCE':
      await prisma.prescription.delete({ where: { id: entityId } })
      return true
    case 'DOCUMENT':
      await prisma.document.delete({ where: { id: entityId } })
      return true
    case 'ENTREE_ODONTOGRAMME':
      await prisma.odontogramEntry.delete({ where: { id: entityId } })
      return true
    default:
      return false
  }
}

async function main() {
  const maintenant = new Date()

  // Verification de coherence : la fenetre par defaut du schema doit etre 24 h.
  // Une entree dont `expireLe` ne vaut pas `supprimeLe + 24 h` signale une
  // anomalie (la contrainte CHECK PostgreSQL l'interdit, mais on verifie ici
  // aussi, car un environnement SQLite ne l'applique pas).
  const incoherentes = await prisma.trashEntry.findMany({
    where: { restaureLe: null, supprimeDefinitivementLe: null },
    select: { id: true, supprimeLe: true, expireLe: true },
  })

  const anomalie = incoherentes.filter(
    (entree) =>
      Math.abs(entree.expireLe.getTime() - entree.supprimeLe.getTime() - FENETRE_MS) > 1000,
  )
  if (anomalie.length > 0) {
    process.stderr.write(
      `[purge] ATTENTION : ${anomalie.length} entree(s) de corbeille n’ont pas une fenetre de 24 heures exacte.\n`,
    )
  }

  const entrees = await prisma.trashEntry.findMany({
    where: {
      restaureLe: null,
      supprimeDefinitivementLe: null,
      expireLe: { lte: maintenant },
    },
    take: 500,
  })

  let supprimes = 0
  let conserves = 0

  for (const entree of entrees) {
    try {
      const ok = await supprimerEntite(entree.entityType, entree.entityId)
      if (ok) {
        await prisma.trashEntry.update({
          where: { id: entree.id },
          data: { supprimeDefinitivementLe: maintenant, supprimeDefinitivementParId: null },
        })
        supprimes += 1
      } else {
        // Historique protege : l'entree reste, mais n'est plus restaurable.
        conserves += 1
      }
    } catch (erreur) {
      process.stderr.write(
        `[purge] Echec pour ${entree.entityType}/${entree.entityId} : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }\n`,
      )
    }
  }

  process.stdout.write(
    [
      'Purge de la Corbeille terminee.',
      `  Elements expires examines : ${entrees.length}`,
      `  Supprimes definitivement  : ${supprimes}`,
      `  Conserves (historique)    : ${conserves}`,
      '',
    ].join('\n'),
  )
}

main()
  .catch((erreur) => {
    process.stderr.write(
      '[purge] Echec : ' + (erreur instanceof Error ? erreur.message : String(erreur)) + '\n',
    )
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
