'use client'

import { useEffect, useRef } from 'react'

import { t } from '@content/index'

/**
 * =============================================================================
 *  MODALE (§50)
 * =============================================================================
 *
 *  Exigences appliquees :
 *    - Fermeture par la touche Echap.
 *    - Piege de focus : la tabulation reste DANS la modale tant qu'elle est
 *      ouverte (accessibilite clavier).
 *    - Focus place automatiquement dans la modale a l'ouverture, et rendu a
 *      l'element declencheur a la fermeture.
 *    - `aria-modal` et `role="dialog"` pour les lecteurs d'ecran.
 *    - Aucune animation superflue.
 */

export interface ModaleProps {
  ouverte: boolean
  titre: string
  /** Description optionnelle, liee par `aria-describedby`. */
  description?: string
  onFermer: () => void
  children: React.ReactNode
  /** Pied de modale : boutons d'action. */
  pied?: React.ReactNode
  large?: boolean
}

/** Selecteur des elements focusables a l'interieur de la modale. */
const SELECTEUR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modale({
  ouverte,
  titre,
  description,
  onFermer,
  children,
  pied,
  large = false,
}: ModaleProps): React.JSX.Element | null {
  const refModale = useRef<HTMLDivElement>(null)

  /*
   * `onFermer` EST UNE FONCTION : elle est donc re-creee a chaque rendu du
   * composant parent. La garder dans le tableau de dependances de l effet
   * d'ouverture provoquait un effet de bord GRAVE et tres visible :
   *
   *   1. le medecin clique dans le champ « Montant », tape `1`
   *   2. le parent se re-rend (la valeur de l champ a change)
   *   3. `onFermer` est une NOUVELLE fonction, donc l effet se re-execute
   *   4. l effet appelle `premier.focus()`
   *   5. le focus revient au PREMIER champ de la modale   * Le medecin ne pouvait donc saisir qu UN SEUL chiffre par clic : il fallait
   * recliquer dans le champ apres chaque touche pour en saisir un second. Le
   * meme defaut touchait « Nouveau rendez-vous » et « Personnaliser » dans les
   * Rapports.
   *
   * LA CORRECTION — deux references, deux effets :
   *
   *   - `refFermer` conserve la DERNIERE version de `onFermer`. L effet de
   *     fermeture s y abonne : le callback de touche est toujours a jour, et donc
   *     jamais captured dans une version perimee.
   *
   *   - `refDeclencheurCourant` garde l element qui avait le focus a
   *     l OUVERTURE, mais n est lu QUE la. L effet d'ouverture ne depend plus
   *     que de `ouverte` : il ne peut donc plus se re-executer au rythme des
   *     frappe, et le focus n est plus vole.
   *
   * Le focus n est pose qu'a l ouverture — ce qui est le seul moment utile — et
   * le reste du temps le champ conserve naturellement le focus.
   */
  const refFermer = useRef(onFermer)
  refFermer.current = onFermer
  const refDeclencheurCourant = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!ouverte) return undefined

    // Memorise l'element qui avait le focus avant l'ouverture.
    refDeclencheurCourant.current = document.activeElement as HTMLElement | null

    const conteneur = refModale.current
    if (conteneur) {
      const premier = conteneur.querySelector<HTMLElement>(SELECTEUR_FOCUSABLE)
      premier?.focus()
    }

    const gererTouche = (evenement: KeyboardEvent): void => {
      if (evenement.key === 'Escape') {
        evenement.stopPropagation()
        refFermer.current()
        return
      }

      if (evenement.key !== 'Tab' || !refModale.current) return

      // Piege de focus : la tabulation boucle dans la modale.
      const focusables = Array.from(
        refModale.current.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLE),
      ).filter((element) => element.offsetParent !== null)

      if (focusables.length === 0) return

      const premier = focusables[0]
      const dernier = focusables[focusables.length - 1]
      if (!premier || !dernier) return

      if (evenement.shiftKey && document.activeElement === premier) {
        evenement.preventDefault()
        dernier.focus()
      } else if (!evenement.shiftKey && document.activeElement === dernier) {
        evenement.preventDefault()
        premier.focus()
      }
    }

    document.addEventListener('keydown', gererTouche)

    // Empeche le defilement de la page derriere la modale.
    const ancienOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', gererTouche)
      document.body.style.overflow = ancienOverflow
      // Restitue le focus a l'element declencheur.
      refDeclencheurCourant.current?.focus()
    }
    // `ouverte` SEUL : c est ce qui regit l'ouverture. Ajouter `onFermer`
    // faisait re-executer cet effet a chaque frappe (voir la note ci-dessus).
  }, [ouverte])

  if (!ouverte) return null

  return (
    <div
      className="voile-modale"
      // Un clic sur le voile ferme la modale. Le contenu intercepte l'evenement.
      onMouseDown={(evenement) => {
        if (evenement.target === evenement.currentTarget) onFermer()
      }}
    >
      <div
        ref={refModale}
        className={large ? 'modale modale-large' : 'modale'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-modale"
        {...(description ? { 'aria-describedby': 'description-modale' } : {})}
      >
        <div className="modale-entete">
          <h2 className="modale-titre" id="titre-modale">
            {titre}
          </h2>
          <button
            type="button"
            className="bouton-fermer-modale"
            onClick={onFermer}
            aria-label={t('commun.fermer')}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="modale-corps">
          {description ? <p id="description-modale">{description}</p> : null}
          {children}
        </div>

        {pied ? <div className="modale-pied">{pied}</div> : null}
      </div>
    </div>
  )
}

/**
 * Modale de confirmation pour les actions destructrices (§50).
 * Explique TOUJOURS la consequence : le message de Corbeille est explicite.
 */
export interface ModaleConfirmationProps {
  ouverte: boolean
  titre: string
  message: string
  /** Message secondaire : consequence de l'action (ex. 24 heures). */
  avertissement?: string
  libelleConfirmer?: string
  danger?: boolean
  enCours?: boolean
  onConfirmer: () => void
  onAnnuler: () => void
}

export function ModaleConfirmation({
  ouverte,
  titre,
  message,
  avertissement,
  libelleConfirmer,
  danger = false,
  enCours = false,
  onConfirmer,
  onAnnuler,
}: ModaleConfirmationProps): React.JSX.Element | null {
  return (
    <Modale
      ouverte={ouverte}
      titre={titre}
      onFermer={onAnnuler}
      pied={
        <>
          <button type="button" className="bouton bouton-secondaire" onClick={onAnnuler}>
            {t('commun.annuler')}
          </button>
          <button
            type="button"
            className={danger ? 'bouton bouton-danger-plein' : 'bouton bouton-principal'}
            onClick={onConfirmer}
            disabled={enCours}
          >
            {enCours ? t('commun.chargement') : (libelleConfirmer ?? t('commun.confirmer'))}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {avertissement ? (
        <p className="encadre-avertissement" style={{ marginTop: 'var(--espace-4)' }}>
          {avertissement}
        </p>
      ) : null}
    </Modale>
  )
}
