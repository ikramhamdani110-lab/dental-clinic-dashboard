import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE ORDONNANCES (§21)
 * =============================================================================
 *
 *  L'ordonnance est NUMERIQUE UNIQUEMENT. AUCUN PDF n'est genere (§45).
 *  L'ordonnance reste dans l'historique du patient et peut etre consultee,
 *  imprimee par le navigateur si le medecin le souhaite, mais l'application ne
 *  fabrique jamais de document PDF.
 */

export interface LigneOrdonnance {
  id: string
  medicament: string
  dosage: string
  frequence: string
  duree: string
  instructions: string | null
  notes: string | null
}

export interface OrdonnanceComplete {
  id: string
  patientId: string
  treatmentId: string | null
  date: Date
  notes: string | null
  auteur: string | null
  createdAt: Date
  lignes: LigneOrdonnance[]
}

/**
 * Ordonnances d'un patient, de la plus recente a la plus ancienne.
 *
 * PAGINATION SERVEUR (§35) : une ordonnance numerique est conservee a vie ;
 * l'historique d'un patient de longue date grandit donc sans limite. Seule la
 * page demandee est lue en base. Le tri secondaire sur `createdAt` garantit un
 * ordre deterministe lorsque plusieurs ordonnances partagent la meme date.
 */
export async function listerOrdonnancesPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<OrdonnanceComplete>> {
  const idsEnCorbeille = await filtreExclusion('ORDONNANCE')

  const where = { patientId, id: idsEnCorbeille }
  const { skip, take } = bornesPrisma(pagination)

  const [lignes, total] = await Promise.all([
    prisma.prescription.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: {
        items: { orderBy: { position: 'asc' } },
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
    prisma.prescription.count({ where }),
  ])

  const elements: OrdonnanceComplete[] = lignes.map((ligne) => ({
    id: ligne.id,
    patientId: ligne.patientId,
    treatmentId: ligne.treatmentId,
    date: ligne.date,
    notes: ligne.notes,
    auteur: ligne.createdBy?.displayName ?? ligne.createdBy?.email ?? null,
    createdAt: ligne.createdAt,
    lignes: ligne.items.map((item) => ({
      id: item.id,
      medicament: item.medicament,
      dosage: item.dosage,
      frequence: item.frequence,
      duree: item.duree,
      instructions: item.instructions,
      notes: item.notes,
    })),
  }))

  return construirePage(elements, total, pagination)
}

/**
 * Variante bornee pour les usages internes qui n'ont besoin que des dernieres
 * ordonnances (jamais de l'historique complet).
 */
export async function listerOrdonnancesRecentes(
  patientId: string,
  limite: number = DEFAULT_PAGE_SIZE,
): Promise<OrdonnanceComplete[]> {
  const borne = Math.min(Math.max(1, limite), MAX_PAGE_SIZE)
  const page = await listerOrdonnancesPatient(patientId, { page: 1, taille: borne })
  return page.elements
}

export async function obtenirOrdonnance(id: string): Promise<OrdonnanceComplete> {
  const ligne = await prisma.prescription.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: 'asc' } },
      createdBy: { select: { displayName: true, email: true } },
    },
  })
  if (!ligne) throw erreurs.introuvable('Ordonnance')

  return {
    id: ligne.id,
    patientId: ligne.patientId,
    treatmentId: ligne.treatmentId,
    date: ligne.date,
    notes: ligne.notes,
    auteur: ligne.createdBy?.displayName ?? ligne.createdBy?.email ?? null,
    createdAt: ligne.createdAt,
    lignes: ligne.items.map((item) => ({
      id: item.id,
      medicament: item.medicament,
      dosage: item.dosage,
      frequence: item.frequence,
      duree: item.duree,
      instructions: item.instructions,
      notes: item.notes,
    })),
  }
}

export interface DonneesOrdonnance {
  patientId: string
  treatmentId: string | null
  date: Date
  notes: string | null
  lignes: Array<{
    medicament: string
    dosage: string
    frequence: string
    duree: string
    instructions: string | null
    notes: string | null
  }>
}

/**
 * Cree une ordonnance et ses lignes dans UNE TRANSACTION.
 * Une ordonnance sans ligne ne doit jamais exister : l'insertion est atomique.
 */
export async function creerOrdonnance(
  donnees: DonneesOrdonnance,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  if (donnees.lignes.length === 0) {
    throw erreurs.validation('Ajoutez au moins un medicament a l’ordonnance.', [
      { champ: 'lignes', message: 'Au moins un medicament est requis.' },
    ])
  }

  const ordonnance = await prisma.$transaction(async (tx) => {
    const cree = await tx.prescription.create({
      data: {
        patientId: donnees.patientId,
        treatmentId: donnees.treatmentId,
        date: donnees.date,
        notes: donnees.notes,
        createdById: contexte.userId,
      },
      select: { id: true },
    })

    await tx.prescriptionItem.createMany({
      data: donnees.lignes.map((ligne, index) => ({
        prescriptionId: cree.id,
        medicament: ligne.medicament,
        dosage: ligne.dosage,
        frequence: ligne.frequence,
        duree: ligne.duree,
        instructions: ligne.instructions,
        notes: ligne.notes,
        position: index,
      })),
    })

    return cree
  })

  await journaliser(contexte, ACTIONS.ORDONNANCE_CREEE, {
    entityType: 'Ordonnance',
    entityId: ordonnance.id,
    metadata: { patientId: donnees.patientId, nombreLignes: donnees.lignes.length },
  })

  return ordonnance
}

/**
 * Modifie une ordonnance : les lignes sont remplacees dans une transaction.
 * L'ordonnance conserve son identifiant et sa place dans l'historique.
 */
export async function modifierOrdonnance(
  id: string,
  donnees: { date?: Date; notes?: string | null; lignes?: DonneesOrdonnance['lignes'] },
  contexte: JournalContext,
): Promise<void> {
  const existante = await prisma.prescription.findUnique({ where: { id }, select: { id: true } })
  if (!existante) throw erreurs.introuvable('Ordonnance')

  await prisma.$transaction(async (tx) => {
    await tx.prescription.update({
      where: { id },
      data: {
        ...(donnees.date !== undefined ? { date: donnees.date } : {}),
        ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
      },
    })

    if (donnees.lignes) {
      if (donnees.lignes.length === 0) {
        throw erreurs.validation('Une ordonnance doit contenir au moins un medicament.')
      }
      await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } })
      await tx.prescriptionItem.createMany({
        data: donnees.lignes.map((ligne, index) => ({
          prescriptionId: id,
          medicament: ligne.medicament,
          dosage: ligne.dosage,
          frequence: ligne.frequence,
          duree: ligne.duree,
          instructions: ligne.instructions,
          notes: ligne.notes,
          position: index,
        })),
      })
    }
  })

  await journaliser(contexte, ACTIONS.ORDONNANCE_MODIFIEE, {
    entityType: 'Ordonnance',
    entityId: id,
  })
}
