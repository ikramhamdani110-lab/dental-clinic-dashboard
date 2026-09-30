import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '@backend/database/prisma'
import { PASSWORD_RESET_TTL_MINUTES } from '@backend/domain/constants'
import { erreurs } from '@backend/errors/app-error'
import { logger } from '@backend/logging/logger'
import { hashPassword, needsRehash, verifyPassword } from '@backend/auth/password'
import {
  checkLoginAllowed,
  recordLoginAttempt,
  registerFailedLogin,
  registerSuccessfulLogin,
} from '@backend/auth/login-throttle'
import {
  createSession,
  hashToken,
  revokeAllUserSessions,
  revokeSession,
} from '@backend/auth/session'
import { ACTIONS, journaliser } from '@backend/services/activity-log.service'

/**
 * =============================================================================
 *  SERVICE D'AUTHENTIFICATION (§6)
 * =============================================================================
 *
 *  REGLE IMPORTANTE : le message d'echec est TOUJOURS generique et identique,
 *  que l'email existe ou non, que le mot de passe soit faux ou le compte
 *  verrouille. Un message differencie revelerait quels comptes existent.
 */

export interface ContexteRequete {
  ipAddress: string | null
  userAgent: string | null
}

export interface ResultatConnexion {
  user: {
    id: string
    email: string
    displayName: string
    role: string
  }
  token: string
  csrfToken: string
}

const MESSAGE_ECHEC_GENERIQUE =
  'Identifiants incorrects. Verifiez votre email et votre mot de passe.'

/**
 * Authentifie le medecin.
 * Le message renvoye est le meme dans tous les cas d'echec (§6).
 */
export async function login(
  email: string,
  password: string,
  contexte: ContexteRequete,
): Promise<ResultatConnexion> {
  const ip = contexte.ipAddress ?? 'inconnue'

  // 1. Defenses anti-force brute AVANT toute verification de mot de passe.
  const throttle = await checkLoginAllowed(email, ip)
  if (!throttle.autorise) {
    await recordLoginAttempt({
      email,
      ipAddress: ip,
      successful: false,
      failureReason: throttle.raison === 'IP_LIMIT' ? 'IP_LIMIT' : 'COMPTE_VERROUILLE',
    })
    // Journalise l'evenement sans reveler l'existence du compte a l'appelant.
    await journaliser(
      {
        userId: null,
        userEmail: email,
        ipAddress: contexte.ipAddress,
        userAgent: contexte.userAgent,
      },
      ACTIONS.CONNEXION_ECHOUEE,
      { metadata: { raison: throttle.raison } },
    )
    if (throttle.raison === 'IP_LIMIT') throw erreurs.tropDeRequetes()
    throw erreurs.compteVerrouille(15)
  }

  // 2. Recherche de l'utilisateur. La comparaison d'email est insensible a la
  //    casse (contrainte d'unicite `lower(email)` en production).
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  })

  // 3. Verification du mot de passe.
  //    Si l'utilisateur n'existe pas, on execute malgre tout un hachage factice
  //    afin que le temps de reponse reste comparable : une difference duree
  //    revelerait l'existence du compte (attaque par canal temporel).
  const hashADummy =
    '$argon2id$v=19$m=19456,t=2,p=1$c2FoZWQtc2VudGluZWwtZHVtbXk$3N0qBq0AV2q6ZBjKQyq1lF8xW2m1XqkV5yZ4wG7bH8c'
  const motDePasseValide = await verifyPassword(user?.passwordHash ?? hashADummy, password)

  if (!user || !user.isActive || !motDePasseValide) {
    const { lockedUntil } = await registerFailedLogin(user?.id ?? null)
    await recordLoginAttempt({
      email,
      ipAddress: ip,
      successful: false,
      failureReason: !user
        ? 'UTILISATEUR_INCONNU'
        : !motDePasseValide
          ? 'MOT_DE_PASSE_INVALIDE'
          : 'COMPTE_INACTIF',
    })
    await journaliser(
      {
        userId: user?.id ?? null,
        userEmail: email,
        ipAddress: contexte.ipAddress,
        userAgent: contexte.userAgent,
      },
      ACTIONS.CONNEXION_ECHOUEE,
      { metadata: { raison: 'IDENTIFIANTS' } },
    )

    if (lockedUntil) {
      // Le compte vient d'atteindre le seuil : message de verrouillage.
      throw erreurs.compteVerrouille(15)
    }
    throw erreurs.validation(MESSAGE_ECHEC_GENERIQUE)
  }

  // 4. Connexion valide. Rehachage si les parametres Argon2 ont evolue.
  if (needsRehash(user.passwordHash)) {
    void (async () => {
      try {
        const nouveau = await hashPassword(password)
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: nouveau } })
      } catch (error) {
        logger.warn('Rehachage du mot de passe impossible', { error })
      }
    })()
  }

  await registerSuccessfulLogin(user.id)
  await recordLoginAttempt({ email, ipAddress: ip, successful: true })

  const { token, csrfToken } = await createSession(user.id, {
    ipAddress: contexte.ipAddress,
    userAgent: contexte.userAgent,
  })

  await journaliser(
    {
      userId: user.id,
      userEmail: user.email,
      ipAddress: contexte.ipAddress,
      userAgent: contexte.userAgent,
    },
    ACTIONS.CONNEXION,
  )

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    token,
    csrfToken,
  }
}

