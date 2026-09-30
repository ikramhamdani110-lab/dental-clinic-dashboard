import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ListePatients } from '@/components/patients/liste-patients'

/** Liste des patients (§9). */
export const metadata: Metadata = {
  title: t('patients.titre'),
  robots: { index: false, follow: false },
}

export default async function PagePatients(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('patients.titre')}>
      <ListePatients />
    </PagePrivee>
  )
}
