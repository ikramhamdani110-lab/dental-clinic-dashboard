import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { changerMotDePasse } from '@backend/services/auth.service'
import { changementMotDePasseSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/auth/changer-mot-de-passe
 *
 * Change le mot de passe de l'utilisateur connecté (ancien vérifié côté
 * serveur). Utilisé par :
 *   - la première connexion, pour remplacer le mot de passe initial ;
 *   - le changement volontaire ultérieur (Paramètres > Sécurité).
 *
 * Après succès, la session EST CONSERVÉE : l'utilisateur reste connecté.
 * Toutes les autres sessions du compte sont révoquées par le service.
 */
export const POST = routePrivee(async (request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(changementMotDePasseSchema, corps)

    await changerMotDePasse(
      contexte.user.id,
      donnees.ancienMotDePasse,
      donnees.nouveauMotDePasse,
      {
        ...contexte.journal,
        userEmail: contexte.user.email,
      },
    )

    return ok({ message: 'Le mot de passe a été modifié avec succès.' })
  } catch (error) {
    return responseErreur(error)
  }
})
