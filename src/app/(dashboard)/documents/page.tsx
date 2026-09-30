import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ModuleDocuments } from '@/components/medical/module-documents'

/** Documents (§22). */
export const metadata: Metadata = {
  title: t('documents.titre'),
  robots: { index: false, follow: false },
}

export default async function PageDocuments(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('documents.titre')}>
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <ModuleDocuments />
      </Suspense>
    </PagePrivee>
  )
}
