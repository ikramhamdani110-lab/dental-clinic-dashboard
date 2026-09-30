import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { lirePagination } from '@backend/http/pagination'
import {
  creerDossierMedical,
  listerDossiersPatient,
} from '@backend/services/medical-records.service'
import { dossierMedicalCreationSchema, identifiant } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/patients/:id/medical-records — historique medical du patient (§19).
 *
 * Chaque entree est datee et conservee : ce n'est PAS un champ de notes unique
 * et ecrasable.
 *
 * PAGINATION SERVEUR (§35) : l'historique clinique grandit avec les annees.
 * Seule la page demandee est lue en base, jamais l'historique complet.
 */
export const GET = routePriveeAvecId(
  async (request: NextRequest, id): Promise<NextResponse> => {
    try {
      const patientId = valider(identifiant, id)
      const page = await listerDossiersPatient(patientId, lirePagination(request.nextUrl.searchParams))
      return ok({ dossiers: page.elements, total: page.total, page: page.page, taille: page.taille, pages: page.pages })
    } catch (error) {
      return responseErreur(error)
    }
  },
)

/** POST /api/patients/:id/medical-records — nouvelle entree medicale (§19). */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const patientId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    // Le patient de l'URL prime : il ne peut pas etre contourne par le corps.
    const donnees = valider(dossierMedicalCreationSchema, { ...(corps as object), patientId })

    const dossier = await creerDossierMedical(
      { ...donnees, treatmentId: donnees.treatmentId ?? null },
      contexte.journal,
    )
    return ok({ dossier }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
