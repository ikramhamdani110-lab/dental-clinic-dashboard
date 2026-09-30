'use client'

import { useEffect } from 'react'

import { t } from '@content/index'

/**
 * =============================================================================
 *  BARRIERE D'ERREUR DU TABLEAU DE BORD (§33, §36)
 * =============================================================================
 *
 *  ISOLEMENT DES PANNES : Next.js monte cette barriere AUTOUR du segment
 *  `(dashboard)`. Une erreur de rendu dans une page ou un composant de ce
 *  segment est capturee ICI, et n'emporte donc pas toute l'application : la
 *  coquille (barre laterale, entete) reste affichee et le medecin peut naviguer
 *  vers une autre section, ou reessayer.
 *
 *  MESSAGE SUR, EN FRANCAIS : l'utilisateur ne voit ni pile d'appel, ni requete
 *  SQL, ni chemin de fichier, ni nom d'erreur technique. Le detail est ecrit
 *  dans la console (cote client) pour le diagnostic, jamais dans l'interface.
 *
 *  `reset()` re-render le segment : le reessai ne recharge pas toute la page, il
 *  rejoue le rendu de la section en panne.
 */

export default function ErreurTableauDeBord({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  useEffect(() => {
    // Journalisation cote client uniquement : le message technique reste hors de
    // l'interface. `digest` est l'identifiant cote serveur, sans contenu sensible.
    console.error('[tableau-de-bord] Erreur de rendu interceptee', {
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="encadre-erreur" role="alert">
      <p style={{ fontWeight: 600, marginBottom: 'var(--espace-2)' }}>{t('erreurs.titre')}</p>
      <p>{t('erreurs.sectionIndisponible')}</p>
      <div style={{ display: 'flex', gap: 'var(--espace-3)', marginTop: 'var(--espace-3)' }}>
        <button type="button" className="bouton-lien" onClick={reset}>
          {t('erreurs.reessayer')}
        </button>
        <a href="/tableau-de-bord" className="bouton-lien">
          {t('erreurs.recharger')}
        </a>
      </div>
    </div>
  )
}