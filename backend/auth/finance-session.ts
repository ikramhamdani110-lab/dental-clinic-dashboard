import { createHash } from 'node:crypto'

import { prisma } from '@backend/database/prisma'

/**
 * =============================================================================
 *  SESSION DEDIEE AU SITE FINANCIER PRIVE (§medecin-finances)
 * =============================================================================
 *
 *  POURQUOI UNE SESSION SEPAREE DE CELLE DU TABLEAU DE BORD
 *
 *   La securite exige que le site financier du medecin ne puisse JAMAIS etre
 *   ouvert par la session de l'application de bureau (celle de la secretaire,
 *   celle du medecin sur le poste clinique). On utilise donc un SECOND cookie,
 *   distinct, porte par une table de sessions propre (`finance_sessions`).
 *
 *   Consequence directe :
 *
 *     - Une session valide de l'application clinique ne donne AUCUN acces aux
 *       pages ni aux API de /finances ;
 *     - Inversement, une session financiere ne donne aucun acces a l'API
 *       clinique — les deux mondes ne partagent AUCUN cookie.
 *
 *   Le cookie financier est `HttpOnly`, `SameSite=Lax`, `Secure` en production :
 *   il ne peut pas etre lu par JavaScript, et il ne transmet jamais a un site
 *   tiers.
 *
 *  REVOCATION
 *
 *   Chaque session est revoquee individuellement (deconnexion) ou toutes a la
 *   fois (changement de mot de passe). La reponse reste revoquee immediatement :
 *   un jeton vole ne sert a rien apres revocation.
 */

/** Nom du cookie de session financiere. Distinct du cookie clinique. */
export const FINANCE_SESSION_COOKIE_NAME = 'sahed_finance_session'
/** Nom du cookie CSRF associe a la session financiere. */
export const FINANCE_CSRF_COOKIE_NAME = 'sahed_finance_csrf'
/** Nom de l'en-tete CSRF attendu sur les requetes mutantes financieres. */
export const FINANCE_CSRF_HEADER_NAME = 'x-finance-csrf-token'

/** Duree de vie d'une session financiere, en heures (courte : poste personnel). */
export const FINANCE_SESSION_TTL_HOURS = 12

/** Duree d'inactivite avant revocation automatique, en minutes. */
export const FINANCE_SESSION_IDLE_MINUTES = 60

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Genere un jeton aleatoire URL-safe (32 octets d'entropie).
 * Volontairement local a ce module pour rester independant de la session
 * clinique.
 */
function genererJeton(): string {
  const octets = new Uint8Array(32)
  crypto.getRandomValues(octets)
  return Buffer.from(octets).toString('base64url')
}

/** Compare deux chaines en temps constant (anti-attaque temporelle). */
function comparaisonSure(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return difference === 0
}

export interface SessionFinanciere {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
  revokedReason: string | null
  csrfTokenHash: string
  ipAddress: string | null
  userAgent: string | null
}

export interface UtilisateurFinancier {
  id: string
  email: string
  displayName: string
  role: string
}

/**
 * Cree une session financiere pour l'utilisateur donne.
 * Renvoie les jetons en clair UNE SEULE FOIS (a poser en cookies) ; la base ne
 * conserve que leurs empreintes SHA-256.
 */
export async function creerSessionFinanciere(
  userId: string,
  contexte: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ session: SessionFinanciere; jeton: string; csrfToken: string }> {
  const jeton = genererJeton()
  const csrfToken = genererJeton()
  const maintenant = new Date()
  const expiresAt = new Date(maintenant.getTime() + FINANCE_SESSION_TTL_HOURS * 60 * 60 * 1000)

  const session = await prisma.financeSession.create({
    data: {
      userId,
      tokenHash: hashToken(jeton),
      csrfTokenHash: hashToken(csrfToken),
      ipAddress: contexte.ipAddress ?? null,
      userAgent: contexte.userAgent ?? null,
      expiresAt,
    },
  })

  return { session, jeton, csrfToken }
}

/**
 * Resout une session financiere a partir du jeton du cookie.
 * Renvoie `null` si la session est absente, revoquee, expiree, inactive trop
 * longtemps, ou si l'utilisateur n'est pas autorise (seul le compte MEDECIN
 * actif a acces — deny by default).
 */
export async function resoudreSessionFinanciere(
  jeton: string | undefined,
): Promise<{ session: SessionFinanciere; utilisateur: UtilisateurFinancier } | null> {
  if (!jeton) return null

  const tokenHash = hashToken(jeton)
  const session = await prisma.financeSession.findUnique({
    where: { tokenHash },
  })

  if (!session) return null
  if (session.revokedAt !== null) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  // Inactivite : une session ouverte puis oubliee est revoquee.
  const limiteInactivite = FINANCE_SESSION_IDLE_MINUTES * 60 * 1000
  if (Date.now() - session.lastSeenAt.getTime() > limiteInactivite) {
    await revokeSessionFinanciere(session.id, 'Expiration après inactivité.')
    return null
  }

  // L'utilisateur doit exister, etre actif, et porter le role MEDECIN.
  const utilisateur = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, displayName: true, role: true, isActive: true },
  })
  if (!utilisateur || !utilisateur.isActive) return null
  if (utilisateur.role !== 'MEDECIN') return null

  // Prolonge l'activite, au mieux : un echec d'ecriture ne fait pas echouer.
  void prisma.financeSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined)

  return {
    session,
    utilisateur: {
      id: utilisateur.id,
      email: utilisateur.email,
      displayName: utilisateur.displayName,
      role: utilisateur.role,
    },
  }
}

/** Verifie le jeton CSRF contre l'empreinte de la session financiere. */
export function verifierCsrfFinancier(session: SessionFinanciere, csrfToken: string | undefined): boolean {
  if (!csrfToken) return false
  return comparaisonSure(hashToken(csrfToken), session.csrfTokenHash)
}

/** Revoque une session financiere. Idempotent. */
export async function revokeSessionFinanciere(sessionId: string, raison: string): Promise<void> {
  await prisma.financeSession
    .updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: raison },
    })
    .catch(() => undefined)
}

/** Revoque TOUTES les sessions financieres d'un utilisateur. */
export async function revokeToutesSessionsFinancieres(
  userId: string,
  raison: string,
): Promise<void> {
  await prisma.financeSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: raison },
  })
}

/** Purge les sessions financieres expirees ou revoquees anciennes. */
export async function purgerSessionsFinancieresAnciennes(
  ancienneteJours = 30,
): Promise<number> {
  const coupure = new Date(Date.now() - ancienneteJours * 24 * 60 * 60 * 1000)
  const { count } = await prisma.financeSession.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: coupure } }],
    },
  })
  return count
}

/** Options du cookie de session financiere. */
export function optionsCookieSessionFinanciere(): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
} {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: FINANCE_SESSION_TTL_HOURS * 60 * 60,
  }
}

/** Options du cookie CSRF financier (lisible par le JS de l'app financiere). */
export function optionsCookieCsrfFinancier(): {
  httpOnly: false
  secure: boolean
  sameSite: 'lax'
  path: string
  maxAge: number
} {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: FINANCE_SESSION_TTL_HOURS * 60 * 60,
  }
}
