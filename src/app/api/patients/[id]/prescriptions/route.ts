import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { creerOrdonnance, listerOrdonnancesPatient } from '@backend/services/prescriptions.service'
import { identifiant, ordonnanceCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/prescriptions — ordonnances du patient, PAGINEES (§21).
 * Rappel : ordonnances NUMERIQUES uniquement, aucun PDF genere (§45).
 */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await listerOrdonnancesPatient(
        patientId,
        lirePagination(request.nextUrl.searchParams),
      )
      return ok({
        ordonnances: page.elements,
        total: page.total,
        page: page.page,
        taille: page.taille,
        pages: page.pages,
      })
    } catch (error) {
      return responseErreur(error)
    }
  },
)

/** POST /api/patients/:id/prescriptions — nouvelle ordonnance (§21). */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(ordonnanceCreationSchema, { ...(corps as object), patientId })

    const ordonnance = await creerOrdonnance(
      { ...donnees, treatmentId: donnees.treatmentId ?? null },
      contexte.journal,
    )
    return ok({ ordonnance }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
