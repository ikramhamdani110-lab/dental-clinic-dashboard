import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ModuleDossiersMedicaux } from '@/components/medical/module-dossiers-medicaux'

/** Dossiers medicaux (§19). */
export const metadata: Metadata = {
  title: t('dossiersMedicaux.titre'),
  robots: { index: false, follow: false },
}

export default async function PageDossiersMedicaux(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('dossiersMedicaux.titre')}>
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <ModuleDossiersMedicaux />
      </Suspense>
    </PagePrivee>
  )
}
