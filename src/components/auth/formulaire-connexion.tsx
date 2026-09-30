'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { t } from '@content/index'

import { Bouton } from '@/components/ui/bouton'
import { ChampTexte } from '@/components/ui/champ'
import { ApiError, requeteApi } from '@/lib/api-client'

/**
 * Formulaire de connexion (§6).
 *
 * REGLE DE SECURITE : le message d'echec est TOUJOURS le meme, quel que soit le
 * motif (email inconnu, mot de passe faux, compte verrouille). Cela empeche de
 * decouvrir quels comptes existent. Le message renvoye par le serveur est
 * generic par construction ; le formulaire l'affiche tel quel.
 *
 * Le formulaire n'ECRIT aucun cookie lui-meme : c'est le serveur qui pose les
 * cookies (session HttpOnly + jeton CSRF) dans la reponse de `/api/auth/login`.
 *
 * DEFENSE EN PROFONDEUR (le cas « JS indisponible ») :
 * ------------------------------------------------
 * L'envoi normal passe par `onSubmit` (React), qui appelle l'API en POST. Si le
 * JavaScript ne s'execute pas — panne de ressource, CSP, hydratation impossible —
 * le navigateur retombe sur la soumission HTML NATIVE. Sans precaution, une
 * soumission native d'un formulaire sans `method` part en GET et place les champs
 * dans la QUERY STRING : `?email=...&password=...`. Le mot de passe finirait alors
 * dans la barre d'adresse, l'historique, les journaux du serveur et l'en-tete
 * `Referer`.
 *
 * Trois mesures rendent cette fuite IMPOSSIBLE, independamment de React :
 *
 *  1. `method="post"` : une soumission native part en POST, jamais en GET.
 *  2. `action="/connexion"` : la cible est la PAGE elle-meme, qui ne lit AUCUN
 *     parametre d'URL et ne traite aucune donnee d'authentification. Les champs
 *     partent dans le corps de la requete, que la page ignore : au pire, la
 *     submission n'authentifie rien et recharge la page.
 *  3. Les champs de mot de passe ne portent AUCUN attribut `name`. Sans `name`,
 *     le navigateur ne peut pas serialiser le champ : la valeur n'apparait ni dans
 *     l'URL, ni dans le corps, ni dans les journaux, meme lors d'une soumission
 *     native. Le POST vers l'API, lui, envoie les valeurs par `fetch` (JSON), pas
 *     par serialisation du formulaire.
 *
 * Le formulaire reste donc sur en toutes circonstances : au pire il ne fait rien.
 */
export function FormulaireConnexion(): React.JSX.Element {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function soumettre(evenement: React.FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault()
    setErreur(null)
    setEnCours(true)

    try {
      await requeteApi('/api/auth/login', {
        methode: 'POST',
        corps: { email, password: motDePasse },
      })
      // Connexion reussie : redirection vers le tableau de bord.
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
    <form onSubmit={soumettre} method="post" action="/connexion" noValidate>
      {erreur ? (
        <div className="encadre-erreur" role="alert" style={{ marginBottom: 'var(--espace-4)' }}>
          {erreur}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--espace-4)' }}>
        <ChampTexte
          nom="email"
          type="email"
          etiquette={t('auth.email')}
          placeholder={t('auth.placeholderEmail')}
          autoComplete="username"
          obligatoire
          sansNom
          value={email}
          onChange={(evenement) => setEmail(evenement.target.value)}
          disabled={enCours}
        />

        <ChampTexte
          nom="password"
          type="password"
          etiquette={t('auth.motDePasse')}
          placeholder={t('auth.placeholderMotDePasse')}
          autoComplete="current-password"
          obligatoire
          sansNom
          value={motDePasse}
          onChange={(evenement) => setMotDePasse(evenement.target.value)}
          disabled={enCours}
        />
      </div>

      <div style={{ marginTop: 'var(--espace-5)' }}>
        <Bouton type="submit" variante="principal" disabled={enCours} style={{ width: '100%' }}>
          {enCours ? t('commun.chargement') : t('auth.seConnecter')}
        </Bouton>
      </div>
    </form>
  )
}
