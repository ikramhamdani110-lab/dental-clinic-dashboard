import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ListePaiements } from '@/components/paiements/liste-paiements'
import { LienBouton } from '@/components/ui/bouton'

/** Liste des paiements (§16). */
export const metadata: Metadata = {
  title: t('paiements.titre'),
  robots: { index: false, follow: false },
}

export default async function PagePaiements(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('paiements.titre')}>
      <div className="entete-page">
        <div className="entete-page-haut">
          <div>
            <h2 className="entete-page-titre">{t('paiements.titre')}</h2>
            <p className="entete-page-sous-titre">{t('paiements.aucun')}</p>
          </div>
          <LienBouton href="/paiements/nouveau" variante="principal">
            {t('paiements.nouveau')}
          </LienBouton>
        </div>
      </div>
      <ListePaiements />
    </PagePrivee>
  )
}
