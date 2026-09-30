/**
 * =============================================================================
 *  CONSTANTES DU DOMAINE
 * =============================================================================
 *
 *  Toutes les valeurs de politique metier vivent ici. Aucune ne doit etre
 *  dupliquee « en dur » ailleurs : une divergence entre le service et
 *  l'interface produirait un comportement incoherent impossible a tracer.
 */

/** Fenetre de restauration de la Corbeille — EXACTEMENT 24 heures (§23). */
export const TRASH_WINDOW_MS = 24 * 60 * 60 * 1000

/** Duree de vie d'une session inactive, en jours. */
export const SESSION_TTL_DAYS = 30

/**
 * Duree d'inactivite avant revocation automatique, en heures.
 * Une session est prolongee a chaque requete authentifiee.
 */
export const SESSION_IDLE_HOURS = 12

/** Duree de vie d'un jeton de reinitialisation de mot de passe, en minutes. */
export const PASSWORD_RESET_TTL_MINUTES = 30

/** Taille de page par defaut et maximale pour toutes les listes (§35). */
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

// -----------------------------------------------------------------------------
//  PROTECTION ANTI-FORCE BRUTE (§6, §38)
// -----------------------------------------------------------------------------

/** Nombre d'echecs consecutifs avant verrouillage du compte. */
export const MAX_FAILED_LOGINS = 5

/** Duree du verrouillage de compte apres depassement, en minutes. */
export const ACCOUNT_LOCK_MINUTES = 15

/** Nombre maximal de tentatives par adresse IP sur la fenetre glissante. */
export const LOGIN_RATE_LIMIT_MAX = 10

/** Fenetre glissante du rate limiting de connexion, en minutes. */
export const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 10

// -----------------------------------------------------------------------------
//  DOCUMENTS (§22)
// -----------------------------------------------------------------------------

/**
 * Types MIME autorises. La verification s'appuie sur le contenu reel du fichier
 * (signature binaire), pas sur l'extension ni sur l'en-tete fourni par le
 * client, tous deux falsifiables.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'application/pdf',
] as const

export const ALLOWED_DOCUMENT_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_DOCUMENT_MIME_TYPES)

// -----------------------------------------------------------------------------
//  TYPES DE TRAITEMENTS PROPOSES (§21 — aide a la saisie, valeur libre acceptee)
// -----------------------------------------------------------------------------

export const TYPES_TRAITEMENT_COURANTS = [
  'Consultation',
  'Detartrage',
  'Soin conservateur (obturation)',
  'Devitalisation',
  'Extraction',
  'Couronne',
  'Bridge',
  'Prothese amovible',
  'Implant',
  'Blanchiment (detartrage esthetique)',
  'Traitement orthodontique',
  'Traitement parodontal',
  'Radiographie',
  'Urgence',
  'Autre',
] as const

/** Types de traitement proposes dans le formulaire de rendez-vous. */
export const TYPES_TRAITEMENT_RENDEZ_VOUS = [
  'تركيب الأسنان',
  'تقويم وتنظيف الأسنان',
  'جراحة الأسنان واللثة',
  'علاج تسوس وعصب الأسنان بالأشعة',
] as const

// -----------------------------------------------------------------------------
//  ODONTOGRAMME FDI (§20)
// -----------------------------------------------------------------------------

/** Denture permanente : 11..18, 21..28, 31..38, 41..48. */
export const FDI_PERMANENTE = [
  '18',
  '17',
  '16',
  '15',
  '14',
  '13',
  '12',
  '11',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '48',
  '47',
  '46',
  '45',
  '44',
  '43',
  '42',
  '41',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
] as const

/** Denture temporaire (enfant) : 51..55, 61..65, 71..75, 81..85. */
export const FDI_TEMPORAIRE = [
  '55',
  '54',
  '53',
  '52',
  '51',
  '61',
  '62',
  '63',
  '64',
  '65',
  '85',
  '84',
  '83',
  '82',
  '81',
  '71',
  '72',
  '73',
  '74',
  '75',
] as const

const FDI_VALID = /^[1-8][1-8]$/

/** Verifie qu'un numero de dent respecte le format FDI a deux chiffres. */
export function estNumeroDentFdiValide(numero: string): boolean {
  return FDI_VALID.test(numero)
}
