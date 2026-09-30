import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import {
  historiqueReprogrammations,
  reprogrammerRendezVous,
} from '@backend/services/appointments.service'
import { identifiant, reprogrammationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/appointments/:id/reschedule — REPROGRAMMATION (§15).
 *
 * Conserve l'ancienne date ET l'ancienne heure, la nouvelle date ET la nouvelle
 * heure, l'utilisateur, l'horodatage et le motif eventuel. Le conflit est
 * verifie AVANT l'enregistrement. Rien n'est ecrase silencieusement.
 *
 * L'historique complet est renvoye dans la reponse, ce qui permet a l'interface
 * de l'afficher immediatement apres l'operation.
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const rendezVousId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(reprogrammationSchema, corps)

    await reprogrammerRendezVous(
      rendezVousId,
      {
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        motif: donnees.motif,
      },
      contexte.journal,
    )

    const historique = await historiqueReprogrammations(rendezVousId)

    return ok({
      reprogramme: true,
      nouvelleDateDebut: donnees.dateDebut.toISOString(),
      nouvelleDateFin: donnees.dateFin.toISOString(),
      historiqueReprogrammations: historique,
    })
  } catch (error) {
    return responseErreur(error)
  }
})
