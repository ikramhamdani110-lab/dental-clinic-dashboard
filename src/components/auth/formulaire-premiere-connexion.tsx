'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { t } from '@content/index'

import {
  evaluerExigencesMotDePasse,
  LONGUEUR_MAX_MOT_DE_PASSE,
  LONGUEUR_MIN_MOT_DE_PASSE,
} from '@backend/auth/password-policy'

import { Bouton } from '@/components/ui/bouton'
import { ChampTexte } from '@/components/ui/champ'
import { ApiError, requeteApi } from '@/lib/api-client'

/**
 * Écran de PREMIÈRE CONNEXION — remplacement du mot de passe initial.
 *
 * Atteint uniquement lorsque la connexion a réussi avec le mot de passe
 * initial (`doitChangerMotDePasse = true` renvoyé par `/api/auth/login`).
 * La session est déjà ouverte : c'est ce qui permet à l'appel
 * `/api/auth/changer-mot-de-passe` (route privée) de fonctionner.
 *
 * Aucune autre page n'est accessible tant que le changement n'est pas fait :
 * le tableau de bord et les autres pages privées redirigent ici tant que le
 * mot de passe n'a pas été changé (voir garde côté serveur).
 *
 * =============================================================================
 *  LES EXIGENCES SONT AFFICHÉES EN DIRECT
 * =============================================================================
 *
 *  Avant, l'utilisateur découvrait les règles seulement APRÈS avoir soumis :
 *  le serveur répondait « mot de passe insuffisamment robuste » sans dire ce
 *  qui manquait. Chaque règle est maintenant visible AVANT la saisie, et son
 *  état se met à jour à chaque caractère.
 *
 *  LES RÈGLES NE SONT PAS RÉÉCRITES ICI. Elles viennent de
 *  `@backend/auth/password-policy`, le module que le serveur exécute lui-même
 *  avant de hacher. L'écran ne peut donc pas promettre autre chose que ce que
 *  le serveur applique — c'est une garantie structurelle, pas une convention.
 *
 *  La soumission est bloquée tant que toutes les exigences ne sont pas vertes
 *  ET que les deux champs ne correspondent pas : l'utilisateur reçoit une
 *  explication immédiate au lieu d'un aller-retour réseau inutile.
 */
