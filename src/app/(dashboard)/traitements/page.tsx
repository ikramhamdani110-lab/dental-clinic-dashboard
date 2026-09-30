import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ListeTraitements } from '@/components/traitements/liste-traitements'

/** Liste des traitements (§12). */
export const metadata: Metadata = {
  title: t('traitements.titre'),
  robots: { index: false, follow: false },
}

export default async function PageTraitements(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('traitements.titre')}>
      <ListeTraitements />
    </PagePrivee>
  )
}
