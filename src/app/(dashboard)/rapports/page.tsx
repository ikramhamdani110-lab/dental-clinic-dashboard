import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { Rapports } from '@/components/rapports/rapports'

/** Rapports (§27). */
export const metadata: Metadata = {
  title: t('rapports.titre'),
  robots: { index: false, follow: false },
}

export default async function PageRapports(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('rapports.titre')}>
      <Rapports />
    </PagePrivee>
  )
}
