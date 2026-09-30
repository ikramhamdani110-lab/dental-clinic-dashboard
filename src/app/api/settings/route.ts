import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { enregistrerParametres, lireParametres } from '@backend/services/settings.service'
import { parametresSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * GET /api/settings — parametres du cabinet (§28).
 * Uniquement des donnees d'affichage : aucun secret technique n'y figure.
 */
export const GET = routePrivee(async (_request: NextRequest): Promise<NextResponse> => {
  try {
    return ok({ parametres: await lireParametres() })
  } catch (error) {
    return responseErreur(error)
  }
})

/**
 * PUT /api/settings — enregistre les parametres (§28).
 * Les cles inconnues sont ignorees cote service : le client ne peut pas
 * introduire de parametre technique.
 */
export const PUT = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(parametresSchema, corps)

    // On ne conserve que les valeurs effectivement renseignees.
    const valeurs = Object.fromEntries(
      Object.entries(donnees).filter((entree): entree is [string, string] => entree[1] !== null),
    )

    const parametres = await enregistrerParametres(valeurs, contexte.journal)
    return ok({ parametres })
  } catch (error) {
    return responseErreur(error)
  }
})
