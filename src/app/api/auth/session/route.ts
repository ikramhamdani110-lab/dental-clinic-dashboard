import { type NextRequest, NextResponse } from 'next/server'

import { ok, responseErreur, routePrivee } from '@backend/http/route-handler'

/**
 * GET /api/auth/session
 *
 * Retourne l'utilisateur courant. Le simple fait que cette route reponde 200
 * prouve que la session est valide : `routePrivee` resout la session
 * cote serveur (cookie HttpOnly), verifie son expiration, sa revocation et le
 * role actif. Un appel non authentifie recoit une erreur 401 JSON.
 */
export const GET = routePrivee(async (_request: NextRequest, contexte): Promise<NextResponse> => {
  try {
    return ok({
      utilisateur: {
        nomAffichage: contexte.user.displayName,
        email: contexte.user.email,
        role: contexte.user.role,
      },
      session: {
        expireLe: contexte.session.expiresAt.toISOString(),
        derniereActivite: contexte.session.lastSeenAt.toISOString(),
      },
    })
  } catch (error) {
    return responseErreur(error)
  }
})
