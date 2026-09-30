import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { creerTraitement, listerTraitements } from '@backend/services/treatments.service'
import { statutTraitementSchema, traitementCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/treatments — liste paginee des traitements (§26).
 * Filtres : patient, dent, type, statut, recherche.
 */
export const GET = routePrivee(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const params = request.nextUrl.searchParams
    const pagination = lirePagination(params)
    const statutBrut = params.get('statut')

    const resultat = await listerTraitements({
      ...pagination,
      ...(params.get('patientId') ? { patientId: params.get('patientId') as string } : {}),
      ...(params.get('typeTraitement')
        ? { typeTraitement: params.get('typeTraitement') as string }
        : {}),
      ...(params.get('dent') ? { dent: params.get('dent') as string } : {}),
      ...(params.get('recherche') ? { recherche: params.get('recherche') as string } : {}),
      ...(statutBrut ? { statut: valider(statutTraitementSchema, statutBrut) } : {}),
    })

    return ok(resultat)
  } catch (error) {
    return responseErreur(error)
  }
})

/** POST /api/treatments — cree un traitement rattache a un patient (§12). */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(traitementCreationSchema, corps)

    const traitement = await creerTraitement(donnees, contexte.journal)
    return ok({ traitement }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
