import type { Prisma } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { erreurs } from '@backend/errors/app-error'
import { bornesPrisma, construirePage, type PageResult } from '@backend/http/pagination'
import { filtreExclusion } from '@backend/services/trash.service'

/**
 * =============================================================================
 *  SERVICE PATIENTS (§9, §10, §26)
 * =============================================================================
 *
 *  REGLE ABSOLUE : l'identifiant interne (UUID) n'est JAMAIS affiche comme
 *  identifiant patient (§48). Les patients sont recherches par nom, prenom ou
 *  telephone.
 *
 *  La recherche et la pagination sont faites EN BASE (§35) : l'application ne
 *  charge jamais l'ensemble des patients dans le navigateur.
 */

export interface FiltresPatients {
  recherche?: string
  prefix?: string
  page: number
  taille: number
  tri?: 'nom' | 'prenom' | 'recent'
  ordre?: 'asc' | 'desc'
}

/** Normalise un terme de recherche : espaces compresses, borne de longueur. */
function normaliserRecherche(terme: string): string {
  return terme.trim().replace(/\s+/g, ' ').slice(0, 100)
}

function construireWhere(
  filtres: FiltresPatients,
  idsEnCorbeille: string[],
): Prisma.PatientWhereInput {
  const recherche = filtres.recherche ? normaliserRecherche(filtres.recherche) : ''
  const prefix = filtres.prefix ? normaliserRecherche(filtres.prefix) : ''

  // EXCLUSION DE LA CORBEILLE — appliquee a TOUTE lecture de patients.
  //
  // Le modele de suppression logique est porte par `trash_entries` (voir
  // `trash.service.ts`) : une entite est « supprimee » tant qu'elle possede une
  // entree active dans cette table. Ce service etait le SEUL a ne pas appliquer
  // ce filtre : un patient supprime continuait donc d'apparaitre dans la liste,
  // d'etre trouve par la recherche, et sa fiche restait ouvrable — la Corbeille
  // ne servait a rien pour les patients, alors qu'elle fonctionnait pour tous
  // les autres types d'entites.
  //
  // Le filtre est place dans le `AND` de base : il couvre AUSSI bien la liste
  // complete que la recherche, sans avoir a le repeter sur chaque chemin.
  const exclusionCorbeille: Prisma.PatientWhereInput = { id: { notIn: idsEnCorbeille } }

  if (recherche.length === 0 && prefix.length === 0) return exclusionCorbeille

  if (prefix.length > 0) {
    return {
      AND: [
        exclusionCorbeille,
        {
          OR: [
            { nom: { startsWith: prefix, mode: 'insensitive' as Prisma.QueryMode } },
            { prenom: { startsWith: prefix, mode: 'insensitive' as Prisma.QueryMode } },
          ],
        },
      ],
    }
  }

  // Le terme peut contenir plusieurs mots (« ahmed ben ») : chaque mot doit
  // correspondre a au moins un champ. Cela permet de rechercher « nom prenom »
  // dans n'importe quel ordre.
  const mots = recherche.split(' ').filter((mot) => mot.length > 0)

  return {
    AND: [
      exclusionCorbeille,
      ...mots.map((mot) => ({
        OR: [
          { nom: { contains: mot, mode: 'insensitive' as Prisma.QueryMode } },
          { prenom: { contains: mot, mode: 'insensitive' as Prisma.QueryMode } },
          { telephone: { contains: mot } },
          { telephoneSecondaire: { contains: mot } },
        ],
      })),
    ],
  }
}

function construireOrderBy(filtres: FiltresPatients): Prisma.PatientOrderByWithRelationInput[] {
  const ordre = filtres.ordre ?? 'asc'
  switch (filtres.tri) {
    case 'prenom':
      return [{ prenom: ordre }, { nom: ordre }]
    case 'recent':
      return [{ createdAt: 'desc' }]
    case 'nom':
    default:
      return [{ nom: ordre }, { prenom: ordre }]
  }
}

