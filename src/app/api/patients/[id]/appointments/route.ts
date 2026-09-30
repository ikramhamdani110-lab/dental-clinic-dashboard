import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { rendezVousDuPatient } from '@backend/services/appointments.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/appointments — rendez-vous d'un patient, PAGINES (§32).
 * Filtre serveur : le patient de l'URL determine le perimetre, jamais le client.
 */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await rendezVousDuPatient(patientId, lirePagination(request.nextUrl.searchParams))
      return ok({ rendezVous: page.elements, total: page.total, page: page.page, taille: page.taille, pages: page.pages })
    } catch (error) {
      return responseErreur(error)
    }
  },
)
