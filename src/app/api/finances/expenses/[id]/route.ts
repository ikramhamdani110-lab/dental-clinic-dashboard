import { NextResponse } from 'next/server'

import { routeFinanciereAvecId } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import { modifierDepense, supprimerDepense } from '@backend/services/finances.service'
import { depenseModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/** PUT /api/finances/expenses/:id — modification (serveur autorisé). */
export const PUT = routeFinanciereAvecId(async (request, id, contexte): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(depenseModificationSchema, corps)

  await modifierDepense(
    id,
    {
      ...(donnees.montantCentimes !== undefined ? { montantCentimes: donnees.montantCentimes } : {}),
      ...(donnees.date !== undefined ? { date: donnees.date } : {}),
      ...(donnees.categorie !== undefined ? { categorie: donnees.categorie } : {}),
      ...(donnees.description !== undefined ? { description: donnees.description } : {}),
      ...(donnees.notes !== undefined ? { notes: donnees.notes } : {}),
    },
    contexte.journal,
  )

  return ok({ modifie: true })
})

/** DELETE /api/finances/expenses/:id — suppression (serveur autorisé). */
export const DELETE = routeFinanciereAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  await supprimerDepense(id, contexte.journal)
  return ok({ supprime: true })
})
