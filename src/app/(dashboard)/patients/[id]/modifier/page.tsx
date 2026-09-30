import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { t } from '@content/index'

import { identifiant } from '@backend/validation/schemas'

import { PagePrivee } from '@/components/layout/page-privee'
import { ModifierPatientClient } from '@/components/patients/modifier-patient-client'

export const metadata: Metadata = {
  title: t('commun.modifier'),
  robots: { index: false, follow: false },
}

/**
 * Modification d'un patient (§9).
 *
 * PRINCIPE HISTORIQUE (§11) : la modification ne touche que les informations
 * d'identification. Les rendez-vous, traitements, paiements et dossiers medicaux
 * deja enregistres ne sont JAMAIS reecrits.
 */
export default async function PageModifierPatient({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params

  const resultat = identifiant.safeParse(id)
  if (!resultat.success) notFound()

  return (
    <PagePrivee titre={t('commun.modifier')}>
      <nav className="fil-ariane" aria-label={t('accessibilite.filAriane')}>
        <Link href="/patients">{t('patients.titre')}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/patients/${resultat.data}`}>{t('patients.fiche')}</Link>
        <span aria-hidden="true">/</span>
        <span>{t('commun.modifier')}</span>
      </nav>

      <ModifierPatientClient patientId={resultat.data} />
    </PagePrivee>
  )
}
