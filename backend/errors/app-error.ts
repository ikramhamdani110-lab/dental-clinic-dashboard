/**
 * =============================================================================
 *  ERREURS APPLICATIVES
 * =============================================================================
 *
 *  Principe (§33, §36) : l'utilisateur recoit un message francais clair et
 *  actionnable ; les details techniques (code SQL, pile d'appel, chemin
 *  interne) restent dans les journaux serveur et ne sont JAMAIS renvoyes.
 *
 *  `AppError` porte donc deux niveaux d'information :
 *    - publicMessage : ce que voit le medecin ;
 *    - internals     : ce qui est journalise (jamais transmis au client).
 */

export type AppErrorCode =
  | 'VALIDATION'
  | 'NON_AUTHENTIFIE'
  | 'ACCES_REFUSE'
  | 'INTROUVABLE'
  | 'CONFLIT'
  | 'RENDEZ_VOUS_EN_CONFLIT'
  | 'PAGE_INVALIDE'
  | 'TROP_DE_REQUETES'
  | 'COMPTE_VERROUILLE'
  | 'PAIEMENT_EN_DOUBLON'
  | 'MONTANT_INVALIDE'
  | 'FICHIER_INVALIDE'
  | 'FICHIER_TROP_VOLUMINEUX'
  | 'CORBEILLE_EXPIREE'
  | 'SERVICE_INDISPONIBLE'
  | 'ERREUR_INTERNE'

/** Statut HTTP associe a chaque code applicatif. */
const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 422,
  NON_AUTHENTIFIE: 401,
  ACCES_REFUSE: 403,
  INTROUVABLE: 404,
  CONFLIT: 409,
  RENDEZ_VOUS_EN_CONFLIT: 409,
  PAGE_INVALIDE: 400,
  TROP_DE_REQUETES: 429,
  COMPTE_VERROUILLE: 423,
  PAIEMENT_EN_DOUBLON: 409,
  MONTANT_INVALIDE: 422,
  FICHIER_INVALIDE: 422,
  FICHIER_TROP_VOLUMINEUX: 413,
  CORBEILLE_EXPIREE: 410,
  SERVICE_INDISPONIBLE: 503,
  ERREUR_INTERNE: 500,
}

/**
 * Details structures pour la validation : permettent a l'interface de
 * positionner les messages sous le bon champ, sans jamais exposer d'internals.
 */
export interface FieldError {
  champ: string
  message: string
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly httpStatus: number
  readonly publicMessage: string
  readonly internals?: Record<string, unknown>
  readonly fieldErrors?: FieldError[]

  constructor(
    code: AppErrorCode,
    publicMessage: string,
    options?: {
      internals?: Record<string, unknown>
      fieldErrors?: FieldError[]
      cause?: unknown
    },
  ) {
    // Le message de `Error` sert aux journaux serveur, pas au client.
    super(`[${code}] ${publicMessage}`, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.httpStatus = HTTP_STATUS[code]
    this.publicMessage = publicMessage
    this.internals = options?.internals
    this.fieldErrors = options?.fieldErrors
  }

  /** Reponse JSON sure, destinee au client. */
  toPublicJSON(): {
    code: AppErrorCode
    message: string
    champs?: FieldError[]
  } {
    return {
      code: this.code,
      message: this.publicMessage,
      ...(this.fieldErrors && this.fieldErrors.length > 0 ? { champs: this.fieldErrors } : {}),
    }
  }
}

// -----------------------------------------------------------------------------
//  FABRIQUES — messages francais standardises
// -----------------------------------------------------------------------------

export const erreurs = {
  validation: (message: string, fieldErrors?: FieldError[]): AppError =>
    new AppError('VALIDATION', message, { fieldErrors }),

  nonAuthentifie: (): AppError =>
    new AppError('NON_AUTHENTIFIE', 'Vous devez etre connecte pour effectuer cette action.'),

  accesRefuse: (): AppError =>
    new AppError('ACCES_REFUSE', "Vous n'etes pas autorise a effectuer cette action."),

  introuvable: (entite = 'Element'): AppError =>
    new AppError('INTROUVABLE', `${entite} introuvable.`),

  conflit: (message: string): AppError => new AppError('CONFLIT', message),

  rendezVousEnConflit: (message: string): AppError =>
    new AppError('RENDEZ_VOUS_EN_CONFLIT', message),

  tropDeRequetes: (): AppError =>
    new AppError('TROP_DE_REQUETES', 'Trop de tentatives. Veuillez patienter avant de reessayer.'),

  compteVerrouille: (minutes: number): AppError =>
    new AppError(
      'COMPTE_VERROUILLE',
      `Compte temporairement verrouille apres plusieurs echecs. Reessayez dans ${minutes} minute(s).`,
    ),

  paiementEnDoublon: (): AppError =>
    new AppError('PAIEMENT_EN_DOUBLON', 'Ce paiement a deja ete enregistre.'),

  montantInvalide: (message: string): AppError => new AppError('MONTANT_INVALIDE', message),

  fichierInvalide: (message: string): AppError => new AppError('FICHIER_INVALIDE', message),

  fichierTropVolumineux: (maxMo: number): AppError =>
    new AppError(
      'FICHIER_TROP_VOLUMINEUX',
      `Le fichier depasse la taille maximale autorisee (${maxMo} Mo).`,
    ),

  corbeilleExpiree: (): AppError =>
    new AppError(
      'CORBEILLE_EXPIREE',
      'Le delai de restauration de 24 heures est ecoule. Cet element ne peut plus etre restaure.',
    ),

  serviceIndisponible: (): AppError =>
    new AppError(
      'SERVICE_INDISPONIBLE',
      'Le service est temporairement indisponible. Veuillez reessayer dans quelques instants.',
    ),

  interne: (internals?: Record<string, unknown>): AppError =>
    new AppError('ERREUR_INTERNE', 'Une erreur interne est survenue. Veuillez reessayer.', {
      internals,
    }),
}

/** Type guard : distingue nos erreurs maitrisees des erreurs inattendues. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
