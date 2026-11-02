import { NextResponse } from 'next/server'

import { routeFinanciereAvecId } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import { modifierRevenuManuel, supprimerRevenuManuel } from '@backend/services/finances.service'
import { revenuManuelModificationSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/** PUT /api/finances/manual-income/:id — modification (serveur autorisé). */
export const PUT = routeFinanciereAvecId(async (request, id, contexte): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(revenuManuelModificationSchema, corps)

  await modifierRevenuManuel(
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

/** DELETE /api/finances/manual-income/:id — suppression (serveur autorisé). */
export const DELETE = routeFinanciereAvecId(async (_request, id, contexte): Promise<NextResponse> => {
  await supprimerRevenuManuel(id, contexte.journal)
  return ok({ supprime: true })
})
