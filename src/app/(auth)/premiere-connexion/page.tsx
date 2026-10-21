import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

import { t } from '@content/index'

import { SESSION_COOKIE_NAME, resolveSession } from '@backend/auth/session'

import { FormulairePremiereConnexion } from '@/components/auth/formulaire-premiere-connexion'

/**
 * Page de PREMIÈRE CONNEXION — remplacement obligatoire du mot de passe initial.
 *
 * Accessible UNIQUEMENT par un utilisateur déjà connecté (la session vient
 * d'être ouverte avec le mot de passe initial). Un visiteur non connecté est
 * renvoyé vers la page de connexion classique.
 *
 * La page est `noindex` et rendue en mode sombre, à l'image de `/connexion`,
 * pour conserver la même identité visuelle pendant la procédure.
 */
export const metadata: Metadata = {
  title: t('premiereConnexion.titre'),
  robots: { index: false, follow: false },
}

export default async function PagePremiereConnexion(): Promise<React.JSX.Element> {
  const magasinCookies = await cookies()
  const jeton = magasinCookies.get(SESSION_COOKIE_NAME)?.value
  const session = await resolveSession(jeton)

  if (!session) {
    redirect('/connexion')
  }

  return (
    <main className="page-connexion" data-theme="sombre">
      {/* Atmosphere : même décor que la page de connexion, continuité visuelle. */}
      <div className="connexion-atmosphere" aria-hidden="true">
        <span className="connexion-lueur connexion-lueur--haute" />
        <span className="connexion-lueur connexion-lueur--basse" />
      </div>

      <div className="connexion-carte">
        <h1 className="connexion-titre">{t('premiereConnexion.titre')}</h1>
        <p className="connexion-sous-titre">{t('premiereConnexion.sousTitre')}</p>

        <FormulairePremiereConnexion />
      </div>
    </main>
  )
}
