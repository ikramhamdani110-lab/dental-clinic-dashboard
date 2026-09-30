import type { Metadata } from 'next'
import { Suspense } from 'react'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { FormulaireRendezVous } from '@/components/rendez-vous/formulaire-rendez-vous'

/**
 * NOUVEAU RENDEZ-VOUS (§14).
 *
 * Cette page manquait : le planning et la fiche patient y renvoyaient tous deux,
 * mais l'URL n'existait pas — le medecin tombait sur un 404 et ne pouvait creer
 * aucun rendez-vous depuis l'interface. La creation est desormais possible ici,
 * en passant par l'API existante (`POST /api/appointments`).
 *
 * `useSearchParams` (utilise pour pre-selectionner le patient et la date) exige
 * une frontiere Suspense.
 */
export const metadata: Metadata = {
  title: t('rendezVous.nouveau'),
  robots: { index: false, follow: false },
}

export default async function PageNouveauRendezVous(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('rendezVous.nouveau')}>
      <Suspense fallback={<p className="etat-vide-texte">{t('tableaux.chargement')}</p>}>
        <FormulaireRendezVous />
      </Suspense>
    </PagePrivee>
  )
}