/** Deconnecte : revoque la session courante cote serveur puis journalise. */
export async function logout(
  sessionId: string,
  contexte: {
    userId: string
    userEmail: string
    ipAddress: string | null
    userAgent: string | null
  },
): Promise<void> {
  await revokeSession(sessionId, 'Deconnexion volontaire.')
  await journaliser(
    {
      userId: contexte.userId,
      userEmail: contexte.userEmail,
      ipAddress: contexte.ipAddress,
      userAgent: contexte.userAgent,
    },
    ACTIONS.DECONNEXION,
  )
}

// -----------------------------------------------------------------------------
//  REINITIALISATION DU MOT DE PASSE (§6)
// -----------------------------------------------------------------------------
//
//  Le jeton est a duree courte, a usage unique, et n'est jamais stocke en clair.
//  En V1, le medecin est le seul utilisateur : la « voie verifiee » est le canal
//  d'administration (script serveur). L'API ne renvoie donc JAMAIS le jeton dans
//  une reponse publique : elle ne fait qu'enregistrer la demande.

/**
 * Cree un jeton de reinitialisation et renvoie sa valeur en clair UNE SEULE
 * FOIS. L'appelant (script serveur) est responsable de le transmettre au
 * medecin par un canal verifie.
 */
export async function creerJetonReinitialisation(
  email: string,
): Promise<{ jeton: string; expireLe: Date } | null> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  })
  if (!user) return null

  const jeton = randomBytes(32).toString('base64url')
  const expireLe = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000)

  // Un seul jeton actif a la fois : les precedents sont invalidés.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(jeton), expiresAt: expireLe },
  })

  return { jeton, expireLe }
}

/** Consomme un jeton de reinitialisation et change le mot de passe. */
export async function reinitialiserMotDePasse(
  jeton: string,
  nouveauMotDePasse: string,
  contexte: ContexteRequete,
): Promise<void> {
  const tokenHash = hashToken(jeton)
  const enregistrement = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  const invalide =
    !enregistrement ||
    enregistrement.usedAt !== null ||
    enregistrement.expiresAt.getTime() <= Date.now()

  if (invalide) {
    throw erreurs.validation(
      'Ce lien de reinitialisation est invalide ou a expire. Demandez-en un nouveau.',
    )
  }

  const nouveauHash = await hashPassword(nouveauMotDePasse)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: enregistrement.userId },
      data: { passwordHash: nouveauHash, passwordChangedAt: new Date() },
    }),
    prisma.passwordResetToken.update({
      where: { id: enregistrement.id },
      data: { usedAt: new Date() },
    }),
  ])

  // Un changement de mot de passe revoque TOUTES les sessions existantes :
  // si le compte etait compromis, l'attaquant perd immediatement l'acces.
  await revokeAllUserSessions(enregistrement.userId, 'Mot de passe reinitialise.')

  await journaliser(
    {
      userId: enregistrement.userId,
      userEmail: enregistrement.user.email,
      ipAddress: contexte.ipAddress,
      userAgent: contexte.userAgent,
    },
    ACTIONS.MOT_DE_PASSE_REINITIALISE,
  )
}

/** Change le mot de passe de l'utilisateur connecte (verification de l'ancien). */
export async function changerMotDePasse(
  userId: string,
  ancienMotDePasse: string,
  nouveauMotDePasse: string,
  contexte: ContexteRequete & { userEmail: string },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw erreurs.introuvable('Utilisateur')

  const valide = await verifyPassword(user.passwordHash, ancienMotDePasse)
  if (!valide) {
    throw erreurs.validation('Le mot de passe actuel est incorrect.', [
      { champ: 'ancienMotDePasse', message: 'Mot de passe actuel incorrect.' },
    ])
  }

  const nouveauHash = await hashPassword(nouveauMotDePasse)
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: nouveauHash, passwordChangedAt: new Date() },
  })

  await journaliser(
    {
      userId,
      userEmail: contexte.userEmail,
      ipAddress: contexte.ipAddress,
      userAgent: contexte.userAgent,
    },
    ACTIONS.MOT_DE_PASSE_MODIFIE,
  )
}

/** Empreinte utilisee uniquement dans les journaux de diagnostic avance. */
export function empreinteDiagnostic(valeur: string): string {
  return createHash('sha256').update(valeur).digest('hex').slice(0, 12)
}
