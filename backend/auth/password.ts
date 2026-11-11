import argon2 from 'argon2'

import { getEnv } from '@backend/config/env'
import { erreurs } from '@backend/errors/app-error'

import {
  LONGUEUR_MAX_MOT_DE_PASSE,
  LONGUEUR_MIN_MOT_DE_PASSE,
  problemesMotDePasse,
} from './password-policy'

/**
 * =============================================================================
 *  HACHAGE DES MOTS DE PASSE — ARGON2ID (§6, §38)
 * =============================================================================
 *
 *  Regles appliquees :
 *    - Argon2id (variante recommandee : resistante aux attaques GPU et
 *      side-channel).
 *    - Sel aleatoire par mot de passe (fourni par la bibliotheque).
 *    - Parametres de cout explicites, jamais les valeurs par defaut implicites.
 *    - Poivre applicatif (pepper) issu de l'environnement : un attaquant ayant
 *      uniquement la base ne peut pas verifier les mots de passe hors ligne.
 *
 *  Le mot de passe en clair n'est jamais journalise, jamais stocke, jamais
 *  renvoye par l'API.
 *
 *  LA POLITIQUE ELLE-MEME vit dans `./password-policy`, partagee avec l'ecran
 *  de changement de mot de passe : le serveur et l'interface appliquent
 *  EXACTEMENT les memes regles, sans duplication.
 */

/** Parametres de cout Argon2id. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // ~19 Mo — recommandation OWASP (parametre m=19456)
  timeCost: 2,
  parallelism: 1,
} as const

/** Longueur minimale exigee pour un mot de passe. */
export { LONGUEUR_MAX_MOT_DE_PASSE, LONGUEUR_MIN_MOT_DE_PASSE }

/**
 * Applique le poivre applicatif. Le poivre est concatene au mot de passe avant
 * hachage : il n'est jamais stocke en base, uniquement dans l'environnement.
 */
function applyPepper(password: string): string {
  const pepper = getEnv().PASSWORD_PEPPER
  return pepper ? `${password}${pepper}` : password
}

/**
 * Valide la robustesse minimale d'un mot de passe.
 * Les messages sont en francais et destines a l'utilisateur.
 *
 * Delegue a `password-policy` : c'est la MEME fonction que celle utilisee par
 * l'interface, donc les deux ne peuvent pas diverger.
 */
export function validatePasswordStrength(password: string): string[] {
  return problemesMotDePasse(password)
}

/** Hache un mot de passe. Leve une erreur si la robustesse est insuffisante. */
export async function hashPassword(password: string): Promise<string> {
  const problemes = validatePasswordStrength(password)
  if (problemes.length > 0) {
    throw erreurs.validation('Mot de passe insuffisamment robuste.', [
      { champ: 'password', message: problemes.join(' ') },
    ])
  }
  return argon2.hash(applyPepper(password), ARGON2_OPTIONS)
}

/**
 * Hache sans valider la robustesse — reserve au hachage d'un mot de passe deja
 * valide en amont (changement de mot de passe, seed).
 */
export async function hashPasswordUnsafe(password: string): Promise<string> {
  return argon2.hash(applyPepper(password), ARGON2_OPTIONS)
}

/**
 * Verifie un mot de passe contre une empreinte.
 * Renvoie `false` au lieu de lever : l'appelant decide du message (toujours
 * generique cote client — §6).
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, applyPepper(password))
  } catch {
    // Empreinte corrompue ou format inconnu : echec de verification, pas crash.
    return false
  }
}

/**
 * Indique si une empreinte doit etre recalculee (parametres perimes).
 * Permet une migration transparente des parametres Argon2 sans invalider les
 * mots de passe existants.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS)
  } catch {
    return true
  }
}
