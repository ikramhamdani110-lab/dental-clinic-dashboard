import type { UserRole } from '@prisma/client'

import { erreurs } from '@backend/errors/app-error'

/**
 * =============================================================================
 *  AUTORISATION (§2, §39)
 * =============================================================================
 *
 *  V1 n'expose QUE le role MEDECIN : le medecin est la seule personne a acceder
 *  au tableau de bord prive (§2). Aucun compte de receptionniste, aucun compte
 *  patient, aucun portail patient.
 *
 *  Le role ASSISTANT et ADMINISTRATEUR existent dans l'enumeration de la base
 *  pour qu'une evolution future n'oblige PAS a reconstruire la couche
 *  d'autorisation. Ils ne sont PAS attribuables en V1 : `UTILISATEURS_ACTIFS`
 *  ne contient que MEDECIN. Activer un role revient a l'ajouter a cette liste.
 *
 *  REGLE IMPERATIVE : chaque route privee verifie l'authentification cote
 *  serveur. Masquer une page dans l'interface ne protege rien — l'API doit
 *  refuser un appel direct non authentifie (§39).
 */

/**
 * Roles reellement autorises a utiliser l'application.
 * V1 : le medecin uniquement.
 */
export const UTILISATEURS_ACTIFS: readonly UserRole[] = ['MEDECIN'] as const

/** Verifie qu'un role est active. */
export function estRoleActif(role: UserRole): boolean {
  return UTILISATEURS_ACTIFS.includes(role)
}

export interface AuthenticatedUser {
  id: string
  email: string
  displayName: string
  role: UserRole
}

/**
 * Verifie que l'utilisateur porte un role active. Leve `ACCES_REFUSE` sinon.
 * Toute action sensible passe par ce controle — jamais par une verification
 * faite uniquement dans le navigateur.
 */
export function requireActiveRole(user: AuthenticatedUser): void {
  if (!estRoleActif(user.role)) {
    throw erreurs.accesRefuse()
  }
}

/**
 * Point d'extension pour une autorisation plus fine (par ressource).
 * En V1, disposer du role actif suffit : le medecin accede a toutes ses
 * donnees. La fonction existe pour que les appels dans les services restent
 * stables lorsqu'une regle plus riche sera introduite.
 */
export function canAccessPatient(user: AuthenticatedUser, _patientId: string): boolean {
  // V1 : un seul cabinet, un seul medecin, tous les patients lui appartiennent.
  return estRoleActif(user.role)
}
