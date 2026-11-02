import { NextResponse } from 'next/server'

import { routeFinanciereAvecId } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import {
  modifierTransactionPersonnelle,
  supprimerTransactionPersonnelle,
} from '@backend/services/transactions-personnelles.service'
import { transactionPersonnelleModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * PUT /api/finances/personal-transactions/[id] — modifie une transaction
 * personnelle (titre, montant, nature, direction, date, note).
 */
export const PUT = routeFinanciereAvecId(async (request, id, contexte): Promise<NextResponse> => {
    const corps = await lireCorpsJson(request)
    const donnees = valider(transactionPersonnelleModificationSchema, corps)

    await modifierTransactionPersonnelle(
      id,
      {
        ...(donnees.montantCentimes !== undefined ? { montantCentimes: donnees.montantCentimes } : {}),
        ...(donnees.nature !== undefined ? { nature: donnees.nature } : {}),
        ...(donnees.direction !== undefined ? { direction: donnees.direction } : {}),
        ...(donnees.titre !== undefined ? { titre: donnees.titre } : {}),
        ...(donnees.date !== undefined ? { date: donnees.date } : {}),
        ...(donnees.note !== undefined ? { note: donnees.note } : {}),
      },
      contexte.journal,
    )

    return ok({ modifie: true })
})

/**
 * DELETE /api/finances/personal-transactions/:id — supprime une transaction
 * personnelle. N'efface JAMAIS une écriture du cabinet (paiements, dettes
 * patients, dépenses du cabinet).
 */
export const DELETE = routeFinanciereAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  await supprimerTransactionPersonnelle(id, contexte.journal)
  return ok({ supprime: true })
})
