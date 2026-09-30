import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { JournalActivite } from '@/components/journal/journal-activite'

/** Journal d'activite (§24). */
export const metadata: Metadata = {
  title: t('journalActivite.titre'),
  robots: { index: false, follow: false },
}

export default async function PageJournalActivite(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('journalActivite.titre')}>
      <JournalActivite />
    </PagePrivee>
  )
}
