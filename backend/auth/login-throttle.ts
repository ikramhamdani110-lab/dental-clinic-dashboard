import { prisma } from '@backend/database/prisma'
import {
  ACCOUNT_LOCK_MINUTES,
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MINUTES,
  MAX_FAILED_LOGINS,
} from '@backend/domain/constants'

/**
 * =============================================================================
 *  PROTECTION ANTI-FORCE BRUTE (§6, §38)
 * =============================================================================
 *
 *  Deux defenses complementaires :
 *
 *   1. Rate limiting par adresse IP : borne le nombre total de tentatives sur
 *      une fenetre glissante, ce qui empeche le balayage de mots de passe meme
 *      sur des comptes inexistants.
 *
 *   2. Verrouillage de compte : apres plusieurs echecs consecutifs, le compte
 *      est temporairement verrouille. Le compteur est remis a zero des la
 *      connexion reussie.
 *
 *  Le compteur d'echecs vit dans la table `users` (champs `failedLoginCount` et
 *  `lockedUntil`) : il est donc partage par tous les processus et resistant a un
 *  redemarrage — contrairement a un compteur en memoire.
 *
 *  Chaque tentative est journalisee dans `login_attempts` pour l'audit.
 */

export interface ThrottleResult {
  autorise: boolean
  raison?: 'IP_LIMIT' | 'COMPTE_VERROUILLE'
  verrouilleJusqua?: Date
}

/**
 * Nombre de tentatives ECHOUEES recentes depuis une adresse IP.
 *
 * POURQUOI SEULEMENT LES ECHECS
 *
 *  Le rate limiting existe pour empecher le balayage de mots de passe (essayer
 *  beaucoup de mots de passe sur un ou plusieurs comptes). Une connexion
 *  REUSSIE n'est pas une attaque : la compter revenait a verrouiller l'acces
 *  d'un medecin qui se connecte normalement plusieurs fois dans la meme heure
 *  (changement de poste, session expiree apres inactivite, deconnexion par
 *  precaution). La fenetre de 10 minutes etait atteinte a la 10e connexion
 *  LEGITIME, et le medecin se voyait alors refuser sa connexion avec ses vrais
 *  identifiants.
 *
 *  Seuls les echecs comptent donc : un utilisateur legitime n'est jamais
 *  bloque par sa propre activite normale, tandis qu'une attaque par balayage
 *  (qui ne produit que des echecs) est toujours arretee au meme seuil.
 */
async function tentativeCountByIp(ipAddress: string): Promise<number> {
  const seuil = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  return prisma.loginAttempt.count({
    where: { ipAddress, successful: false, createdAt: { gte: seuil } },
  })
}

/**
 * Verifie les deux defenses AVANT de verifier le mot de passe.
 * Ne leve pas : renvoie un etat que l'appelant traduit en reponse generique.
 */
export async function checkLoginAllowed(email: string, ipAddress: string): Promise<ThrottleResult> {
  const ipCount = await tentativeCountByIp(ipAddress)
  if (ipCount >= LOGIN_RATE_LIMIT_MAX) {
    return { autorise: false, raison: 'IP_LIMIT' }
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { lockedUntil: true },
  })

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { autorise: false, raison: 'COMPTE_VERROUILLE', verrouilleJusqua: user.lockedUntil }
  }

  return { autorise: true }
}

/** Enregistre une tentative (succes ou echec) pour l'audit et le rate limiting. */
export async function recordLoginAttempt(params: {
  email: string
  ipAddress: string
  successful: boolean
  failureReason?: string
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: params.email,
      ipAddress: params.ipAddress,
      successful: params.successful,
      failureReason: params.failureReason ?? null,
    },
  })
}

/**
 * Enregistre un echec d'authentification et verrouille le compte si le seuil
 * est atteint. Renvoie l'etat de verrouillage eventuel.
 */
export async function registerFailedLogin(
  userId: string | null,
  minutesDeVerrouillage = ACCOUNT_LOCK_MINUTES,
): Promise<{ lockedUntil: Date | null }> {
  if (!userId) return { lockedUntil: null }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true },
  })
  if (!user) return { lockedUntil: null }

  const nouveauCompteur = user.failedLoginCount + 1

  const lockedUntil =
    nouveauCompteur >= MAX_FAILED_LOGINS
      ? new Date(Date.now() + minutesDeVerrouillage * 60 * 1000)
      : null

  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: nouveauCompteur,
      ...(lockedUntil ? { lockedUntil } : {}),
    },
  })

  return { lockedUntil }
}

/** Remet le compteur a zero apres une connexion reussie. */
export async function registerSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  })
}
