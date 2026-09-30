import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import {
  listerVisites,
  modifierTraitement,
  obtenirTraitement,
} from '@backend/services/treatments.service'
import { mettreEnCorbeille } from '@backend/services/trash.service'
import { identifiant, traitementModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/** GET /api/treatments/:id — traitement, son solde calcule et ses visites. */
export const GET = routePriveeAvecId(async (_request, id): Promise<NextResponse> => {
  try {
    const traitementId = valider(identifiant, id)
    const [traitement, visites] = await Promise.all([
      obtenirTraitement(traitementId),
      listerVisites(traitementId),
    ])
    return ok({ traitement, visites })
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * PUT /api/treatments/:id — modifie un traitement.
 *
 * Le service REFUSE de baisser le prix total sous la somme des paiements deja
 * encaisses : la base ne doit jamais contenir un tel etat (§17).
 */
export const PUT = routePriveeAvecId(async (request, id, contexte): Promise<NextResponse> => {
  try {
    const traitementId = valider(identifiant, id)
    const corps = await lireCorpsJson(request)
    const donnees = valider(traitementModificationSchema, corps)

    await modifierTraitement(traitementId, donnees, contexte.journal)
    return ok({ modifie: true })
  } catch (error) {
    return responseErreur(error)
  }
})

/** DELETE /api/treatments/:id — mise en Corbeille (24 h). */
export const DELETE = routePriveeAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  try {
    const traitementId = valider(identifiant, id)
    const resultat = await mettreEnCorbeille('TRAITEMENT', traitementId, contexte.journal)
    return ok({ corbeille: { expireLe: resultat.expireLe.toISOString() } })
  } catch (error) {
    return responseErreur(error)
  }
})
