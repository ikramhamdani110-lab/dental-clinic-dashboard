import type { Metadata } from 'next'
import Link from 'next/link'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { FormulairePatient } from '@/components/patients/formulaire-patient'

/** Creation d'un patient (§9). */
export const metadata: Metadata = {
  title: t('patients.nouveau'),
  robots: { index: false, follow: false },
}

export default async function PageNouveauPatient(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('patients.nouveau')}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/patients">{t('patients.titre')}</Link>
        <span aria-hidden="true">/</span>
        <span>{t('patients.nouveau')}</span>
      </nav>

      <FormulairePatient />
    </PagePrivee>
  )
}
