import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { ajouterVisite, listerVisites } from '@backend/services/treatments.service'
import { identifiant, visiteCreationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/treatments/:id/visits — seances d'un traitement (§13).
 *
 * Exemple de la specification : une devitalisation comporte UN traitement et
 * PLUSIEURS visites. C'est cette route qui expose les seances, pas des
 * traitements separes.
 */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const traitementId = valider(identifiant, id)
    const visites = await listerVisites(traitementId)
    return ok({ visites })
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * POST /api/treatments/:id/visits — ajoute une seance.
 * Le NUMERO DE SEANCE est attribue automatiquement (dernier + 1), en
 * transaction : deux visites ne peuvent pas partager le meme numero.
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const traitementId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(visiteCreationSchema, {
      ...(corps as object),
      treatmentId: traitementId,
    })

    const visite = await ajouterVisite(
      {
        treatmentId: traitementId,
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        notes: donnees.notes,
        proceduresRealisees: donnees.proceduresRealisees,
        appointmentId: donnees.appointmentId ?? null,
      },
      contexte.journal,
    )

    return ok({ visite }, { status: 201 })
  } catch (error) {
    return responseErreur(error)
  }
})
