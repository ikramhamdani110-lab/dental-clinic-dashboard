import type { Prisma } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@backend/domain/constants'
import { logger } from '@backend/logging/logger'

/**
 * =============================================================================
 *  JOURNAL D'ACTIVITE (§24)
 * =============================================================================
 *
 *  Trace les evenements importants : connexions, creations, modifications,
 *  suppressions, restaurations, corrections de paiement, suppressions
 *  definitives.
 *
 *  REGLES DE CONFIDENTIALITE
 *    - Jamais de mot de passe, d'empreinte, de secret de session, de jeton.
 *    - Jamais de detail medical inutile : les metadonnees decrivent l'ACTION,
 *      pas le contenu clinique.
 *    - La journalisation ne doit JAMAIS faire echouer l'action metier : une
 *      erreur d'ecriture du journal est capturee et loguee, pas propagee.
 */

/** Actions journalisees. Constante unique, partagee par tous les modules. */
export const ACTIONS = {
  CONNEXION: 'Connexion',
  CONNEXION_ECHOUEE: 'Tentative de connexion echouee',
  DECONNEXION: 'Deconnexion',
  SESSION_REVOQUEE: 'Session revoquee',
  MOT_DE_PASSE_MODIFIE: 'Mot de passe modifie',
  MOT_DE_PASSE_REINITIALISE: 'Mot de passe reinitialise',

  PATIENT_CREE: 'Patient cree',
  PATIENT_MODIFIE: 'Patient modifie',
  PATIENT_SUPPRIME: 'Patient supprime',
  PATIENT_RESTAURE: 'Patient restaure',

  RENDEZ_VOUS_CREE: 'Rendez-vous cree',
  RENDEZ_VOUS_MODIFIE: 'Rendez-vous modifie',
  RENDEZ_VOUS_REPROGRAMME: 'Rendez-vous reprogramme',
  RENDEZ_VOUS_SUPPRIME: 'Rendez-vous supprime',
  RENDEZ_VOUS_RESTAURE: 'Rendez-vous restaure',

  TRAITEMENT_CREE: 'Traitement cree',
  TRAITEMENT_MODIFIE: 'Traitement modifie',
  TRAITEMENT_SUPPRIME: 'Traitement supprime',
  TRAITEMENT_RESTAURE: 'Traitement restaure',

  VISITE_CREEE: 'Visite de traitement creee',
  VISITE_MODIFIEE: 'Visite de traitement modifiee',
  VISITE_SUPPRIMEE: 'Visite de traitement supprimee',
  VISITE_RESTAUREE: 'Visite de traitement restauree',

  PAIEMENT_AJOUTE: 'Paiement ajoute',
  PAIEMENT_CORRIGE: 'Paiement corrige',
  PAIEMENT_ANNULE: 'Paiement annule',
  PAIEMENT_SUPPRIME: 'Paiement supprime',
  PAIEMENT_RESTAURE: 'Paiement restaure',

  DOSSIER_MEDICAL_CREE: 'Dossier medical cree',
  DOSSIER_MEDICAL_MODIFIE: 'Dossier medical modifie',
  DOSSIER_MEDICAL_SUPPRIME: 'Dossier medical supprime',
  DOSSIER_MEDICAL_RESTAURE: 'Dossier medical restaure',

  ORDONNANCE_CREEE: 'Ordonnance creee',
  ORDONNANCE_MODIFIEE: 'Ordonnance modifiee',
  ORDONNANCE_SUPPRIMEE: 'Ordonnance supprimee',
  ORDONNANCE_RESTAUREE: 'Ordonnance restauree',

  ODONTOGRAMME_MODIFIE: 'Odontogramme modifie',
  ODONTOGRAMME_SUPPRIME: 'Entree odontogramme supprimee',
  ODONTOGRAMME_RESTAURE: 'Entree odontogramme restauree',

  DOCUMENT_AJOUTE: 'Document ajoute',
  DOCUMENT_SUPPRIME: 'Document supprime',
  DOCUMENT_RESTAURE: 'Document restaure',

  SUPPRESSION_DEFINITIVE: 'Suppression definitive',
  PARAMETRES_MODIFIES: 'Parametres modifies',
} as const

export type ActionJournal = (typeof ACTIONS)[keyof typeof ACTIONS]

export interface JournalContext {
  userId: string | null
  userEmail: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Enregistre un evenement. Ne leve jamais : la tracabilite ne doit pas casser
 * une operation clinique en cours.
 */
export async function journaliser(
  context: JournalContext,
  action: ActionJournal,
  details?: {
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        userId: context.userId,
        userEmail: context.userEmail,
        entityType: details?.entityType ?? null,
        entityId: details?.entityId ?? null,
        // Les metadonnees sont serialisees en JSON. Elles ne doivent contenir
        // que des informations d'ACTION (§24).
        metadata: details?.metadata ? JSON.stringify(details.metadata) : null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    })
  } catch (error) {
    logger.error("Echec d'ecriture du journal d'activite", {
      action,
      entityType: details?.entityType,
      error,
    })
  }
}

// -----------------------------------------------------------------------------
//  CONSULTATION
// -----------------------------------------------------------------------------

export interface JournalFiltres {
  page?: number
  taille?: number
  /** Filtre par action exacte. */
  action?: string
  /** Filtre par type d'entite (ex. "Patient"). */
  entityType?: string
  /** Filtre par utilisateur. */
  userId?: string
  /** Bornes de date (incluses). */
  du?: Date
  au?: Date
}

function bornesPage(page?: number, taille?: number): { skip: number; take: number; page: number } {
  const pageValide = Math.max(1, Math.trunc(page ?? 1))
  const tailleValide = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(taille ?? DEFAULT_PAGE_SIZE)))
  return { skip: (pageValide - 1) * tailleValide, take: tailleValide, page: pageValide }
}

/**
 * Liste paginee du journal. La pagination est faite EN BASE : le journal peut
 * contenir des dizaines de milliers de lignes apres quelques annees, il n'est
 * jamais charge entierement dans le navigateur (§35).
 */
export async function listerJournal(filtres: JournalFiltres): Promise<{
  entrees: Array<{
    id: string
    action: string
    userEmail: string | null
    entityType: string | null
    entityId: string | null
    metadata: Record<string, unknown> | null
    ipAddress: string | null
    createdAt: Date
  }>
  total: number
  page: number
  taille: number
  pages: number
}> {
  const { skip, take, page } = bornesPage(filtres.page, filtres.taille)

  const where: Prisma.ActivityLogWhereInput = {
    ...(filtres.action ? { action: filtres.action } : {}),
    ...(filtres.entityType ? { entityType: filtres.entityType } : {}),
    ...(filtres.userId ? { userId: filtres.userId } : {}),
    ...(filtres.du || filtres.au
      ? {
          createdAt: {
            ...(filtres.du ? { gte: filtres.du } : {}),
            ...(filtres.au ? { lte: filtres.au } : {}),
          },
        }
      : {}),
  }

  const [entrees, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        action: true,
        userEmail: true,
        entityType: true,
        entityId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    prisma.activityLog.count({ where }),
  ])

  return {
    entrees: entrees.map((entree) => ({
      ...entree,
      metadata: entree.metadata ? (JSON.parse(entree.metadata) as Record<string, unknown>) : null,
    })),
    total,
    page,
    taille: take,
    pages: Math.max(1, Math.ceil(total / take)),
  }
}

/** Actions connues, triees — alimente le filtre de l'interface. */
export function actionsDisponibles(): string[] {
  return Object.values(ACTIONS).sort((a, b) => a.localeCompare(b, 'fr'))
}
