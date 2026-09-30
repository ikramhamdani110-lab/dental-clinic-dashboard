import { NextResponse } from 'next/server'

import { ok, responseErreur, routePriveeAvecId } from '@backend/http/route-handler'
import { identifiant } from '@backend/validation/schemas'
import { restaurer } from '@backend/services/trash.service'
import { valider } from '@backend/validation/validate'

/**
 * POST /api/trash/:id/restore — RESTAURATION (§23).
 *
 * La fenetre de 24 heures est revalidee COTE SERVEUR : si elle est ecoulee, la
 * restauration echoue avec un message clair, meme si l'interface affichait
 * encore du temps restant. Le minuteur du navigateur n'a aucune autorite.
 */
export const POST = routePriveeAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  try {
    const entreeId = valider(identifiant, id)
    await restaurer(entreeId, contexte.journal)
    return ok({ restaure: true })
  } catch (error) {
    return responseErreur(error)
  }
})
