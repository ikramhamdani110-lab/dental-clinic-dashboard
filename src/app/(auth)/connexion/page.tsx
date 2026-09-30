import type { Metadata } from 'next'

import { t } from '@content/index'

import { FormulaireConnexion } from '@/components/auth/formulaire-connexion'

/**
 * Page de connexion (§6).
 *
 * Accessible a tout le monde (c'est la porte d'entree), mais SEUL le compte
 * medecin existe (§2) : aucun portail patient, aucune inscription.
 *
 * La page est `noindex` : un moteur de recherche ne doit pas la proposer.
 */
export const metadata: Metadata = {
  title: t('auth.titreConnexion'),
  robots: { index: false, follow: false },
}

export default function PageConnexion(): React.JSX.Element {
  return (
    <main className="page-connexion">
      <div className="carte carte-connexion">
        <div className="carte-corps">
          <div className="connexion-marque">
            <span className="connexion-logo" aria-hidden="true">
              DS
            </span>
            <h1 className="connexion-titre">{t('auth.titreConnexion')}</h1>
            <p className="connexion-sous-titre">{t('auth.sousTitreConnexion')}</p>
          </div>

          <FormulaireConnexion />

          <p className="connexion-securite">
            <span aria-hidden="true">🔒</span>
            <span>{t('auth.securite')}</span>
          </p>

          <p className="champ-aide" style={{ marginTop: 'var(--espace-4)', textAlign: 'center' }}>
            {t('auth.aideMotDePasse')}
          </p>
        </div>
      </div>
    </main>
  )
}