/** Selection publique d'un patient — SANS identifiant mis en avant comme « ID ». */
const selectionPatient = {
  id: true,
  nom: true,
  prenom: true,
  /** Age en annees revolues, saisi au cabinet (voir `lib/age`). */
  age: true,
  dateNaissance: true,
  sexe: true,
  telephone: true,
  telephoneSecondaire: true,
  adresse: true,
  email: true,
  allergies: true,
  antecedentsMedicaux: true,
  medicamentsActuels: true,
  contactUrgence: true,
  notesGenerales: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientSelect

export type PatientPublic = Prisma.PatientGetPayload<{ select: typeof selectionPatient }>

/**
 * Liste paginee des patients.
 * Une ligne « resume » ne charge PAS les champs medicaux longs : la liste
 * reste legere meme avec des milliers de fiches (§35).
 */
const selectionPatientListe = {
  id: true,
  nom: true,
  prenom: true,
  telephone: true,
  age: true,
  dateNaissance: true,
  sexe: true,
  createdAt: true,
} satisfies Prisma.PatientSelect

export interface PatientListeResume {
  id: string
  nom: string
  prenom: string
  telephone: string
  /** Age saisi au cabinet, `null` s'il n'a pas ete renseigne. */
  age: number | null
  dateNaissance: Date | null
  sexe: string
  createdAt: Date
}

export async function listerPatients(
  filtres: FiltresPatients,
): Promise<PageResult<PatientListeResume>> {
  const idsEnCorbeille = await filtreExclusion('PATIENT')
  const where = construireWhere(filtres, idsEnCorbeille.notIn)
  const { skip, take } = bornesPrisma(filtres)

  const [elements, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: construireOrderBy(filtres),
      skip,
      take,
      select: selectionPatientListe,
    }),
    prisma.patient.count({ where }),
  ])

  return construirePage(elements, total, filtres)
}

/** Un patient par identifiant interne. Leve INTROUVABLE si absent. */
export async function obtenirPatient(patientId: string): Promise<PatientPublic> {
  // Un patient en Corbeille est INTROUVABLE : il ne doit pas pouvoir etre
  // ouvert, modifie, ni servir de cible a un rendez-vous tant qu'il n'a pas ete
  // restaure. Le filtre est evalue AVANT la lecture, pour que la fiche
  // disparaisse exactement en meme temps que la ligne de la liste.
  const idsEnCorbeille = await filtreExclusion('PATIENT')

  const patient = await prisma.patient.findFirst({
    // Les DEUX conditions vivent dans la MEME cle `id` : l'identifiant demande
    // ET l'exclusion de la Corbeille. Les separer en deux cles `id` ferait
    // ecraser la premiere par la seconde, et la fiche renverrait n'importe quel
    // patient (bug constate : toute fiche ouvrait le meme dossier).
    where: { id: { equals: patientId, notIn: idsEnCorbeille.notIn } },
    select: selectionPatient,
  })
  if (!patient) throw erreurs.introuvable('Patient')
  return patient
}

/** Indique si un patient existe, sans lever. */
export async function patientExiste(patientId: string): Promise<boolean> {
  const idsEnCorbeille = await filtreExclusion('PATIENT')
  const compte = await prisma.patient.count({
    where: { id: { equals: patientId, notIn: idsEnCorbeille.notIn } },
  })
  return compte > 0
}

export interface DonneesCreationPatient {
  nom: string
  prenom: string
  /** Age en annees revolues, saisi au cabinet. `null` si non renseigne. */
  age: number | null
  dateNaissance: Date | null
  sexe: string
  telephone: string
  telephoneSecondaire: string | null
  adresse: string | null
  email: string | null
  allergies: string | null
  antecedentsMedicaux: string | null
  medicamentsActuels: string | null
  contactUrgence: string | null
  notesGenerales: string | null
}

export async function creerPatient(donnees: DonneesCreationPatient): Promise<PatientPublic> {
  return prisma.patient.create({
    data: {
      nom: donnees.nom,
      prenom: donnees.prenom,
      age: donnees.age,
      dateNaissance: donnees.dateNaissance,
      sexe: donnees.sexe as Prisma.PatientCreateInput['sexe'],
      telephone: donnees.telephone,
      telephoneSecondaire: donnees.telephoneSecondaire,
      adresse: donnees.adresse,
      email: donnees.email,
      allergies: donnees.allergies,
      antecedentsMedicaux: donnees.antecedentsMedicaux,
      medicamentsActuels: donnees.medicamentsActuels,
      contactUrgence: donnees.contactUrgence,
      notesGenerales: donnees.notesGenerales,
    },
    select: selectionPatient,
  })
}

/**
 * Modifie la fiche administrative du patient.
 *
 * PRINCIPE HISTORIQUE (§11) : cette mise a jour ne touche QUE les informations
 * d'identification courantes. Elle ne modifie JAMAIS un rendez-vous, un
 * traitement, un paiement ou un dossier medical deja enregistres : changer un
 * numero de telephone ne doit pas reecrire l'histoire clinique ni financiere.
 */
