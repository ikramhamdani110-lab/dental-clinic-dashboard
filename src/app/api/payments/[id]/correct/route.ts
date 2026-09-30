import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { corrigerPaiement, historiqueCorrections } from '@backend/services/payments.service'
import { correctionPaiementSchema, identifiant } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/payments/:id/correct — CORRECTION / CONTRE-PASSATION (§17).
 *
 * Le paiement d'origine n'est JAMAIS modifie ni supprime : il est annule et
 * conserve. Une ligne d'audit (`payment_corrections`) enregistre les anciennes
 * et les nouvelles valeurs, l'auteur et l'horodatage.
 *
 * L'historique complet des corrections est renvoye dans la reponse.
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const paiementId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(correctionPaiementSchema, corps)

    const resultat = await corrigerPaiement(
      paiementId,
      {
        type: donnees.type,
        motif: donnees.motif,
        ...(donnees.nouveauMontantCentimes !== undefined
          ? { nouveauMontantCentimes: donnees.nouveauMontantCentimes }
          : {}),
        ...(donnees.nouvelleMethode !== undefined
          ? { nouvelleMethode: donnees.nouvelleMethode }
          : {}),
        ...(donnees.nouvelleDate !== undefined ? { nouvelleDate: donnees.nouvelleDate } : {}),
      },
      contexte.journal,
    )

    const historique = await historiqueCorrections(paiementId)

    return ok({
      paiementId: resultat.id,
      correctionEnregistree: true,
      historiqueCorrections: historique,
    })
  } catch (error) {
    return responseErreur(error)
  }
})
