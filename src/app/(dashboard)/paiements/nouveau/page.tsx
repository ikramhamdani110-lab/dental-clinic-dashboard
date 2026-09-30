import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { FormulairePaiement } from '@/components/paiements/formulaire-paiement'

/** Nouveau paiement (§16). */
export const metadata: Metadata = {
  title: t('paiements.nouveau'),
  robots: { index: false, follow: false },
}

export default async function PageNouveauPaiement(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('paiements.nouveau')}>
      {/* `useSearchParams` exige une frontiere Suspense : le formulaire lit les
          parametres d'URL pour pre-selectionner le patient et le traitement. */}
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <FormulairePaiement />
      </Suspense>
    </PagePrivee>
  )
}