export function FormulairePremiereConnexion(): React.JSX.Element {
  const router = useRouter()
  const [ancienMotDePasse, setAncienMotDePasse] = useState('')
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [afficherNouveau, setAfficherNouveau] = useState(false)
  const [afficherConfirmation, setAfficherConfirmation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  /*
   * Exigences évaluées à chaque frappe. `useMemo` évite de recalculer les six
   * expressions régulières à chaque rendu sans rapport avec la saisie.
   */
  const exigences = useMemo(
    () => evaluerExigencesMotDePasse(nouveauMotDePasse),
    [nouveauMotDePasse],
  )

  const toutesSatisfaites = exigences.every((exigence) => exigence.verifie)
  const confirmationSaisie = confirmation.length > 0
  const correspond = confirmationSaisie && nouveauMotDePasse === confirmation
  const peutSoumettre =
    ancienMotDePasse.length > 0 && toutesSatisfaites && correspond && !enCours

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)

    // Garde-fou : la soumission est aussi bloquée par l'état du bouton, mais un
    // formulaire peut être validé par la touche Entrée dans certains navigateurs.
    if (!peutSoumettre) {
      if (!toutesSatisfaites) setErreur(t('premiereConnexion.erreurs.politique'))
      else if (!correspond) setErreur(t('premiereConnexion.erreurs.nonCorrespondant'))
      return
    }

    setEnCours(true)

    try {
      await requeteApi('/api/auth/changer-mot-de-passe', {
        methode: 'POST',
        corps: { ancienMotDePasse, nouveauMotDePasse, confirmation },
      })
      // Succès : l'utilisateur accède enfin à son espace de travail.
      router.push('/tableau-de-bord')
      router.refresh()
    } catch (cause) {
      if (cause instanceof ApiError) {
        setErreur(cause.message)
      } else {
        setErreur(t('erreurs.serviceIndisponible'))
      }
      setEnCours(false)
    }
  }

  return (
    <form
      className="connexion-formulaire"
      onSubmit={soumettre}
      method="post"
      action="/premiere-connexion"
      noValidate
    >
      {erreur ? (
        <div className="encadre-erreur connexion-erreur" role="alert">
          {erreur}
        </div>
      ) : null}

      <div className="connexion-champs">
        <div className={`connexion-champ${ancienMotDePasse ? ' connexion-champ--rempli' : ''}`}>
          <ChampTexte
            nom="ancienMotDePasse"
            type="password"
            etiquette={t('premiereConnexion.ancienMotDePasse')}
            autoComplete="current-password"
            obligatoire
            sansNom
            value={ancienMotDePasse}
            onChange={(evenement) => setAncienMotDePasse(evenement.target.value)}
            disabled={enCours}
          />
        </div>

        {/* ── Nouveau mot de passe + œil afficher/masquer ─────────────────── */}
        <div className="connexion-champ-mdp">
          <div className={`connexion-champ${nouveauMotDePasse ? ' connexion-champ--rempli' : ''}`}>
            <ChampTexte
              nom="nouveauMotDePasse"
              type={afficherNouveau ? 'text' : 'password'}
              etiquette={t('premiereConnexion.nouveauMotDePasse')}
              autoComplete="new-password"
              obligatoire
              sansNom
              value={nouveauMotDePasse}
              onChange={(evenement) => setNouveauMotDePasse(evenement.target.value)}
              disabled={enCours}
              maxLength={LONGUEUR_MAX_MOT_DE_PASSE}
            />
          </div>
          <BoutonBasculeVisibilite
            visible={afficherNouveau}
            onBasculer={() => setAfficherNouveau((valeur) => !valeur)}
            etiquette={afficherNouveau ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          />
        </div>

        {/* ── Exigences, visibles AVANT la soumission ─────────────────────── */}
        <div className="mdp-exigences" id="exigences-mdp" aria-live="polite">
          <p className="mdp-exigences-titre">
            Le mot de passe doit respecter les conditions suivantes&nbsp;:
          </p>
          <ul className="mdp-exigences-liste">
            {exigences.map((exigence) => (
              <li
                key={exigence.id}
                className={`mdp-exigence${exigence.verifie ? ' mdp-exigence--ok' : ''}`}
              >
                <span className="mdp-exigence-marque" aria-hidden="true">
                  {exigence.verifie ? '✓' : '•'}
                </span>
                <span className="mdp-exigence-libelle">{exigence.libelle}</span>
                <span className="mdp-sr-only">
                  {exigence.verifie ? ' — condition remplie' : ' — condition non remplie'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mdp-exigences-compteur">
            {nouveauMotDePasse.length} / {LONGUEUR_MIN_MOT_DE_PASSE} caractères minimum
          </p>
        </div>

        {/* ── Confirmation + œil + indicateur de correspondance ───────────── */}
        <div className="connexion-champ-mdp">
          <div className={`connexion-champ${confirmation ? ' connexion-champ--rempli' : ''}`}>
            <ChampTexte
              nom="confirmation"
              type={afficherConfirmation ? 'text' : 'password'}
              etiquette={t('premiereConnexion.confirmation')}
              autoComplete="new-password"
              obligatoire
              sansNom
              erreur={confirmationSaisie && !correspond ? ' ' : undefined}
              value={confirmation}
              onChange={(evenement) => setConfirmation(evenement.target.value)}
              disabled={enCours}
              maxLength={LONGUEUR_MAX_MOT_DE_PASSE}
            />
          </div>
          <BoutonBasculeVisibilite
            visible={afficherConfirmation}
            onBasculer={() => setAfficherConfirmation((valeur) => !valeur)}
            etiquette={
              afficherConfirmation ? 'Masquer la confirmation' : 'Afficher la confirmation'
            }
          />
        </div>

        {confirmationSaisie ? (
          <p
            className={`mdp-correspondance${correspond ? ' mdp-correspondance--ok' : ' mdp-correspondance--ko'}`}
            role="status"
          >
            <span aria-hidden="true">{correspond ? '✓' : '✕'}</span>{' '}
            {correspond
              ? 'Les deux mots de passe correspondent.'
              : 'Les deux mots de passe ne correspondent pas.'}
          </p>
        ) : null}
      </div>

      <div className="connexion-actions">
        <Bouton type="submit" variante="principal" disabled={!peutSoumettre}>
          {enCours ? t('commun.chargement') : t('premiereConnexion.enregistrer')}
        </Bouton>
      </div>
    </form>
  )
}

/**
 * Contrôle œil « afficher / masquer ».
 *
 * `type="button"` est INDISPENSABLE : sans lui, le bouton soumettrait le
 * formulaire au clic. `aria-pressed` expose l'état aux lecteurs d'écran, et
 * `aria-label` décrit l'action (pas l'état, qui change).
 */
function BoutonBasculeVisibilite({
  visible,
  onBasculer,
  etiquette,
}: {
  visible: boolean
  onBasculer: () => void
  etiquette: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="mdp-bascule"
      onClick={onBasculer}
      aria-label={etiquette}
      aria-pressed={visible}
      title={etiquette}
    >
      {visible ? <IconeOeilBarre /> : <IconeOeil />}
    </button>
  )
}

function IconeOeil(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M2.25 12s3.5-6.75 9.75-6.75S21.75 12 21.75 12s-3.5 6.75-9.75 6.75S2.25 12 2.25 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconeOeilBarre(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M2.25 12s3.5-6.75 9.75-6.75c1.7 0 3.2.47 4.48 1.17M21.75 12s-3.5 6.75-9.75 6.75c-1.7 0-3.2-.47-4.48-1.17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
