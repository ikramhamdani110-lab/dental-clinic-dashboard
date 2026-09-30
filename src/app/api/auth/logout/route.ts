import { type NextRequest, NextResponse } from 'next/server'

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '@backend/auth/session'
import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'
import { logout } from '@backend/services/auth.service'

/**
 * POST /api/auth/logout
 *
 * Route PRIVEE : la session est revoquee COTE SERVEUR (le jeton ne peut plus
 * etre reutilise, meme s'il a fuite). Les cookies sont ensuite effaces.
 *
 * Le jeton CSRF est exige : une requete de deconnexion forgee par un site tiers
 * ne doit pas pouvoir deconnecter le medecin (CSRF de deconnexion).
 */
export const POST = routePrivee(
  async (_request: NextRequest, contexte): Promise<NextResponse> => {
    try {
      await logout(contexte.session.id, {
        userId: contexte.user.id,
        userEmail: contexte.user.email,
        ipAddress: contexte.ipAddress,
        userAgent: contexte.userAgent,
      })

      const reponse = ok({ deconnecte: true })
      reponse.cookies.delete(SESSION_COOKIE_NAME)
      reponse.cookies.delete(CSRF_COOKIE_NAME)
      return reponse
    } catch (error) {
      return responseErreur(error)
    }
  },
  { csrf: true },
)
