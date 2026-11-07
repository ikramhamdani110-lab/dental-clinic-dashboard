'use client'

import { useEffect, useRef, useState } from 'react'

import { formaterMontant, parseMontantEnCentimes } from '@backend/domain/finance'

import type { LigneDepense } from '@/components/finances/contrats-finances'
import { formaterDate } from '@/components/finances/contrats-finances'
import { ApiError, genererCleAntiDoublon, requeteFinanciere } from '@/lib/finances-api-client'

/**
 * =============================================================================
 *  FORMULAIRE DE DÉPENSE — AJOUT, MODIFICATION, SUPPRESSION
 * =============================================================================
 *
 *  TROIS CHAMPS, EXACTEMENT CEUX DEMANDÉS :
 *    1. Titre  — libellé libre (« Loyer », « Électricité », « Matériel »…).
 *    2. Montant — en DINARS ALGÉRIENS, converti en centimes entiers.
 *    3. Date   — date de la dépense, celle du justificatif.
 *
 *  Le médecin ne saisit NI catégorie NI note : le rangement est déduit du titre
 *  côté serveur. Une dépense ne touche JAMAIS aux paiements ni aux dettes :
 *  elle n'écrit que dans `expenses`.
 *
 *  SUPPRESSION : jamais immédiate. Une seconde étape affiche le titre et le
 *  montant de la dépense concernée ; c'est la seule façon d'éviter qu'une
 *  mauvaise ligne ne disparaisse d'un clic.
 */

export type ModeDepense = 'creation' | 'modification'

