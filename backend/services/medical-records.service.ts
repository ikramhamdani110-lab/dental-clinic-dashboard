import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE DOSSIERS MEDICAUX (§19)
 * =============================================================================
 *
 *  PRINCIPE FONDAMENTAL : chaque enregistrement est une ENTREE HISTORIQUE.
 *  Il n'existe PAS un grand champ « notes » editable qui ecraserait le passe.
 *
 *  Prendre une nouvelle observation, c'est CREER une entree datee. L'historique
 *  clinique du patient reste complet et trace dans le temps (§19, §11).
 */

export interface EntreeMedicale {
  id: string
  patientId: string
  treatmentId: string | null
  date: Date
  motifPlainte: string | null
  examen: string | null
  diagnostic: string | null
  traitementRealise: string | null
  observations: string | null
  recommandations: string | null
  dateSuivi: Date | null
  auteur: string | null
  createdAt: Date
}

/**
 * Dossiers medicaux d'un patient, du plus recent au plus ancien.
 *
 * PAGINATION SERVEUR (§35) : l'historique clinique d'un patient de longue date
 * grandit sans limite. Seule la page demandee est lue en base ; le tri
 * secondaire sur `createdAt` garantit un ordre deterministe a date egale.
 */
export async function listerDossiersPatient(
  patientId: string,
  pagination: { page: number; taille: number } = { page: 1, taille: DEFAULT_PAGE_SIZE },
): Promise<PageResult<EntreeMedicale>> {
  const idsEnCorbeille = await filtreExclusion('DOSSIER_MEDICAL')

  const where = { patientId, id: idsEnCorbeille }
  const { skip, take } = bornesPrisma(pagination)

  const [lignes, total] = await Promise.all([
    prisma.medicalRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: { createdBy: { select: { displayName: true, email: true } } },
    }),
    prisma.medicalRecord.count({ where }),
  ])

  const elements: EntreeMedicale[] = lignes.map((ligne) => ({
    id: ligne.id,
    patientId: ligne.patientId,
    treatmentId: ligne.treatmentId,
    date: ligne.date,
    motifPlainte: ligne.motifPlainte,
    examen: ligne.examen,
    diagnostic: ligne.diagnostic,
    traitementRealise: ligne.traitementRealise,
    observations: ligne.observations,
    recommandations: ligne.recommandations,
    dateSuivi: ligne.dateSuivi,
    auteur: ligne.createdBy?.displayName ?? ligne.createdBy?.email ?? null,
    createdAt: ligne.createdAt,
  }))

  return construirePage(elements, total, pagination)
}

/**
 * Variante bornee pour les usages internes qui n'ont besoin que des dernieres
 * entrees (jamais de l'historique complet).
 */
export async function listerDossiersRecents(
  patientId: string,
  limite: number = DEFAULT_PAGE_SIZE,
): Promise<EntreeMedicale[]> {
  const borne = Math.min(Math.max(1, limite), MAX_PAGE_SIZE)
  const page = await listerDossiersPatient(patientId, { page: 1, taille: borne })
  return page.elements
}

export async function obtenirDossier(id: string): Promise<EntreeMedicale> {
  const ligne = await prisma.medicalRecord.findUnique({
    where: { id },
    include: { createdBy: { select: { displayName: true, email: true } } },
  })
  if (!ligne) throw erreurs.introuvable('Dossier medical')

  return {
    id: ligne.id,
    patientId: ligne.patientId,
    treatmentId: ligne.treatmentId,
    date: ligne.date,
    motifPlainte: ligne.motifPlainte,
    examen: ligne.examen,
    diagnostic: ligne.diagnostic,
    traitementRealise: ligne.traitementRealise,
    observations: ligne.observations,
    recommandations: ligne.recommandations,
    dateSuivi: ligne.dateSuivi,
    auteur: ligne.createdBy?.displayName ?? ligne.createdBy?.email ?? null,
    createdAt: ligne.createdAt,
  }
}

export interface DonneesDossierMedical {
  patientId: string
  treatmentId: string | null
  date: Date
  motifPlainte: string | null
  examen: string | null
  diagnostic: string | null
  traitementRealise: string | null
  observations: string | null
  recommandations: string | null
  dateSuivi: Date | null
}

export async function creerDossierMedical(
  donnees: DonneesDossierMedical,
  contexte: JournalContext,
): Promise<{ id: string }> {
  const patient = await prisma.patient.findUnique({
    where: { id: donnees.patientId },
    select: { id: true },
  })
  if (!patient) throw erreurs.introuvable('Patient')

  const dossier = await prisma.medicalRecord.create({
    data: {
      patientId: donnees.patientId,
      treatmentId: donnees.treatmentId,
      date: donnees.date,
      motifPlainte: donnees.motifPlainte,
      examen: donnees.examen,
      diagnostic: donnees.diagnostic,
      traitementRealise: donnees.traitementRealise,
      observations: donnees.observations,
      recommandations: donnees.recommandations,
      dateSuivi: donnees.dateSuivi,
      createdById: contexte.userId,
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.DOSSIER_MEDICAL_CREE, {
    entityType: 'DossierMedical',
    entityId: dossier.id,
    metadata: { patientId: donnees.patientId },
  })

  return dossier
}

/**
 * Modifie une entree medicale.
 *
 * Une entree reste modifiable pour corriger une faute de frappe, mais la
 * modification est JOURNALISEE. Pour ajouter une nouvelle observation, la regle
 * clinique est de CREER une nouvelle entree : l'historique ne doit pas etre
 * reecrit (§19).
 */
export async function modifierDossierMedical(
  id: string,
  donnees: Partial<Omit<DonneesDossierMedical, 'patientId'>>,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.medicalRecord.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Dossier medical')

  await prisma.medicalRecord.update({
    where: { id },
    data: {
      ...(donnees.treatmentId !== undefined ? { treatmentId: donnees.treatmentId } : {}),
      ...(donnees.date !== undefined ? { date: donnees.date } : {}),
      ...(donnees.motifPlainte !== undefined ? { motifPlainte: donnees.motifPlainte } : {}),
      ...(donnees.examen !== undefined ? { examen: donnees.examen } : {}),
      ...(donnees.diagnostic !== undefined ? { diagnostic: donnees.diagnostic } : {}),
      ...(donnees.traitementRealise !== undefined
        ? { traitementRealise: donnees.traitementRealise }
        : {}),
      ...(donnees.observations !== undefined ? { observations: donnees.observations } : {}),
      ...(donnees.recommandations !== undefined
        ? { recommandations: donnees.recommandations }
        : {}),
      ...(donnees.dateSuivi !== undefined ? { dateSuivi: donnees.dateSuivi } : {}),
    },
  })

  await journaliser(contexte, ACTIONS.DOSSIER_MEDICAL_MODIFIE, {
    entityType: 'DossierMedical',
    entityId: id,
  })
}
