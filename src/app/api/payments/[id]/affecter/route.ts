import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { affecterAcompte } from '@backend/services/payments.service'
import { identifiant } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/payments/:id/affecter — rattache un ACOMPTE à un traitement.
 *
 * L'ACOMPTE (paiement sans traitement) est affecté au traitement choisi :
 * la LIGNE EXISTANTE est mise à jour, aucun second paiement n'est créé —
 * l'argent n'est jamais compté deux fois. Date et montant originaux conservés.
 */
export const POST = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const paiementId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const treatmentId = valider(identifiant, (corps as { treatmentId?: string }).treatmentId ?? '')

    const resultat = await affecterAcompte(paiementId, treatmentId, contexte.journal)
    return ok(resultat)
  } catch (error) {
    return responseErreur(error)
  }
})
