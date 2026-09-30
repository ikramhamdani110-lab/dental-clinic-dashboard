import { type NextRequest, NextResponse } from 'next/server'

import {
  csrfCookieOptions,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@backend/auth/session'
import { extraireIp, ok, responseErreur, routePublique } from '@backend/http/route-handler'
import { login } from '@backend/services/auth.service'
import { connexionSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/auth/login
 *
 * Route PUBLIQUE (l'utilisateur n'est pas encore connecte).
 * Cette route applique elle-meme ses protections : validation stricte,
 * limitation de debit et verrouillage de compte cote service.
 *
 * IMPORTANT : les cookies sont poses avec `HttpOnly` (session) et `Secure`
 * en production. Le jeton de session n'est jamais renvoye dans le corps de la
 * reponse, il ne circule que par le cookie.
 */
export const POST = routePublique(async (request: NextRequest): Promise<NextResponse> => {
  try {
    const corps = await lireCorpsJson(request)
    const donnees = valider(connexionSchema, corps)

    const resultat = await login(donnees.email, donnees.password, {
      ipAddress: extraireIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    const reponse = ok({
      utilisateur: {
        nomAffichage: resultat.user.displayName,
        email: resultat.user.email,
        role: resultat.user.role,
      },
    })

    // Cookie de session : HttpOnly, jamais accessible au JavaScript.
    reponse.cookies.set(SESSION_COOKIE_NAME, resultat.token, sessionCookieOptions())
    // Cookie CSRF : lisible par l'application cliente pour l'en-tete des requetes
    // mutantes. Il n'a aucune valeur seul (verifie contre l'empreinte serveur).
    reponse.cookies.set(CSRF_COOKIE_NAME, resultat.csrfToken, csrfCookieOptions())

    return reponse
  } catch (error) {
    return responseErreur(error)
  }
})
