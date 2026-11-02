import { type NextRequest, NextResponse } from 'next/server'

import {
  optionsCookieCsrfFinancier,
  optionsCookieSessionFinanciere,
  FINANCE_CSRF_COOKIE_NAME,
  FINANCE_SESSION_COOKIE_NAME,
} from '@backend/auth/finance-session'
import { routeFinanciere, routeFinancierePublique } from '@backend/http/route-financiere'
import { ok } from '@backend/http/route-handler'
import { connexionFinanciere, deconnexionFinanciere } from '@backend/services/finances.service'
import { connexionSchema } from '@backend/validation/schemas'
import { lireCorpsJson, valider } from '@backend/validation/validate'

/**
 * POST /api/finances/auth — connexion au site financier prive.
 *
 * Route PUBLIQUE : c'est la porte d'entree. Validation stricte, limitation de
 * debit et verrouillage de compte côté service. Les cookies poses sont ceux de
 * la session DEDIEE au site financier — ils ne donnent AUCUN acces a
 * l'application clinique.
 */
export const POST = routeFinancierePublique(async (request: NextRequest): Promise<NextResponse> => {
  const corps = await lireCorpsJson(request)
  const donnees = valider(connexionSchema, corps)

  const resultat = await connexionFinanciere(donnees.email, donnees.password, {
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip')?.trim() ??
      null,
    userAgent: request.headers.get('user-agent'),
  })

  const reponse = ok({
    utilisateur: { nomAffichage: resultat.utilisateur.displayName, email: resultat.utilisateur.email },
  })

  reponse.cookies.set(FINANCE_SESSION_COOKIE_NAME, resultat.jeton, optionsCookieSessionFinanciere())
  reponse.cookies.set(FINANCE_CSRF_COOKIE_NAME, resultat.csrfToken, optionsCookieCsrfFinancier())

  return reponse
})

/**
 * DELETE /api/finances/auth — deconnexion : revoque la session financiere.
 */
export const DELETE = routeFinanciere(async (_request, contexte): Promise<NextResponse> => {
  await deconnexionFinanciere(contexte.sessionId, {
    userId: contexte.utilisateur.id,
    userEmail: contexte.utilisateur.email,
    ipAddress: contexte.ipAddress,
    userAgent: contexte.userAgent,
  })

  const reponse = ok({ deconnecte: true })
  reponse.cookies.delete(FINANCE_SESSION_COOKIE_NAME)
  reponse.cookies.delete(FINANCE_CSRF_COOKIE_NAME)
  return reponse
})
