import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ModuleOrdonnances } from '@/components/medical/module-ordonnances'

/** Ordonnances (§21). */
export const metadata: Metadata = {
  title: t('ordonnances.titre'),
  robots: { index: false, follow: false },
}

export default async function PageOrdonnances(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('ordonnances.titre')}>
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <ModuleOrdonnances />
      </Suspense>
    </PagePrivee>
  )
}
