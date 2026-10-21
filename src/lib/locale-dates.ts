import { langueActiveActuelle, type Langue } from '@content/index'

/**
 * =============================================================================
 *  LOCALE DES DATES SELON LA LANGUE ACTIVE
 * =============================================================================
 *
 *  Les dates de l'interface etaient composees TOUJOURS en « fr-FR », même quand
 *  le medecin avait bascule l'interface en arabe : le titre du planning restait
 *  « jeudi 8 octobre 2026 » sur une page par ailleurs entierement arabe.
 *
 *  Cette aide renvoie la locale qui correspond a la langue ACTIVE du rendu :
 *
 *      fr  ->  'fr-FR'   (comportement existant, inchangé)
 *      ar  ->  'ar-DZ'   (algérien : mois et jours en arabe, chiffres latins)
 *
 *  Les données du cabinet ne sont PAS concernées : une date stockée en base est
 *  formatée, jamais traduite. Les nombres restent en chiffres latins — l'arrière
 *  -plan PDF utilise déjà exactement cette convention (voir `backend/pdf`).
 *
 *  Utilisation :
 *
 *      new Date(iso).toLocaleDateString(localeDates(), { day: '2-digit', ... })
 */
export function localeDates(): string {
  return langueActiveActuelle() === 'ar' ? 'ar-DZ' : 'fr-FR'
}

/** Locale d'une langue explicite (sans lire l'état global). */
export function localeDeLangue(langue: Langue): string {
  return langue === 'ar' ? 'ar-DZ' : 'fr-FR'
}
