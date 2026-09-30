/**
 * =============================================================================
 *  AGE DU PATIENT — LECTURE ET CALCUL D'AFFICHAGE
 * =============================================================================
 *
 *  DEUX SOURCES, UNE SEULE REGLE DE LECTURE
 *
 *    1. `age` — l'age SAISI au cabinet, en annees revolues. C'est desormais la
 *       donnee de reference : le formulaire demande l'age, pas la date de
 *       naissance, et un patient peut donc exister sans date de naissance.
 *
 *    2. `dateNaissance` — conservee pour les patients deja enregistres et pour
 *       les importations. Elle reste la donnee la plus precise (un age seul ne
 *       dit pas si un patient a 7 ans ou 7 ans et 11 mois), mais elle n'est plus
 *       demandee a la creation.
 *
 *  L'AGE SAISI PRIME ; la date de naissance sert de repli. Un patient enregistre
 *  avant ce changement continue donc d'afficher un age exact, sans qu'aucune
 *  donnee n'ait ete inventee ni recopiee.
 *
 *  Ce module est partage par la liste des patients et la fiche patient : la
 *  lecture et la formulation sont ainsi STRICTEMENT identiques partout, et il
 *  n'existe qu'un seul endroit a corriger.
 *
 *  La date de naissance n'est JAMAIS affichee (§ respect de la demande) : seul
 *  l'age qui en est derive l'est.
 */

/**
 * Age a AFFICHER pour un patient.
 *
 * Renvoie l'age saisi s'il existe, sinon l'age calcule depuis la date de
 * naissance, sinon `null` (l'interface affiche alors un tiret).
 */
export function ageDuPatient(patient: {
  age?: number | null
  dateNaissance?: string | null
}): number | null {
  if (typeof patient.age === 'number' && Number.isFinite(patient.age)) return patient.age
  return calculerAge(patient.dateNaissance)
}

/**
 * Age en annees revolues a partir d'une date de naissance ISO.
 *
 * Renvoie `null` lorsque la date est absente ou inexploitable : l'interface
 * affiche alors un tiret plutot qu'un age invente (jamais « 0 an » par defaut).
 *
 * Le calcul tient compte du mois ET du jour : un patient ne fete pas son
 * anniversaire le 1er janvier. Apres la date d'anniversaire de l'annee en
 * cours, l'age est celui de l'annee ; avant, il faut retirer une annee.
 */
export function calculerAge(dateNaissance: string | null | undefined): number | null {
  if (!dateNaissance) return null

  const naissance = new Date(dateNaissance)
  if (Number.isNaN(naissance.getTime())) return null

  const maintenant = new Date()

  let annees = maintenant.getFullYear() - naissance.getFullYear()
  const mois = maintenant.getMonth() - naissance.getMonth()
  if (mois < 0 || (mois === 0 && maintenant.getDate() < naissance.getDate())) annees -= 1

  // Une date de naissance future est une saisie erronee : aucun age n'est
  // affiche plutot qu'un age negatif absurde.
  return annees >= 0 ? annees : null
}

/**
 * Formule l'age pour l'affichage, avec la bonne marque du singulier :
 *   `1 an`   — un an exactement, jamais « 1 ans »
 *   `7 ans`  — plusieurs annees
 *   `24 ans`
 *
 * Renvoie un tiret lorsque l'age est inconnu, afin que le medecin distingue
 * « age non renseigne » de « age egal a zero ».
 *
 * ATTENTION — la signature historique (une date de naissance) est CONSERVEE :
 * les appelants qui ne disposent que d'une date continuent de fonctionner. Un
 * appelant qui possede aussi l'age saisi doit utiliser `formaterAgePatient`.
 */
export function formaterAge(dateNaissance: string | null | undefined): string {
  const annees = calculerAge(dateNaissance)
  if (annees === null) return '—'
  return annees === 1 ? '1 an' : `${annees} ans`
}

/** Comme `formaterAge`, mais l'age SAISI prime sur la date de naissance. */
export function formaterAgePatient(patient: {
  age?: number | null
  dateNaissance?: string | null
}): string {
  const annees = ageDuPatient(patient)
  if (annees === null) return '—'
  return annees === 1 ? '1 an' : `${annees} ans`
}