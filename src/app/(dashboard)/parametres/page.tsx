import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ParametresCabinet } from '@/components/parametres/parametres-cabinet'

/** Parametres (§28). */
export const metadata: Metadata = {
  title: t('parametres.titre'),
  robots: { index: false, follow: false },
}

export default async function PageParametres(): Promise<React.JSX.Element> {
  return (
    <PagePrivee cleTitre="parametres.titre">
      <ParametresCabinet />
    </PagePrivee>
  )
}
