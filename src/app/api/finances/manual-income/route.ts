import { type NextRequest, NextResponse } from 'next/server'

import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  creerRevenuManuel,
  listerRevenusManuels,
} from '@backend/services/finances.service'
import {
  revenuManuelCreationSchema,
} from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/finances/manual-income — liste paginee des revenus manuels.
 * Filtres : `du`, `au`, `page`, `taille`.
 */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const params = request.nextUrl.searchParams
  const du = params.get('du')
  const au = params.get('au')
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1
  const taille = Number.parseInt(params.get('taille') ?? '25', 10) || 25

  const resultat = await listerRevenusManuels({
    ...(du ? { debut: new Date(`${du}T00:00:00`) } : {}),
    ...(au ? { fin: new Date(`${au}T23:59:59.999`) } : {}),
    page,
    taille,
  })

  return ok(resultat)
})

/**
 * POST /api/finances/manual-income — cree un revenu manuel.
 *
 * ANTI-DOUBLON : la cle `idempotencyKey` est UNIQUE en base. RÈGLE D'USAGE
 * rappelée au médecin a l'écran : une encaissement clinique se saisit dans
 * l'application de bureau ; le revenu manuel est réservé aux recettes HORS
 * circuit clinique.
 */
export const POST = routeFinanciere(async (request: NextRequest, contexte): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(revenuManuelCreationSchema, corps)

  const resultat = await creerRevenuManuel(
    {
      montantCentimes: donnees.montantCentimes,
      date: donnees.date,
      categorie: donnees.categorie,
      description: donnees.description,
      notes: donnees.notes,
      idempotencyKey: donnees.idempotencyKey,
    },
    contexte.journal,
  )

  return ok(resultat, { status: resultat.dejaEnregistre ? 200 : 201 })
})

/**
 * PUT/DELETE pour un identifiant précis vivent dans `manual-income/[id]/route.ts`.
 */
