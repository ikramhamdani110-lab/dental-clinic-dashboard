import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ModuleOdontogramme } from '@/components/medical/module-odontogramme'

/** Odontogramme FDI (§20). */
export const metadata: Metadata = {
  title: t('odontogramme.titre'),
  robots: { index: false, follow: false },
}

export default async function PageOdontogramme(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('odontogramme.titre')}>
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <ModuleOdontogramme />
      </Suspense>
    </PagePrivee>
  )
}
