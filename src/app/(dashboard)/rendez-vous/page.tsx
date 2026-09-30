import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { PlanningRendezVous } from '@/components/rendez-vous/planning-rendez-vous'

/** Planning des rendez-vous (§14). */
export const metadata: Metadata = {
  title: t('rendezVous.titre'),
  robots: { index: false, follow: false },
}

export default async function PageRendezVous(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('rendezVous.titre')}>
      <PlanningRendezVous />
    </PagePrivee>
  )
}
