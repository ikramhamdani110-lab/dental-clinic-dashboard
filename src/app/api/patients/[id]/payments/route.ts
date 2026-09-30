import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import { paiementsDuPatient } from '@backend/services/payments.service'
import { identifiant } from '@backend/validation/schemas'
import { valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/payments — paiements d'un patient, PAGINES (§32, §35).
 * Les paiements annules restent visibles (statut ANNULE) : l'historique
 * financier n'est jamais masque.
 */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await paiementsDuPatient(patientId, lirePagination(request.nextUrl.searchParams))
      return ok({ paiements: page.elements, total: page.total, page: page.page, taille: page.taille, pages: page.pages })
    } catch (error) {
      return responseErreur(error)
    }
  },
)
