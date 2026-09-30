/**
 * =============================================================================
 *  ICONES
 * =============================================================================
 *
 *  Icones SVG inline, dessinees a la main, aux traits fins et coherents.
 *
 *  POURQUOI PAS UNE BIBLIOTHEQUE D'ICONES ?
 *    Le besoin est limite a une quinzaine de pictogrammes de navigation. Une
 *    bibliotheque complete ajouterait une dependance, un poids de bundle et une
 *    surface de maintenance sans contrepartie (§58 : chaque dependance doit
 *    avoir une raison). Ces icones sont volontairement petites, monocouleur, et
 *    heritent de la couleur du texte (`currentColor`).
 *
 *  Les icones sont DECORATIVES : elles sont toujours accompagnees d'un libelle
 *  texte, donc `aria-hidden="true"`. Aucune icone ne porte a elle seule une
 *  information.
 */

export type NomIcone =
  | 'tableau-de-bord'
  | 'patients'
  | 'calendrier'
  | 'traitements'
  | 'paiements'
  | 'dossier'
  | 'ordonnance'
  | 'dent'
  | 'document'
  | 'rapports'
  | 'journal'
  | 'corbeille'
  | 'parametres'
  | 'deconnexion'
  | 'recherche'
  | 'ajouter'
  | 'fermer'
  | 'soleil'
  | 'lune'

/** Tracés (attribut `d`) par nom d'icone. Tous sur une grille 24x24. */
const TRACES: Record<NomIcone, string> = {
  // Tableau de bord : quatre blocs.
  'tableau-de-bord': 'M3 3h7v7H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 13h7v8H3z',
  // Patients : deux silhouettes.
  patients:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6',
  // Calendrier.
  calendrier: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M8 13h3M13 13h3M8 17h3',
  // Traitements : liste cochee.
  traitements: 'M9 6h11M9 12h11M9 18h11M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17',
  // Paiements : billet.
  paiements: 'M3 7h18v10H3zM3 10h18M7 14h3',
  // Dossier medical : document avec croix.
  dossier: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  // Ordonnance : flacon / ordonnance.
  ordonnance: 'M8 3h8v3H8zM7 6h10v15H7zM10 11h4M10 15h4M10 19h2',
  // Dent.
  dent: 'M12 3c-3 0-4 1-6 1S3 5 3 8c0 2 1 3 1.5 5S5 21 7 21s2-4 2.5-6S11 13 12 13s2 0 2.5 2S15 21 17 21s2-6 2.5-8S21 10 21 8c0-3-1-4-3-4s-3-1-6-1z',
  // Document : fichier.
  document: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  // Rapports : graphique a barres.
  rapports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  // Journal : lignes horodatees.
  journal: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  // Corbeille.
  corbeille: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  // Parametres : engrenage simplifie.
  parametres:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  // Deconnexion : porte + fleche.
  deconnexion: 'M14 3H5v18h9M11 12h10M18 8l4 4-4 4',
  // Recherche : loupe.
  recherche: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  // Ajouter : plus.
  ajouter: 'M12 5v14M5 12h14',
  // Fermer : croix.
  fermer: 'M6 6l12 12M18 6L6 18',
  // Soleil : mode clair. Meme famille de traits que `parametres`.
  soleil:
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  // Lune : mode sombre.
  lune: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
}

export function Icone({
  nom,
  className,
}: {
  nom: NomIcone
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TRACES[nom]} />
    </svg>
  )
}
