'use client'

/**
 * Action principale de la page : ouvrir le formulaire de dépense.
 * Pleine couleur d'accent — c'est la SEULE écriture que le médecin saisit
 * lui-même dans l'espace financier (les revenus viennent du secrétariat).
 */
export function BoutonNouvelleDepense({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="finances-bouton-plus" onClick={onClick}>
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      Nouvelle dépense
    </button>
  )
}
