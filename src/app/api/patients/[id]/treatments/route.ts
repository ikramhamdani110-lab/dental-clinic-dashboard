import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { traitementsDuPatient } from '@backend/services/treatments.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/treatments — traitements du patient, PAGINES (§8, §35).
 *
 * Un patient a un nombre illimite de traitements historiques. Chaque traitement
 * porte son solde calcule (montant paye, reste a payer). Seule la page demandee
 * est lue en base.
 */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await traitementsDuPatient(patientId, lirePagination(request.nextUrl.searchParams))
      return ok({ traitements: page.elements, total: page.total, page: page.page, taille: page.taille, pages: page.pages })
    } catch (error) {
      return responseErreur(error)
    }
  },
)
