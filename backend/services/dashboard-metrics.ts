/**
 * =============================================================================
 *  TABLEAU DE BORD : DEUX INDICATEURS DU JOUR MANQUANTS
 * =============================================================================
 *
 *  Le tableau de bord doit afficher cinq boites. Trois d'entre elles existent
 *  deja (`rendezVousDuJour`, `totalPatients`, `revenusJourCentimes`) et une
 *  quatrieme (`totalRestantCentimes`) porte le credit a recevoir. Il manquait :
 *
 *    - NOUVEAUX PATIENTS DU JOUR : les patients inscrits pour la premiere fois
 *      aujourd'hui ;
 *
 *    - PATIENTS DU JOUR : TOUS les patients reellement venus au cabinet
 *      aujourd'hui, quelle que soit la maniere dont ils sont venus.
 *
 *  POURQUOI CES DEUX VALEURS SONT CALCULEES, ET NON LUES TELLES QUELLES
 *
 *  Le cabinet ne stocke pas de « fiche de presence » : la venue d'un patient se
 *  lit dans la table des rendez-vous, qui porte DEUX populations distinctes
 *  (voir `appointments.service`) :
 *
 *    - les rendez-vous PLANIFIES (un creneau prevu a l'avance) ;
 *    - les VISITES SPONTANEES, marquees par un motif prefixe
 *      (`MARQUEUR_SANS_RENDEZ_VOUS`).
 *
 *  « Patients du jour » doit compter les personnes, pas les rendez-vous : un
 *  patient venu deux fois le meme jour ne compte QU'UNE fois. On regroupe donc
 *  par identifiant de patient, cote base (`distinct`), et jamais en chargeant
 *  les lignes dans Node.
 *
 *  QUAND UN PATIENT EST-IL « VENU » ?
 *
 *  Cette fonction ne filtre AUCUN statut : elle recoit les listes DEJA filtrees
 *  par l'appelant. Les rendez-vous annules sont ecartes en amont
 *  (`statut: { notIn: ['ANNULE'] }`), comme pour les listes existantes du
 *  tableau de bord. Filtrer une seconde fois ici dupliquerait la regle et
 *  risquerait de la faire diverger.
 *
 *  Autrement dit : tout ce qui est transmis a cette fonction represente une
 *  personne reellement attendue ou recue aujourd'hui.
 */

export interface PresenceJour {
  /** Nombre de patients distincts venus aujourd'hui (jamais de doublon). */
  patientsVenusJour: number
  /** Parmi eux, ceux dont c'est la premiere visite au cabinet. */
  nouveauxPatientsJour: number
}

/**
 * Calcule les presences du jour a partir des rendez-vous et des visites
 * spontanees DEJA charges par `donneesTableauBord`.
 *
 * Aucune requete supplementaire pour le comptage lui-meme : les deux listes sont
 * deja en memoire dans le service, et le nombre de rendez-vous d'une journee est
 * naturellement borne. Cela evite deux aller-retours de plus vers la base a
 * chaque affichage du tableau de bord.
 *
 * `dejaVenus` est l'ensemble des patients ayant un rendez-vous ANTERIEUR a
 * aujourd'hui : il est deja calcule par l'appelant pour classer ancien/nouveau.
 */
export function presencesDuJour(
  rendezVousJour: Array<{ patient: { id: string } }>,
  visitesJour: Array<{ patient: { id: string } }>,
  dejaVenus: Set<string>,
): PresenceJour {
  // Toutes les venues du jour, tous modes de venue confondus.
  // `Set` dedoublonne : un patient venu deux fois ne compte qu'une fois.
  const venus = new Set<string>([
    ...rendezVousJour.map((rdv) => rdv.patient.id),
    ...visitesJour.map((visite) => visite.patient.id),
  ])

  // « Nouveau » = venu aujourd'hui ET jamais venu avant aujourd'hui.
  let nouveaux = 0
  for (const patientId of venus) {
    if (!dejaVenus.has(patientId)) nouveaux += 1
  }

  return { patientsVenusJour: venus.size, nouveauxPatientsJour: nouveaux }
}