export function FormulaireDepense({
  mode,
  depense,
  demandeSuppression,
  onFermer,
  onEnregistre,
}: {
  mode: ModeDepense
  /** Dépense à modifier — `null` en création. */
  depense: LigneDepense | null
  /**
   * Arrivée par l'action « Supprimer » de l'historique : la confirmation est
   * affichée D'EMBLÉE. Le médecin a déjà désigné la ligne et l'intention ; lui
   * demander de cliquer une seconde fois sur « Supprimer » serait une étape de
   * trop.
   */
  demandeSuppression?: boolean
  onFermer: () => void
  /** Appelé après un enregistrement réussi (rafraîchit boîtes, graphique, historique). */
  onEnregistre: (message: string) => void
}): React.JSX.Element {
  const [titre, setTitre] = useState(depense?.titre ?? '')
  const [montant, setMontant] = useState(
    depense ? String(Math.round(depense.montantCentimes) / 100).replace('.', ',') : '',
  )
  const [date, setDate] = useState(depense ? depense.date.slice(0, 10) : aujourdhui())
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({})
  const [confirmation, setConfirmation] = useState(Boolean(demandeSuppression) && Boolean(depense))
  const titreRef = useRef<HTMLInputElement | null>(null)
  const echec = useRef(false)

  // Une clé d'idempotence par FORMULAIRE ouvert : un double clic ne crée pas
  // deux dépenses. En modification, la clé n'est pas utilisée.
  const cleRef = useRef(genererCleAntiDoublon())

  useEffect(() => {
    titreRef.current?.focus()
  }, [])

  useEffect(() => {
    function auClavier(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape' && !enCours) onFermer()
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [onFermer, enCours])

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)
    setErreursChamps({})

    const titrePropre = titre.trim()
    const champs: Record<string, string> = {}
    if (titrePropre.length === 0) champs.titre = 'Indiquez le titre de la dépense.'
    else if (titrePropre.length > 120) champs.titre = 'Le titre dépasse 120 caractères.'

    const montantCentimes = parseMontantEnCentimes(montant)
    if (montantCentimes === null) champs.montant = 'Montant invalide (exemple : 12 500 ou 12500,50).'
    else if (montantCentimes <= 0) champs.montant = 'Le montant doit être supérieur à zéro.'

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) champs.date = 'Choisissez une date.'

    if (Object.keys(champs).length > 0) {
      setErreursChamps(champs)
      return
    }

    setEnCours(true)
    echec.current = false
    try {
      if (mode === 'creation') {
        await requeteFinanciere('/api/finances/expenses', {
          methode: 'POST',
          corps: {
            titre: titrePropre,
            montantCentimes,
            date,
            idempotencyKey: cleRef.current,
          },
        })
      } else if (depense) {
        await requeteFinanciere(`/api/finances/expenses/${encodeURIComponent(depense.id)}`, {
          methode: 'PUT',
          corps: { titre: titrePropre, montantCentimes, date },
        })
      }
      onEnregistre(mode === 'creation' ? 'Dépense enregistrée.' : 'Dépense modifiée.')
    } catch (cause) {
      echec.current = true
      if (cause instanceof ApiError) {
        setErreur(cause.message)
        if (cause.champs) {
          setErreursChamps(Object.fromEntries(cause.champs.map((c) => [c.champ, c.message])))
        }
      } else {
        setErreur('Enregistrement impossible. Réessayez.')
      }
    } finally {
      if (echec.current) setEnCours(false)
    }
  }

  async function supprimer(): Promise<void> {
    if (!depense) return
    setEnCours(true)
    setErreur(null)
    echec.current = false
    try {
      await requeteFinanciere(`/api/finances/expenses/${encodeURIComponent(depense.id)}`, {
        methode: 'DELETE',
      })
      onEnregistre('Dépense supprimée.')
    } catch (cause) {
      echec.current = true
      setErreur(cause instanceof ApiError ? cause.message : 'Suppression impossible. Réessayez.')
      setEnCours(false)
      setConfirmation(false)
    }
  }

  const montantApercu = parseMontantEnCentimes(montant)

  return (
    /*
     * LE VOILE NE FERME QUE SUR UN CLIC COMMENCÉ SUR LUI.
     *
     * Le voile apparaît SOUS le curseur à l'instant où le clic sur
     * « Supprimer » est relâché. Le navigateur (et React, qui remonte
     * l'événement) peuvent rattacher ce même clic au voile qui vient d'être
     * monté : la fenêtre se refermait aussitôt ouverte, et le médecin devait
     * recliquer. `target === currentTarget` exige que l'appui ait eu lieu sur le
     * fond lui-même, pas sur un élément qu'il recouvre désormais.
     */
    <div
      className="finances-voile finances-voile--centre"
      role="presentation"
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget) onFermer()
      }}
    >
      <div
        className="finances-modale finances-modale-depense"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-formulaire-depense"
        onClick={(evenement) => evenement.stopPropagation()}
      >
        <header className="finances-modale-entete">
          <div>
            <p className="finances-sur-titre">
              {confirmation ? 'Suppression' : mode === 'creation' ? 'Nouvelle écriture' : 'Modification'}
            </p>
            <h2 id="titre-formulaire-depense" className="finances-modale-titre">
              {confirmation
                ? 'Supprimer la dépense'
                : mode === 'creation'
                  ? 'Ajouter une dépense'
                  : 'Modifier la dépense'}
            </h2>
          </div>
          <button type="button" className="finances-fermer" onClick={onFermer} aria-label="Fermer" disabled={enCours}>
            <IconeFermer />
          </button>
        </header>

        {confirmation && depense ? (
          <div className="finances-confirmation" role="alertdialog" aria-labelledby="titre-suppression">
            <p id="titre-suppression" className="finances-confirmation-titre">
              Confirmer la suppression de la dépense « {depense.titre} »
            </p>
            <p className="finances-confirmation-texte">
              {formaterDate(depense.date)} — {formaterMontant(depense.montantCentimes)}. La
              dépense sera retirée du total et de l’historique. Les paiements des patients ne sont
              pas touchés.
            </p>
            {erreur ? <p className="finances-confirmation-erreur">{erreur}</p> : null}
            <div className="finances-actions">
              <button type="button" className="finances-bouton" onClick={() => setConfirmation(false)} disabled={enCours}>
                Annuler
              </button>
              <button type="button" className="finances-bouton finances-bouton-danger" onClick={supprimer} disabled={enCours}>
                {enCours ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        ) : (
          <form className="finances-formulaire" onSubmit={soumettre} noValidate>
            {erreur ? (
              <div className="finances-erreur" role="alert">
                {erreur}
              </div>
            ) : null}

            <div className="finances-champ">
              <label htmlFor="dep-titre">Titre</label>
              <input
                ref={titreRef}
                id="dep-titre"
                type="text"
                name="dep-titre"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={false}
                maxLength={120}
                placeholder="Loyer, Électricité, Matériel dentaire…"
                value={titre}
                onChange={(evenement) => setTitre(evenement.target.value)}
                aria-invalid={Boolean(erreursChamps.titre)}
                aria-describedby={erreursChamps.titre ? 'dep-titre-erreur' : undefined}
                disabled={enCours}
              />
              {erreursChamps.titre ? (
                <span id="dep-titre-erreur" className="finances-champ-erreur">
                  {erreursChamps.titre}
                </span>
              ) : null}
            </div>

            <div className="finances-champ">
              <label htmlFor="dep-montant">Montant (DA)</label>
              <div className="finances-champ-groupe">
                <input
                  id="dep-montant"
                  type="text"
                  name="dep-montant"
                  inputMode="decimal"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  placeholder="0"
                  value={montant}
                  onChange={(evenement) => setMontant(evenement.target.value)}
                  aria-invalid={Boolean(erreursChamps.montant)}
                  aria-describedby={erreursChamps.montant ? 'dep-montant-erreur' : undefined}
                  disabled={enCours}
                />
                <span className="finances-champ-suffixe">DA</span>
              </div>
              {erreursChamps.montant ? (
                <span id="dep-montant-erreur" className="finances-champ-erreur">
                  {erreursChamps.montant}
                </span>
              ) : null}
            </div>

            <div className="finances-champ">
              <label htmlFor="dep-date">Date</label>
              <input
                id="dep-date"
                type="date"
                name="dep-date"
                value={date}
                max={aujourdhui()}
                onChange={(evenement) => setDate(evenement.target.value)}
                aria-invalid={Boolean(erreursChamps.date)}
                aria-describedby={erreursChamps.date ? 'dep-date-erreur' : undefined}
                disabled={enCours}
              />
              {erreursChamps.date ? (
                <span id="dep-date-erreur" className="finances-champ-erreur">
                  {erreursChamps.date}
                </span>
              ) : null}
            </div>

            {montantApercu !== null && montantApercu > 0 ? (
              <p className="finances-apercu">
                Sera comptabilisé comme dépense de{' '}
                <strong>{formaterMontant(montantApercu)}</strong>.
              </p>
            ) : null}

            <div className="finances-actions finances-actions--reparties">
              {mode === 'modification' && depense ? (
                <button
                  type="button"
                  className="finances-bouton finances-bouton-danger-discret"
                  onClick={() => setConfirmation(true)}
                  disabled={enCours}
                >
                  Supprimer
                </button>
              ) : (
                <span />
              )}
              <div className="finances-actions-groupe">
                <button type="button" className="finances-bouton" onClick={onFermer} disabled={enCours}>
                  Annuler
                </button>
                <button type="submit" className="finances-bouton finances-bouton-principal" disabled={enCours}>
                  {enCours
                    ? 'Enregistrement…'
                    : mode === 'creation'
                      ? 'Enregistrer la dépense'
                      : 'Enregistrer les modifications'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
//  UTILITAIRES
// -----------------------------------------------------------------------------

/** Date du jour au format `aaaa-mm-jj`, en calendrier LOCAL. */
function aujourdhui(): string {
  const maintenant = new Date()
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0')
  const jour = String(maintenant.getDate()).padStart(2, '0')
  return `${maintenant.getFullYear()}-${mois}-${jour}`
}

function IconeFermer(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}
