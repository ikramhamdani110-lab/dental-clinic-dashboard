import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'

/**
 * =============================================================================
 *  PAGINATION (§35)
 * =============================================================================
 *
 *  Toute liste est paginee COTE SERVEUR. Le client ne demande qu'une page et
 *  ne recoit qu'une page : charger des milliers de patients dans le navigateur
 *  rendrait l'application inutilisable apres quelques annees d'exploitation.
 */

export interface PaginationParams {
  page: number
  taille: number
}

export interface PageResult<T> {
  elements: T[]
  total: number
  page: number
  taille: number
  pages: number
}

/** Lit et normalise les parametres de pagination depuis une URL. */
export function lirePagination(recherche: URLSearchParams): PaginationParams {
  const pageBrute = recherche.get('page')
  const tailleBrute = recherche.get('taille')

  const page = pageBrute ? Number.parseInt(pageBrute, 10) : 1
  const taille = tailleBrute ? Number.parseInt(tailleBrute, 10) : DEFAULT_PAGE_SIZE

  if (Number.isNaN(page) || page < 1) {
    throw erreurs.validation('Le numero de page doit etre un entier superieur ou egal a 1.', [
      { champ: 'page', message: 'Numero de page invalide.' },
    ])
  }
  if (Number.isNaN(taille) || taille < 1 || taille > MAX_PAGE_SIZE) {
    throw erreurs.validation(`La taille de page doit etre comprise entre 1 et ${MAX_PAGE_SIZE}.`, [
      { champ: 'taille', message: `Taille de page invalide (maximum ${MAX_PAGE_SIZE}).` },
    ])
  }

  return { page, taille }
}

/** Construit le resultat pagine normalise. */
export function construirePage<T>(
  elements: T[],
  total: number,
  { page, taille }: PaginationParams,
): PageResult<T> {
  return {
    elements,
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  }
}

/** Calcule `skip`/`take` pour Prisma. */
export function bornesPrisma({ page, taille }: PaginationParams): { skip: number; take: number } {
  return { skip: (page - 1) * taille, take: taille }
}
