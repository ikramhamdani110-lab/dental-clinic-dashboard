import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { Session, User } from '@prisma/client'

import { getEnv } from '@backend/config/env'
import { prisma } from '@backend/database/prisma'
import { SESSION_IDLE_HOURS, SESSION_TTL_DAYS } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'

/**
 * =============================================================================
 *  SESSIONS SERVEUR (§6, §38)
 * =============================================================================
 *
 *  Modele de securite :
 *    - Le cookie ne contient qu'un JETON OPAQUE aleatoire (32 octets).
 *    - La base ne stocke que l'empreinte SHA-256 de ce jeton.
 *    - Un jeton vole dans un journal de base n'est donc pas reutilisable, et un
 *      vol de base ne permet pas de reconstituer les cookies.
 *    - La session est revocable cote serveur : la deconnexion et la revocation
 *      sont immediates, contrairement a un JWT auto-porteur.
 *
 *  Un jeton CSRF est associe a chaque session (protection « double soumis »).
 */

export const SESSION_COOKIE_NAME = 'sahed_session'
export const CSRF_COOKIE_NAME = 'sahed_csrf'
export const CSRF_HEADER_NAME = 'x-csrf-token'

/** Convertit un jeton en empreinte. SHA-256 suffit : le jeton est deja aleatoire. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Genere un jeton aleatoire URL-safe. */
function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Compare deux empreintes en temps constant (evite une attaque temporelle). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface SessionWithUser {
  session: Session
  user: User
}

/** Cree une session et renvoie les jetons en clair (a poser en cookies). */
export async function createSession(
  userId: string,
  context: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ session: Session; token: string; csrfToken: string }> {
  const token = generateToken()
  const csrfToken = generateToken()

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrfToken),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      expiresAt,
    },
  })

  return { session, token, csrfToken }
}

/**
 * Resout une session a partir du jeton du cookie.
 * Renvoie `null` si la session est absente, revoquee, expiree, ou si
 * l'utilisateur est desactive.
 */
export async function resolveSession(token: string | undefined): Promise<SessionWithUser | null> {
  if (!token) return null

  const tokenHash = hashToken(token)

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  if (!session) return null
  if (session.revokedAt !== null) return null
  if (session.expiresAt.getTime() <= Date.now()) return null
  if (!session.user.isActive) return null

  // Expiration apres inactivite : une session ouverte il y a longtemps sur un
  // poste partage ne doit pas rester valide indefiniment.
  const idleLimitMs = SESSION_IDLE_HOURS * 60 * 60 * 1000
  if (Date.now() - session.lastSeenAt.getTime() > idleLimitMs) {
    await revokeSession(session.id, 'Expiration apres inactivite.')
    return null
  }

  // Prolonge l'activite. L'ecriture est volontairement « au mieux » : un echec
  // de mise a jour de `lastSeenAt` ne doit pas faire echouer la requete.
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined)

  return { session, user: session.user }
}

/** Verifie le jeton CSRF contre l'empreinte de la session. */
export function verifyCsrf(session: Session, csrfToken: string | undefined): boolean {
  if (!csrfToken) return false
  return safeEqual(hashToken(csrfToken), session.csrfTokenHash)
}

/** Revoque une session. Idempotent. */
export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch(() => undefined)
}

/** Revoque toutes les sessions d'un utilisateur (ex. changement de mot de passe). */
export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
}

/**
 * Supprime les sessions expirees ou revoquees anciennes.
 * Appele par le script d'entretien : la table ne doit pas croitre sans fin.
 */
export async function purgeExpiredSessions(olderThanDays = 60): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  })
  return count
}

/** Options du cookie de session, appliquees de facon centralisee. */
export function sessionCookieOptions(): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
  domain?: string
} {
  const env = getEnv()
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  }
}

/**
 * Cookie CSRF : lisible par le JavaScript de l'application uniquement (elle lit
 * le jeton pour le replacer dans l'en-tete `x-csrf-token`). Il n'est jamais
 * HttpOnly par necessite, mais reste inutilisable seul : la verification se fait
 * contre l'empreinte stockee cote session.
 */
export function csrfCookieOptions(): {
  httpOnly: false
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
  domain?: string
} {
  const env = getEnv()
  return {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  }
}

/** Leve une erreur d'authentification normalisee. */
export function requireSession(session: SessionWithUser | null): SessionWithUser {
  if (!session) throw erreurs.nonAuthentifie()
  return session
}