export async function modifierPatient(
  patientId: string,
  donnees: Partial<DonneesCreationPatient>,
): Promise<PatientPublic> {
  // Verification d'existence explicite : message francais clair plutot qu'une
  // erreur de contrainte brute.
  await obtenirPatient(patientId)

  return prisma.patient.update({
    where: { id: patientId },
    data: {
      ...(donnees.nom !== undefined ? { nom: donnees.nom } : {}),
      ...(donnees.prenom !== undefined ? { prenom: donnees.prenom } : {}),
      ...(donnees.dateNaissance !== undefined ? { dateNaissance: donnees.dateNaissance } : {}),
      ...(donnees.sexe !== undefined
        ? { sexe: donnees.sexe as Prisma.PatientUpdateInput['sexe'] }
        : {}),
      ...(donnees.telephone !== undefined ? { telephone: donnees.telephone } : {}),
      ...(donnees.telephoneSecondaire !== undefined
        ? { telephoneSecondaire: donnees.telephoneSecondaire }
        : {}),
      ...(donnees.adresse !== undefined ? { adresse: donnees.adresse } : {}),
      ...(donnees.email !== undefined ? { email: donnees.email } : {}),
      ...(donnees.allergies !== undefined ? { allergies: donnees.allergies } : {}),
      ...(donnees.antecedentsMedicaux !== undefined
        ? { antecedentsMedicaux: donnees.antecedentsMedicaux }
        : {}),
      ...(donnees.medicamentsActuels !== undefined
        ? { medicamentsActuels: donnees.medicamentsActuels }
        : {}),
      ...(donnees.contactUrgence !== undefined ? { contactUrgence: donnees.contactUrgence } : {}),
      ...(donnees.notesGenerales !== undefined ? { notesGenerales: donnees.notesGenerales } : {}),
    },
    select: selectionPatient,
  })
}

// -----------------------------------------------------------------------------
//  SOLDE DU PATIENT (§12, §44)
// -----------------------------------------------------------------------------
//
//  Le solde est TOUJOURS calcule a partir des donnees reelles :
//    totalTraitements = somme des prix totaux des traitements non annules
//    totalPaye        = somme des paiements VALIDE
//    resteAPayer      = totalTraitements - totalPaye
//
//  Aucune de ces valeurs n'est stockee (§12).

export interface SoldePatient {
  totalTraitementsCentimes: number
  totalPayeCentimes: number
  resteAPayerCentimes: number
  nombreTraitements: number
  nombreTraitementsEnCours: number
}

export async function calculerSoldePatient(patientId: string): Promise<SoldePatient> {
  // Deux agregations en base, executes en parallele. Le calcul est fait par
  // PostgreSQL/SQLite, jamais en chargeant chaque ligne dans l'application.
  const [agregatTraitements, agregatPaiements] = await Promise.all([
    prisma.treatment.aggregate({
      where: { patientId, statut: { not: 'ANNULE' } },
      _sum: { prixTotalCentimes: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { patientId, statut: 'VALIDE' },
      _sum: { montantCentimes: true },
    }),
  ])

  const nombreEnCours = await prisma.treatment.count({
    where: { patientId, statut: 'EN_COURS' },
  })

  const totalTraitementsCentimes = agregatTraitements._sum.prixTotalCentimes ?? 0
  const totalPayeCentimes = agregatPaiements._sum.montantCentimes ?? 0

  return {
    totalTraitementsCentimes,
    totalPayeCentimes,
    resteAPayerCentimes: totalTraitementsCentimes - totalPayeCentimes,
    nombreTraitements: agregatTraitements._count._all,
    nombreTraitementsEnCours: nombreEnCours,
  }
}

/**
 * Recherche rapide (deux-trois patients) pour les listes deroulantes.
 * Bornee a 20 resultats : c'est un selecteur, pas une liste complete.
 */
export async function rechercheRapide(
  terme: string,
): Promise<Array<{ id: string; nom: string; prenom: string; telephone: string }>> {
  const recherche = normaliserRecherche(terme)
  // Meme exclusion que la liste : un patient supprime ne doit pas non plus
  // apparaitre dans les selecteurs (rendez-vous, paiement, document...).
  const idsEnCorbeille = await filtreExclusion('PATIENT')
  const exclusion: Prisma.PatientWhereInput = { id: { notIn: idsEnCorbeille.notIn } }

  const where: Prisma.PatientWhereInput =
    recherche.length === 0
      ? exclusion
      : {
          AND: [
            exclusion,
            {
              OR: [
                { nom: { contains: recherche, mode: 'insensitive' } },
                { prenom: { contains: recherche, mode: 'insensitive' } },
                { telephone: { contains: recherche } },
              ],
            },
          ],
        }

  return prisma.patient.findMany({
    where,
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    take: 20,
    select: { id: true, nom: true, prenom: true, telephone: true },
  })
}
