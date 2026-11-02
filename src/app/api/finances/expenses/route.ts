import { type NextRequest, NextResponse } from 'next/server'

import { routeFinanciere } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  CATEGORIES_DEPENSE,
  creerDepense,
  listerDepenses,
} from '@backend/services/finances.service'
import { depenseCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/** GET /api/finances/expenses — liste paginee, filtres `du`, `au`, `categorie`. */
export const GET = routeFinanciere(async (request: NextRequest): Promise<NextResponse> => {
  const params = request.nextUrl.searchParams
  const du = params.get('du')
  const au = params.get('au')
  const categorie = params.get('categorie')
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1
  const taille = Number.parseInt(params.get('taille') ?? '25', 10) || 25

  const resultat = await listerDepenses({
    ...(du ? { debut: new Date(`${du}T00:00:00`) } : {}),
    ...(au ? { fin: new Date(`${au}T23:59:59.999`) } : {}),
    ...(categorie ? { categorie } : {}),
    page,
    taille,
  })

  return ok({ ...resultat, categories: CATEGORIES_DEPENSE })
})

/** POST /api/finances/expenses — enregistre une depense. */
export const POST = routeFinanciere(async (request: NextRequest, contexte): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(depenseCreationSchema, corps)

  const resultat = await creerDepense(
    {
      montantCentimes: donnees.montantCentimes,
      date: donnees.date,
      categorie: donnees.categorie,
      description: donnees.description ?? null,
      notes: donnees.notes ?? null,
      idempotencyKey: donnees.idempotencyKey,
    },
    contexte.journal,
  )

  return ok(resultat, { status: resultat.dejaEnregistre ? 200 : 201 })
})

/**
 * PUT/DELETE pour un identifiant précis vivent dans `expenses/[id]/route.ts`.
 */
