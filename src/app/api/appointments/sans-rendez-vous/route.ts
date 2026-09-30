import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { enregistrerVisiteSansRendezVous } from '@backend/services/appointments.service'
import { visiteSansRendezVousSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/appointments/sans-rendez-vous — visite NON PLANIFIEE.
 *
 * Le patient se presente au cabinet sans creneau reserve. La visite est
 * consignee DANS LA MEME table que les rendez-vous (aucune seconde structure
 * n'existe), avec un motif qui l'identifie explicitement : c'est ce marqueur,
 * et non l'anciennete du patient, qui alimente la section « Patients sans
 * rendez-vous » du tableau de bord.
 *
 * Aucune detection de conflit : l'absence de creneau est precisement ce qui
 * caracterise cette visite.
 */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(visiteSansRendezVousSchema, corps)

    const visite = await enregistrerVisiteSansRendezVous(
      {
        patientId: donnees.patientId,
        motifConsultation: donnees.motifConsultation,
        ...(donnees.dateDebut ? { dateDebut: donnees.dateDebut } : {}),
      },
      contexte.journal,
    )

    return ok({ visite }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})