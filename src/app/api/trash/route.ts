import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { listerCorbeille, listerExpires } from '@backend/services/trash.service'

/**
 * GET /api/trash — contenu de la Corbeille, PAGINE (§23, §35).
 *
 * Renvoie les elements RESTAURABLES (fenetre de 24 h non ecoulee) et les
 * elements EXPIRES (lecture seule), chacun sous forme de page. Le nombre
 * d'elements supprimes pendant 24 h n'etant pas borne, la liste ne charge jamais
 * l'integralite de la Corbeille. Le temps restant est calcule COTE SERVEUR : le
 * minuteur de l'interface n'est qu'un affichage et ne fait foi pour rien.
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const pagination = lirePagination(request.nextUrl.searchParams)
    const [restaurables, expires] = await Promise.all([
      listerCorbeille(pagination),
      listerExpires(pagination),
    ])

    return ok({
      // La fenetre reste de 24 heures : regle du domaine inchangee.
      fenetreHeures: 24,
      elements: restaurables.elements.map((element) => ({
        id: element.id,
        type: element.entityType,
        description: element.description,
        supprimePar: element.supprimePar,
        supprimeLe: element.supprimeLe.toISOString(),
        expireLe: element.expireLe.toISOString(),
        tempsRestantMs: element.tempsRestantMs,
      })),
      total: restaurables.total,
      page: restaurables.page,
      taille: restaurables.taille,
      pages: restaurables.pages,
      expires: expires.elements.map((element) => ({
        id: element.id,
        type: element.entityType,
        description: element.description,
        supprimePar: element.supprimePar,
        supprimeLe: element.supprimeLe.toISOString(),
        expireLe: element.expireLe.toISOString(),
      })),
      expiresTotal: expires.total,
    })
  } catch (error) {
    return responseErreur(error)
  }
})
