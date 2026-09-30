import type { Prisma, StatutTraitement } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE } from '@backend/domain/constants'
import { calcTotalPaye, calculerSoldeTraitement } from '@backend/services/payments.service'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE TRAITEMENTS (§12, §13) ET VISITES (§13)
 * =============================================================================
 *
 *  REGLE CENTRALE
 *    Un patient a un nombre ILLIMITE de traitements historiques.
 *    Un traitement a plusieurs VISITES (seances).
 *    Chaque visite peut porter un ou plusieurs paiements.
 *
 *  « Montant paye » et « reste a payer » ne sont JAMAIS stockes : ils sont
 *  TOUJOURS calcules a partir des paiements valides (§12).
 */

function parseDents(valeur: string): string[] {
  try {
    const analyse: unknown = JSON.parse(valeur)
    return Array.isArray(analyse) ? analyse.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

export interface TraitementAvecSolde {
  id: string
  patientId: string
  typeTraitement: string
  dents: string[]
  diagnostic: string | null
  description: string | null
  prixTotalCentimes: number
  /** Calcule — jamais stocke (§12). */
  montantPayeCentimes: number
  /** Calcule — jamais stocke (§12). */
  resteAPayerCentimes: number
  statut: StatutTraitement
  dateDebut: Date | null
  dateFin: Date | null
  notes: string | null
  createdAt: Date
  nombreVisites: number
}

export interface FiltresTraitements {
  patientId?: string
  statut?: StatutTraitement
  typeTraitement?: string
  dent?: string
  recherche?: string
  page: number
  taille: number
}

/**
 * Liste paginee des traitements, avec le solde calcule EN BASE.
 *
 * Le solde est obtenu par une agregation groupee separee, et non par une
 * requete par traitement : cela evite le probleme N+1 sur des milliers de
 * traitements (§35).
 */
export async function listerTraitements(
  filtres: FiltresTraitements,
): Promise<PageResult<TraitementAvecSolde>> {
  const idsEnCorbeille = await filtreExclusion('TRAITEMENT')

  const where: Prisma.TreatmentWhereInput = {
    id: idsEnCorbeille,
    ...(filtres.patientId ? { patientId: filtres.patientId } : {}),
    ...(filtres.statut ? { statut: filtres.statut } : {}),
    ...(filtres.typeTraitement
      ? { typeTraitement: { contains: filtres.typeTraitement, mode: 'insensitive' } }
      : {}),
    // Les dents sont stockees en JSON : on filtre par correspondance exacte sur
    // la representation serialisee, en SQL il s'agit d'un LIKE cible.
    ...(filtres.dent ? { dents: { contains: `"${filtres.dent}"` } } : {}),
    ...(filtres.recherche
      ? {
          OR: [
            { typeTraitement: { contains: filtres.recherche, mode: 'insensitive' } },
            { diagnostic: { contains: filtres.recherche, mode: 'insensitive' } },
            {
              patient: {
                OR: [
                  { nom: { contains: filtres.recherche, mode: 'insensitive' } },
                  { prenom: { contains: filtres.recherche, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {}),
  }

  const { skip, take } = bornesPrisma(filtres)

  const [lignes, total] = await Promise.all([
    prisma.treatment.findMany({
      where,
      orderBy: [{ dateDebut: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: { _count: { select: { visits: true } } },
    }),
    prisma.treatment.count({ where }),
  ])

  // Agregation des paiements valides pour CES traitements uniquement.
  const ids = lignes.map((ligne) => ligne.id)
  const montantsParTraitement = await calcTotalPaye(ids)

  const elements: TraitementAvecSolde[] = lignes.map((ligne) => {
    const montantPayeCentimes = montantsParTraitement.get(ligne.id) ?? 0
    return {
      id: ligne.id,
      patientId: ligne.patientId,
      typeTraitement: ligne.typeTraitement,
      dents: parseDents(ligne.dents),
      diagnostic: ligne.diagnostic,
      description: ligne.description,
      prixTotalCentimes: ligne.prixTotalCentimes,
      montantPayeCentimes,
      resteAPayerCentimes: ligne.prixTotalCentimes - montantPayeCentimes,
      statut: ligne.statut,
      dateDebut: ligne.dateDebut,
      dateFin: ligne.dateFin,
      notes: ligne.notes,
      createdAt: ligne.createdAt,
      nombreVisites: ligne._count.visits,
    }
  })

  return construirePage(elements, total, filtres)
}

/** Un traitement avec son solde calcule. */
export async function obtenirTraitement(id: string): Promise<TraitementAvecSolde> {
  const traitement = await prisma.treatment.findUnique({
    where: { id },
    include: { _count: { select: { visits: true } } },
  })
  if (!traitement) throw erreurs.introuvable('Traitement')

  const solde = await calculerSoldeTraitement(id)

  return {
    id: traitement.id,
    patientId: traitement.patientId,
    typeTraitement: traitement.typeTraitement,
    dents: parseDents(traitement.dents),
    diagnostic: traitement.diagnostic,
    description: traitement.description,
    prixTotalCentimes: traitement.prixTotalCentimes,
    montantPayeCentimes: solde.totalPayeCentimes,
    resteAPayerCentimes: solde.resteAPayerCentimes,
    statut: traitement.statut,
    dateDebut: traitement.dateDebut,
    dateFin: traitement.dateFin,
    notes: traitement.notes,
    createdAt: traitement.createdAt,
    nombreVisites: traitement._count.visits,
  }
}

/** Traitements d'un patient, pour sa fiche. */
export async function traitementsDuPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<TraitementAvecSolde>> {
  return listerTraitements({ patientId, ...pagination })
}

export interface DonneesTraitement {
  patientId: string
  typeTraitement: string
  dents: string[]
  diagnostic: string | null
  description: string | null
  prixTotalCentimes: number
  statut: StatutTraitement
  dateDebut: Date | null
  dateFin: Date | null
  notes: string | null
}

export async function creerTraitement(
  donnees: DonneesTraitement,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  const traitement = await prisma.treatment.create({
    data: {
      patientId: donnees.patientId,
      typeTraitement: donnees.typeTraitement,
      dents: JSON.stringify(donnees.dents),
      diagnostic: donnees.diagnostic,
      description: donnees.description,
      prixTotalCentimes: donnees.prixTotalCentimes,
      statut: donnees.statut,
      dateDebut: donnees.dateDebut,
      dateFin: donnees.dateFin,
      notes: donnees.notes,
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.TRAITEMENT_CREE, {
    entityType: 'Traitement',
    entityId: traitement.id,
    metadata: {
      patientId: donnees.patientId,
      typeTraitement: donnees.typeTraitement,
      prixTotalCentimes: donnees.prixTotalCentimes,
    },
  })

  return traitement
}

/**
 * Modifie un traitement.
 *
 * POINT DE VIGILANCE FINANCIER : si le prix total est BAISSE au point de passer
 * SOUS la somme des paiements deja encaisses, l'operation est refusee. La base
 * ne doit jamais contenir un traitement dont les paiements valides depassent le
 * prix (§17). Le medecin doit d'abord corriger ou annuler un paiement.
 */
export async function modifierTraitement(
  id: string,
  donnees: Partial<Omit<DonneesTraitement, 'patientId'>>,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.treatment.findUnique({ where: { id } })
  if (!existant) throw erreurs.introuvable('Traitement')

  if (donnees.prixTotalCentimes !== undefined) {
    const solde = await calculerSoldeTraitement(id)
    if (donnees.prixTotalCentimes < solde.totalPayeCentimes) {
      throw erreurs.montantInvalide(
        `Le prix total ne peut pas etre inferieur aux paiements deja encaisses (${(solde.totalPayeCentimes / 100).toLocaleString('fr-FR')} DA). Corrigez ou annulez d'abord un paiement.`,
      )
    }
  }

  await prisma.treatment.update({
    where: { id },
    data: {
      ...(donnees.typeTraitement !== undefined ? { typeTraitement: donnees.typeTraitement } : {}),
      ...(donnees.dents !== undefined ? { dents: JSON.stringify(donnees.dents) } : {}),
      ...(donnees.diagnostic !== undefined ? { diagnostic: donnees.diagnostic } : {}),
      ...(donnees.description !== undefined ? { description: donnees.description } : {}),
      ...(donnees.prixTotalCentimes !== undefined
        ? { prixTotalCentimes: donnees.prixTotalCentimes }
        : {}),
      ...(donnees.statut !== undefined ? { statut: donnees.statut } : {}),
      ...(donnees.dateDebut !== undefined ? { dateDebut: donnees.dateDebut } : {}),
      ...(donnees.dateFin !== undefined ? { dateFin: donnees.dateFin } : {}),
      ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
    },
  })

  await journaliser(contexte, ACTIONS.TRAITEMENT_MODIFIE, {
    entityType: 'Traitement',
    entityId: id,
    metadata: { statut: donnees.statut },
  })
}

// -----------------------------------------------------------------------------
//  VISITES (§13)
// -----------------------------------------------------------------------------

export interface VisiteAvecSolde {
  id: string
  treatmentId: string
  numeroSeance: number
  dateDebut: Date
  dateFin: Date | null
  notes: string | null
  proceduresRealisees: string | null
  appointmentId: string | null
  montantPayeCentimes: number
}

export async function listerVisites(treatmentId: string): Promise<VisiteAvecSolde[]> {
  const idsEnCorbeille = await filtreExclusion('VISITE_TRAITEMENT')

  const visites = await prisma.treatmentVisit.findMany({
    where: { treatmentId, id: idsEnCorbeille },
    orderBy: { numeroSeance: 'asc' },
    include: { payments: { where: { statut: 'VALIDE' }, select: { montantCentimes: true } } },
  })

  return visites.map((visite) => ({
    id: visite.id,
    treatmentId: visite.treatmentId,
    numeroSeance: visite.numeroSeance,
    dateDebut: visite.dateDebut,
    dateFin: visite.dateFin,
    notes: visite.notes,
    proceduresRealisees: visite.proceduresRealisees,
    appointmentId: visite.appointmentId,
    montantPayeCentimes: visite.payments.reduce((somme, p) => somme + p.montantCentimes, 0),
  }))
}

/**
 * Ajoute une visite a un traitement.
 * Le numero de seance est attribue AUTOMATIQUEMENT (dernier + 1), en
 * transaction : deux visites ne peuvent pas partager le meme numero.
 */
export async function ajouterVisite(
  donnees: {
    treatmentId: string
    dateDebut: Date
    dateFin: Date | null
    notes: string | null
    proceduresRealisees: string | null
    appointmentId: string | null
  },
  contexte: JournalContext,
): Promise<{ id: string; numeroSeance: number }> {
  const traitement = await prisma.treatment.findUnique({
    where: { id: donnees.treatmentId },
    select: { id: true },
  })
  if (!traitement) throw erreurs.introuvable('Traitement')

  const visite = await prisma.$transaction(async (tx) => {
    const derniere = await tx.treatmentVisit.findFirst({
      where: { treatmentId: donnees.treatmentId },
      orderBy: { numeroSeance: 'desc' },
      select: { numeroSeance: true },
    })
    const numeroSeance = (derniere?.numeroSeance ?? 0) + 1

    return tx.treatmentVisit.create({
      data: {
        treatmentId: donnees.treatmentId,
        numeroSeance,
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        notes: donnees.notes,
        proceduresRealisees: donnees.proceduresRealisees,
        appointmentId: donnees.appointmentId,
      },
      select: { id: true, numeroSeance: true },
    })
  })

  await journaliser(contexte, ACTIONS.VISITE_CREEE, {
    entityType: 'VisiteTraitement',
    entityId: visite.id,
    metadata: { treatmentId: donnees.treatmentId, numeroSeance: visite.numeroSeance },
  })

  return visite
}

/** Modifie une visite (notes, procedures, horaires). */
export async function modifierVisite(
  id: string,
  donnees: {
    dateFin?: Date | null
    notes?: string | null
    proceduresRealisees?: string | null
  },
  contexte: JournalContext,
): Promise<void> {
  const existante = await prisma.treatmentVisit.findUnique({ where: { id }, select: { id: true } })
  if (!existante) throw erreurs.introuvable('Visite')

  await prisma.treatmentVisit.update({
    where: { id },
    data: {
      ...(donnees.dateFin !== undefined ? { dateFin: donnees.dateFin } : {}),
      ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
      ...(donnees.proceduresRealisees !== undefined
        ? { proceduresRealisees: donnees.proceduresRealisees }
        : {}),
    },
  })

  await journaliser(contexte, ACTIONS.VISITE_MODIFIEE, {
    entityType: 'VisiteTraitement',
    entityId: id,
  })
}
