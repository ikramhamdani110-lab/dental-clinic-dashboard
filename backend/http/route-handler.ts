import { NextResponse, type NextRequest } from 'next/server'

import { Prisma } from '@prisma/client'

import { type AuthenticatedUser, requireActiveRole } from '@backend/auth/authorization'
import {
  CSRF_HEADER_NAME,
  type SessionWithUser,
  resolveSession,
  SESSION_COOKIE_NAME,
  verifyCsrf,
} from '@backend/auth/session'
import { AppError, erreurs, isAppError } from '@backend/errors/app-error'
import { logger } from '@backend/logging/logger'

/**
 * =============================================================================
 *  ENVELOPPE DES ROUTES API (§32, §33, §36, §39)
 * =============================================================================
 *
 *  Chaque route privee est construite par `routePrivee`. Cette enveloppe :
 *    1. resout la session SERVEUR (cookie HttpOnly) ;
 *    2. verifie que le role est actif — masquer une page ne protege rien, l'API
 *       doit refuser un appel direct (§39) ;
 *    3. verifie le jeton CSRF sur toute requete mutante (POST/PUT/PATCH/DELETE) ;
 *    4. capture toutes les erreurs et renvoie un message FRANCAIS sur, sans
 *       jamais exposer SQL, pile d'appel, chemin interne ni secret.
 *
 *  Aucune route privee ne doit etre ecrite directement : elles seraient alors
 *  accessibles sans authentification.
 */

export interface RouteContext {
  /** Utilisateur authentifie et autorise. */
  user: AuthenticatedUser
  /** Session complete (acces a l'id, pour la revocation, l'audit...). */
  session: SessionWithUser['session']
  /** Adresse IP de la requete (pour le journal d'audit). */
  ipAddress: string | null
  /** En-tete User-Agent de la requete. */
  userAgent: string | null
  /**
   * Contexte prealable a passer au journal et aux services.
   * Evite de reconstruire l'objet d'audit dans chaque route.
   */
  journal: JournalContext
}

/** Contexte d'audit tel qu'attendu par `journaliser` et les services. */
export interface JournalContext {
  userId: string | null
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface RouteOptions {
  /** Exige un jeton CSRF valide. `true` par defaut sur les methodes mutantes. */
  csrf?: boolean
}

/** Extrait l'adresse IP reelle, y compris derriere un proxy de confiance. */
export function extraireIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return null
}

const METHODES_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Convertit une erreur inconnue en reponse sure et journalise les details. */
export function responseErreur(error: unknown): NextResponse {
  if (isAppError(error)) {
    // Erreur maitrisee : message francais destine a l'utilisateur.
    // Le niveau de journalisation depend de la gravite.
    if (error.httpStatus >= 500) {
      logger.error('Erreur applicative', { code: error.code, internals: error.internals })
    } else if (error.httpStatus >= 400 && error.httpStatus !== 401 && error.httpStatus !== 403) {
      logger.warn('Requete refusee', { code: error.code, message: error.publicMessage })
    }
    return NextResponse.json(error.toPublicJSON(), { status: error.httpStatus })
  }

  // Erreur Prisma : on distingue les cas attendus (contrainte violée) des
  // erreurs inattendues, mais le client recoit TOUJOURS un message generique.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      logger.warn('Violation de contrainte unique', { code: error.code, meta: error.meta })
      return NextResponse.json(
        new AppError('CONFLIT', 'Cet enregistrement existe deja.').toPublicJSON(),
        { status: 409 },
      )
    }
    if (error.code === 'P2003' || error.code === 'P2014') {
      logger.warn('Violation de contrainte de reference', { code: error.code, meta: error.meta })
      return NextResponse.json(
        new AppError(
          'CONFLIT',
          "Cet element est lie a d'autres donnees et ne peut pas etre traite ainsi.",
        ).toPublicJSON(),
        { status: 409 },
      )
    }
    if (error.code === 'P2025') {
      return NextResponse.json(erreurs.introuvable().toPublicJSON(), { status: 404 })
    }
  }

  // Base momentanement indisponible : message professionnel, pas de details.
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    logger.error('Base de donnees indisponible', { error })
    return NextResponse.json(erreurs.serviceIndisponible().toPublicJSON(), { status: 503 })
  }

  // Erreur totalement inattendue : journalisee en detail cote serveur, message
  // generique cote client. Aucune fuite technique (§36).
  logger.error('Erreur serveur inattendue', { error })
  return NextResponse.json(erreurs.interne().toPublicJSON(), { status: 500 })
}

/**
 * Enveloppe une route PRIVEE : authentification, autorisation, CSRF et gestion
 * d'erreurs centralisee.
 */
export function routePrivee(
  handler: (request: NextRequest, context: RouteContext) => Promise<NextResponse> | NextResponse,
  options: RouteOptions = {},
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
      const session = await resolveSession(token)

      if (!session) throw erreurs.nonAuthentifie()

      const authUser: AuthenticatedUser = {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        role: session.user.role,
      }
      requireActiveRole(authUser)

      const csrfRequis = options.csrf ?? METHODES_MUTANTES.has(request.method)
      if (
        csrfRequis &&
        !verifyCsrf(session.session, request.headers.get(CSRF_HEADER_NAME) ?? undefined)
      ) {
        logger.warn('Jeton CSRF absent ou invalide', { path: request.nextUrl.pathname })
        throw new AppError(
          'ACCES_REFUSE',
          'Requete refusee : jeton de securite invalide. Rechargez la page et reessayez.',
        )
      }

      const ipAddress = extraireIp(request)
      const userAgent = request.headers.get('user-agent')

      return await handler(request, {
        user: authUser,
        session: session.session,
        ipAddress,
        userAgent,
        journal: {
          userId: authUser.id,
          userEmail: authUser.email,
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
 * Enveloppe une route PUBLIQUE (connexion, sante). Pas d'authentification,
 * mais la meme gestion d'erreurs sure.
 */
export function routePublique(
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

/**
 * Enveloppe une route PRIVEE a segment dynamique (`/api/ressource/[id]`).
 *
 * Next.js fournit `(request, { params })` pour ces routes, alors que
 * `routePrivee` produit `(request) => NextResponse`. Ce pont resout l'identifiant
 * AVANT d'executer le controleur, en conservant toutes les garanties de
 * `routePrivee` : authentification, autorisation, CSRF et gestion d'erreurs.
 *
 * Centraliser ce pont evite de le redupliquer dans chaque route dynamique.
 */
export function routePriveeAvecId(
  controleur: (
    request: NextRequest,
    id: string,
    contexte: RouteContext,
  ) => Promise<NextResponse> | NextResponse,
  options: RouteOptions = {},
): (request: NextRequest, route: { params: Promise<{ id: string }> }) => Promise<NextResponse> {
  return (request, route) =>
    routePrivee(async (requete, contexte) => {
      const { id } = await route.params
      return controleur(requete, id, contexte)
    }, options)(request)
}

/** Reponse JSON de succes. */
export function ok<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200 })
}
