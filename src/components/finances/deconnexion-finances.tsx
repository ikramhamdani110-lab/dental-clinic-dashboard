'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ApiError, requeteFinanciere } from '@/lib/finances-api-client'

/**
 * =============================================================================
 *  BOUTON « DÉCONNECTER » — POSITIONNÉ DANS L'EN-TÊTE DU TABLEAU DE BORD
 * =============================================================================
 *
 *  L'ancien bandeau blanc (identité + email) a été RETIRÉ (§finances-v7) :
 *  plus aucune barre d'identité, aucune navigation. Il ne reste que l'action
 *  de déconnexion, que l'en-tête de la page affiche discrètement à droite.
 *
 *  La déconnexion reste une ACTION SERVEUR (révocation de la session
 *  financière dédiée) : aucune sécurité affaiblie.
 */
export function DeconnexionFinances(): React.JSX.Element {
  const router = useRouter()
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const seDeconnecter = async (): Promise<void> => {
    setEnCours(true)
    setErreur(null)
    try {
      await requeteFinanciere('/api/finances/auth', { methode: 'DELETE' })
      router.push('/finances/connexion')
      router.refresh()
    } catch (cause) {
      setErreur(cause instanceof ApiError ? cause.message : 'Déconnexion impossible. Réessayez.')
      setEnCours(false)
    }
  }

  return (
    <div className="finances-deconnexion">
      {erreur ? <span role="alert" className="finances-erreur-inline">{erreur}</span> : null}
      <button
        type="button"
        onClick={seDeconnecter}
        disabled={enCours}
        className="finances-bouton finances-bouton-discret"
      >
        {enCours ? 'Déconnexion…' : 'Déconnecter'}
      </button>
    </div>
  )
}
