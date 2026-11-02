import type { Prisma, PersonalDirection, PersonalNature } from '@prisma/client'

import { prisma } from '@backend/database/prisma'
import { DEFAULT_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { ACTIONS, journaliser, type JournalContext } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  TRANSACTIONS PERSONNELLES DU MEDECIN (site financier privé)
 * =============================================================================
 *
 *  TABLE DEDIÉE, VOLONTAIREMENT ISOLÉE.
 *
 *  Une transaction personnelle n'est JAMAIS mélangée aux finances du cabinet :
 *    - elle ne compte dans AUCUN des trois totaux cliniques (paiements reçus,
 *      dettes patients, dépenses du cabinet) ;
 *    - elle ne vit que dans `personal_transactions`, consultable depuis la page
 *      « Écritures personnelles » du site financier.
 *
 *  LE SIGNE EST PORTE PAR LA NATURE, PAS PAR LE MONTANT :
 *    `montantCentimes` est TOUJOURS strictement positif (contrainte CHECK en
 *    base, comme pour les paiements). La lecture dépend uniquement de `nature` :
 *      - REVENUE            → argent personnel reçu (+) ;
 *      - DEPENSE            → argent personnel dépensé (−) ;
 *      - DETTE_PERSONNELLE  → argent personnellement du ou devant être reçu,
 *        direction explicite (`DO` / `DU_PAR_UN_TIERS`), JAMAIS incluse dans le
 *        solde personnel : ce n'est ni un encaissement ni une dépense.
 *
 *  ANTI-DOUBLON : `idempotencyKey` UNIQUE en base (même mécanisme que les
 *  paiements et les revenus manuels du cabinet).
 */

const NATURES: PersonalNature[] = ['REVENUE', 'DEPENSE', 'DETTE_PERSONNELLE']
const DIRECTIONS: PersonalDirection[] = ['DO', 'DU_PAR_UN_TIERS']

export interface DonneesTransactionPersonnelle {
  montantCentimes: number
  nature: PersonalNature
  direction: PersonalDirection | null
  titre: string
  date: Date
  note: string | null
  idempotencyKey: string
}

export interface LigneTransactionPersonnelle {
  id: string
  montantCentimes: number
  nature: PersonalNature
  direction: PersonalDirection | null
  titre: string
  date: string
  note: string | null
  createdAt: string
  updatedAt: string
}

/** Valide et normalise les données d'une transaction personnelle. */
function valider(donnees: {
  montantCentimes: number
  nature: string
  direction: string | null
  titre: string
  date: Date
  note: string | null
}): Omit<DonneesTransactionPersonnelle, 'idempotencyKey'> {
  if (donnees.montantCentimes <= 0) {
    throw erreurs.montantInvalide('Le montant doit être supérieur à zéro.')
  }
  if (!(NATURES as string[]).includes(donnees.nature)) {
    throw erreurs.validation('Nature de transaction personnelle inconnue.')
  }
  const titre = donnees.titre?.trim() ?? ''
  if (titre.length === 0) {
    throw erreurs.validation('Le titre est obligatoire.')
  }

  // Une dette personnelle porte TOUJOURS une direction ; les autres natures
  // n'en portent JAMAIS une (la colonne reste alors nulle — contrainte CHECK).
  let direction: PersonalDirection | null = null
  if (donnees.nature === 'DETTE_PERSONNELLE') {
    if (!donnees.direction || !(DIRECTIONS as string[]).includes(donnees.direction)) {
      throw erreurs.validation('Indiquez le sens de la dette (je dois / on me doit).')
    }
    direction = donnees.direction as PersonalDirection
  }

  return {
    montantCentimes: donnees.montantCentimes,
    nature: donnees.nature as PersonalNature,
    direction,
    titre,
    date: donnees.date,
    note: donnees.note?.trim() ? donnees.note.trim() : null,
  }
}

/** Crée une transaction personnelle (anti-doublon par clé d'idempotence). */
export async function creerTransactionPersonnelle(
  donneesBrutes: Omit<DonneesTransactionPersonnelle, 'idempotencyKey'> & { idempotencyKey: string },
  contexte: JournalContext,
): Promise<{ id: string; dejaEnregistre: boolean }> {
  const donnees = valider(donneesBrutes)

  const existant = await prisma.personalTransaction.findUnique({
    where: { idempotencyKey: donneesBrutes.idempotencyKey },
    select: { id: true },
  })
  if (existant) return { id: existant.id, dejaEnregistre: true }

  const ligne = await prisma.personalTransaction.create({
    data: {
      montantCentimes: donnees.montantCentimes,
      nature: donnees.nature,
      direction: donnees.direction,
      titre: donnees.titre,
      date: donnees.date,
      note: donnees.note,
      idempotencyKey: donneesBrutes.idempotencyKey,
      createdById: contexte.userId ?? '',
    },
    select: { id: true },
  })

  await journaliser(contexte, ACTIONS.TRANSACTION_PERSONNELLE_CREEE, {
    entityType: 'PersonalTransaction',
    entityId: ligne.id,
    metadata: { montantCentimes: donnees.montantCentimes, nature: donnees.nature },
  })

  return { id: ligne.id, dejaEnregistre: false }
}

/** Modifie une transaction personnelle existante. */
export async function modifierTransactionPersonnelle(
  id: string,
  changement: {
    montantCentimes?: number
    nature?: string
    direction?: string | null
    titre?: string
    date?: Date
    note?: string | null
  },
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.personalTransaction.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Transaction personnelle')

  // Fusionne avec l'état actuel pour que la validation voie un état complet
  // (une dette sans direction après édition serait un état interdit en base).
  const actuel = await prisma.personalTransaction.findUniqueOrThrow({ where: { id } })
  const donnees = valider({
    montantCentimes: changement.montantCentimes ?? actuel.montantCentimes,
    nature: changement.nature ?? actuel.nature,
    direction:
      changement.direction !== undefined ? changement.direction : (actuel.direction as string | null),
    titre: changement.titre ?? actuel.titre,
    date: changement.date ?? actuel.date,
    note: changement.note !== undefined ? changement.note : actuel.note,
  })

  await prisma.personalTransaction.update({
    where: { id },
    data: {
      montantCentimes: donnees.montantCentimes,
      nature: donnees.nature,
      direction: donnees.direction,
      titre: donnees.titre,
      date: donnees.date,
      note: donnees.note,
    },
  })

  await journaliser(contexte, ACTIONS.TRANSACTION_PERSONNELLE_MODIFIEE, {
    entityType: 'PersonalTransaction',
    entityId: id,
  })
}

/** Supprime une transaction personnelle (jamais les écritures du cabinet). */
export async function supprimerTransactionPersonnelle(
  id: string,
  contexte: JournalContext,
): Promise<void> {
  const existant = await prisma.personalTransaction.findUnique({ where: { id }, select: { id: true } })
  if (!existant) throw erreurs.introuvable('Transaction personnelle')

  await prisma.personalTransaction.delete({ where: { id } })

  await journaliser(contexte, ACTIONS.TRANSACTION_PERSONNELLE_SUPPRIMEE, {
    entityType: 'PersonalTransaction',
    entityId: id,
  })
}

/** Liste paginée des transactions personnelles, filtrable par nature et période. */
export async function listerTransactionsPersonnelles(filtres: {
  debut?: Date
  fin?: Date
  nature?: string
  page: number
  taille?: number
}): Promise<{
  elements: LigneTransactionPersonnelle[]
  total: number
  page: number
  pages: number
  taille: number
}> {
  const taille = Math.min(Math.max(1, filtres.taille ?? DEFAULT_PAGE_SIZE), 100)
  const page = Math.max(1, filtres.page)

  const where: Prisma.PersonalTransactionWhereInput = {
    ...(filtres.nature && (NATURES as string[]).includes(filtres.nature)
      ? { nature: filtres.nature as PersonalNature }
      : {}),
    ...(filtres.debut || filtres.fin
      ? { date: { ...(filtres.debut ? { gte: filtres.debut } : {}), ...(filtres.fin ? { lte: filtres.fin } : {}) } }
      : {}),
  }

  const [lignes, total] = await Promise.all([
    prisma.personalTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * taille,
      take: taille,
    }),
    prisma.personalTransaction.count({ where }),
  ])

  return {
    elements: lignes.map((l) => ({
      id: l.id,
      montantCentimes: l.montantCentimes,
      nature: l.nature,
      direction: l.direction,
      titre: l.titre,
      date: l.date.toISOString(),
      note: l.note,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / taille)),
    taille,
  }
}
