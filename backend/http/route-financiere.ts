import { type NextRequest, NextResponse } from 'next/server'

import {
  FINANCE_CSRF_HEADER_NAME,
  FINANCE_SESSION_COOKIE_NAME,
  resoudreSessionFinanciere,
  verifierCsrfFinancier,
} from '@backend/auth/finance-session'
import { erreurs } from '@backend/errors/app-error'
import { responseErreur } from '@backend/http/route-handler'
import { logger } from '@backend/logging/logger'
import type { JournalContext } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  ENVELOPPE DES ROUTES API FINANCIERES (§finances, §securite)
 * =============================================================================
 *
 *  Toute route financiere passe par `routeFinanciere`. Cette enveloppe :
 *
 *    1. resout la session DEDIEE (cookie `sahed_finance_session` HttpOnly) ;
 *    2. verifie que le compte est bien le MEDECIN actif — la session clinique
 *       (secretaire ou medecin sur le poste de bureau) ne donne JAMAIS acces ;
 *    3. verifie le jeton CSRF financier sur toute requete mutante ;
 *    4. capture les erreurs et renvoie un message francais, sans jamais exposer
 *       SQL, pile d'appel, chemin interne ni secret.
 *
 *  REGLE CRITIQUE (§securite) : le refus est par DEFAUT. Aucune route
 *  financiere ne doit jamais etre ecrite directement — elle serait accessible
 *  sans authentification dediee.
 */

export interface ContexteFinancier {
  utilisateur: { id: string; email: string; displayName: string }
  sessionId: string
  ipAddress: string | null
  userAgent: string | null
  journal: JournalContext
}

const METHODES_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function routeFinanciere(
  handler: (request: NextRequest, contexte: ContexteFinancier) => Promise<NextResponse> | NextResponse,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const jeton = request.cookies.get(FINANCE_SESSION_COOKIE_NAME)?.value
      const session = await resoudreSessionFinanciere(jeton)

      // DENY BY DEFAULT : sans session financiere valide, aucun acces — meme
      // si une session clinique valide existe par ailleurs.
      if (!session) throw erreurs.nonAuthentifie()

      const csrfRequis = METHODES_MUTANTES.has(request.method)
      if (
        csrfRequis &&
        !verifierCsrfFinancier(
          session.session,
          request.headers.get(FINANCE_CSRF_HEADER_NAME) ?? undefined,
        )
      ) {
        logger.warn('Jeton CSRF financier absent ou invalide', {
          path: request.nextUrl.pathname,
        })
        throw erreurs.accesRefuse()
      }

      const ipAddress =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request.headers.get('x-real-ip')?.trim() ??
        null
      const userAgent = request.headers.get('user-agent')

      return await handler(request, {
        utilisateur: session.utilisateur,
        sessionId: session.session.id,
        ipAddress,
        userAgent,
        journal: {
          userId: session.utilisateur.id,
          userEmail: session.utilisateur.email,
          ipAddress,
          userAgent,
        },
      })
    } catch (error) {
      return responseErreur(error)
    }
  }
}

/**
 * Enveloppe une route financiere a segment dynamique (`/api/finances/x/[id]`).
 *
 * Next.js fournit `(request, { params })` pour ces routes. Ce pont resout
 * l'identifiant AVANT d'executer le controleur, en conservant toutes les
 * garanties de `routeFinanciere`.
 */
export function routeFinanciereAvecId(
  controleur: (
    request: NextRequest,
    id: string,
    contexte: ContexteFinancier,
  ) => Promise<NextResponse> | NextResponse,
): (request: NextRequest, route: { params: Promise<{ id: string }> }) => Promise<NextResponse> {
  return (request, route) =>
    routeFinanciere(async (requete, contexte) => {
      const { id } = await route.params
      return controleur(requete, id, contexte)
    })(request)
}

/** Route publique financiere (connexion) : meme gestion d'erreurs sure. */
export function routeFinancierePublique(
  handler: (request: NextRequest) => Promise<NextResponse> | NextResponse,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      return await handler(request)
    } catch (error) {
      return responseErreur(error)
    }
  }
}
