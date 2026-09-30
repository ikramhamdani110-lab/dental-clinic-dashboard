/**
 * =============================================================================
 *  SIGNAL DE RAFRAICHISSEMENT DES DONNEES (NAVIGATEUR)
 * =============================================================================
 *
 *  Plusieurs ecrans affichent des donnees derivees des MEMES tables : le tableau
 *  de bord (revenus du jour, patients sans rendez-vous) et la fiche patient
 *  (paiements, solde) en sont l'exemple direct.
 *
 *  PROBLEME RESOLU
 *    Le tableau de bord charge ses indicateurs UNE SEULE FOIS au montage. Quand
 *    le medecin enregistre ensuite un paiement depuis la fiche d'un patient, le
 *    montant « Revenus du jour » restait figé jusqu'a un rechargement manuel de
 *    la page — le medecin devait recharger pour voir son propre encaissement.
 *
 *  SOLUTION
 *    Un signal applicatif minimal, sans dependance : l'action qui modifie une
 *    donnee partagee previent les ecrans interesses, qui rechargent alors leur
 *    ressource aupres de l'API.
 *
 *  POINTS IMPORTANTS
 *    - Aucun etat n'est duplique cote client : le signal ne transporte AUCUNE
 *      donnee, il declenche une relecture. Les montants continuent donc de
 *      provenir exclusivement de la base (une seule source de verite).
 *    - Aucun montant n'est recalcule dans le navigateur : le tableau de bord
 *      redemande `GET /api/dashboard`, dont le total est agrege en SQL.
 *    - Le mecanisme est inerte hors navigateur (rendu serveur) : aucune erreur
 *      si `window` n'existe pas.
 */

/** Donnees dont la modification doit faire recharger d'autres ecrans. */
export type RessourceDonnee = 'paiements' | 'rendezVous' | 'patients'

const NOM_EVENEMENT = 'sahed:donnees-modifiees'

/**
 * Previent l'application qu'une ressource vient d'etre modifiee.
 * A appeler APRES le succes de l'appel API, jamais avant.
 */
export function signalerModification(ressource: RessourceDonnee): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<RessourceDonnee>(NOM_EVENEMENT, { detail: ressource }))
}

/**
 * S'abonne aux modifications d'une ressource.
 * Retourne la fonction de desabonnement (a appeler au demontage).
 */
export function surModification(
  ressource: RessourceDonnee,
  gestionnaire: () => void,
): () => void {
  if (typeof window === 'undefined') return () => { }

  const ecouter = (evenement: Event): void => {
    // Seule la ressource surveillee declenche le rechargement : modifier un
    // rendez-vous ne force pas le rechargement des revenus.
    if ((evenement as CustomEvent<RessourceDonnee>).detail === ressource) gestionnaire()
  }

  window.addEventListener(NOM_EVENEMENT, ecouter)
  return () => window.removeEventListener(NOM_EVENEMENT, ecouter)
}