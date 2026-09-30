import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { actionsDisponibles, listerJournal } from '@backend/services/activity-log.service'
import { erreurs } from '@backend/errors/app-error'

/**
 * GET /api/activity-log — journal d'activite pagine (§24).
 *
 * Filtres : action exacte, type d'entite, utilisateur, plage de dates.
 * Pagination SERVEUR : le journal peut contenir des dizaines de milliers de
 * lignes apres quelques annees, il n'est jamais charge entierement (§35).
 *
 * Les metadonnees journalisees ne contiennent JAMAIS de secret ni de detail
 * medical inutile (§24).
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const params = request.nextUrl.searchParams
    const pagination = lirePagination(params)

    const du = params.get('du')
    const au = params.get('au')

    if (du && Number.isNaN(Date.parse(du))) {
      throw erreurs.validation('La date de debut du filtre est invalide.')
    }
    if (au && Number.isNaN(Date.parse(au))) {
      throw erreurs.validation('La date de fin du filtre est invalide.')
    }

    const resultat = await listerJournal({
      ...pagination,
      ...(params.get('action') ? { action: params.get('action') as string } : {}),
      ...(params.get('entityType') ? { entityType: params.get('entityType') as string } : {}),
      ...(du ? { du: new Date(du) } : {}),
      ...(au ? { au: new Date(au) } : {}),
    })

    return ok({
      ...resultat,
      // Les actions connues sont fournies pour alimenter le filtre, evitant au
      // client de les connaitre en dur.
      actionsDisponibles: actionsDisponibles(),
    })
  } catch (error) {
    return responseErreur(error)
  }
})
