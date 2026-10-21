'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

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
 */
export function FormulairePremiereConnexion(): React.JSX.Element {
  const router = useRouter()
  const [ancienMotDePasse, setAncienMotDePasse] = useState('')
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)
    setEnCours(true)

    if (nouveauMotDePasse !== confirmation) {
      setErreur(t('premiereConnexion.erreurs.nonCorrespondant'))
      setEnCours(false)
      return
    }

    try {
      await requeteApi('/api/auth/changer-mot-de-passe', {
        methode: 'POST',
        corps: { ancienMotDePasse, nouveauMotDePasse, confirmation },
      })
      // Succès : le médecin accède enfin à son tableau de bord.
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

        <div className={`connexion-champ${nouveauMotDePasse ? ' connexion-champ--rempli' : ''}`}>
          <ChampTexte
            nom="nouveauMotDePasse"
            type="password"
            etiquette={t('premiereConnexion.nouveauMotDePasse')}
            autoComplete="new-password"
            obligatoire
            sansNom
            value={nouveauMotDePasse}
            onChange={(evenement) => setNouveauMotDePasse(evenement.target.value)}
            disabled={enCours}
          />
        </div>

        <div className={`connexion-champ${confirmation ? ' connexion-champ--rempli' : ''}`}>
          <ChampTexte
            nom="confirmation"
            type="password"
            etiquette={t('premiereConnexion.confirmation')}
            autoComplete="new-password"
            obligatoire
            sansNom
            value={confirmation}
            onChange={(evenement) => setConfirmation(evenement.target.value)}
            disabled={enCours}
          />
        </div>
      </div>

      <div className="connexion-actions">
        <Bouton type="submit" variante="principal" disabled={enCours}>
          {enCours ? t('commun.chargement') : t('premiereConnexion.enregistrer')}
        </Bouton>
      </div>
    </form>
  )
}
