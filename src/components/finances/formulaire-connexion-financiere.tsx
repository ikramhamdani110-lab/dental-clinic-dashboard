'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ApiError, requeteFinanciere } from '@/lib/finances-api-client'

/**
 * =============================================================================
 *  FORMULAIRE DE CONNEXION — VERSION MINIMALE (§finances-v7)
 * =============================================================================
 *
 *  Trois éléments visibles, RIEN d'autre :
 *    1. champ Email ;
 *    2. champ Mot de passe (avec bascule afficher/masquer en CONTRÔLE ICÔNE,
 *       sans aucun texte visible — l'accessibilité passe par aria-label) ;
 *    3. bouton « Connecter ».
 *
 *  Les labels restent dans le DOM pour les lecteurs d'écran, mais sont
 *  visuellement masqués (classe `finances-sr-only`) : c'est la demande
 *  explicite du propriétaire du site.
 *
 *  Les erreurs d'authentification restent affichées quand elles surviennent.
 */
export function FormulaireConnexionFinanciere(): React.JSX.Element {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [mdpVisible, setMdpVisible] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)
    setEnCours(true)

    try {
      await requeteFinanciere('/api/finances/auth', {
        methode: 'POST',
        corps: { email, password: motDePasse },
      })
      router.push('/finances')
      router.refresh()
    } catch (cause) {
      setErreur(cause instanceof ApiError ? cause.message : 'Connexion impossible. Réessayez.')
      setEnCours(false)
    }
  }

  return (
    <form onSubmit={soumettre} noValidate>
      {erreur ? (
        <div role="alert" className="finances-erreur">
          {erreur}
        </div>
      ) : null}

      <div className="finances-champ">
        {/* Label présent pour l'accessibilité, masqué visuellement. */}
        <label htmlFor="finances-email" className="finances-sr-only">Email</label>
        <input
          id="finances-email"
          type="email"
          autoComplete="username"
          required
          placeholder="Email"
          value={email}
          onChange={(evenement) => setEmail(evenement.target.value)}
          disabled={enCours}
        />
      </div>

      <div className="finances-champ">
        <label htmlFor="finances-mot-de-passe" className="finances-sr-only">Mot de passe</label>
        <div className="finances-champ-mdp">
          <input
            id="finances-mot-de-passe"
            type={mdpVisible ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="Mot de passe"
            value={motDePasse}
            onChange={(evenement) => setMotDePasse(evenement.target.value)}
            disabled={enCours}
          />
          {/* Contrôle ICÔNE uniquement : aucun mot « Afficher » à l'écran. */}
          <button
            type="button"
            className="finances-bascule-mdp"
            aria-pressed={mdpVisible}
            aria-label={mdpVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            onClick={() => setMdpVisible((visible) => !visible)}
            disabled={enCours}
          >
            {mdpVisible ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <button type="submit" disabled={enCours} className="finances-bouton finances-bouton-principal">
        {enCours ? '…' : 'Connecter'}
      </button>
    </form>
  )
}
