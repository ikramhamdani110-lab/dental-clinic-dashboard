import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { GenerateurOrdonnance } from '@/components/medical/generateur-ordonnance'

/**
 * NOUVELLE ORDONNANCE — generateur integre (§21).
 *
 * Meme structure que `/rendez-vous/nouveau` : une page privee qui heberge un
 * formulaire client. `useSearchParams` (pre-selection du patient depuis la
 * fiche) exige une frontiere Suspense.
 */
export const metadata: Metadata = {
  title: t('ordonnances.nouvelle'),
  robots: { index: false, follow: false },
}

export default async function PageNouvelleOrdonnance(): Promise<React.JSX.Element> {
  return (
    <PagePrivee cleTitre="ordonnances.nouvelle">
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <GenerateurOrdonnance />
      </Suspense>
    </PagePrivee>
  )
}
