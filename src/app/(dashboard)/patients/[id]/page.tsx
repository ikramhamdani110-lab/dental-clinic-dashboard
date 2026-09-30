import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { t } from '@content/index'

import { identifiant } from '@backend/validation/schemas'

import { PagePrivee } from '@/components/layout/page-privee'
import { FichePatient } from '@/components/patients/fiche-patient'

/**
 * Fiche patient (§10) : espace de travail central.
 *
 * L'identifiant de l'URL est valide comme UUID cote serveur. Un identifiant
 * malforme produit une page 404, jamais une erreur technique. Cet identifiant
 * n'est JAMAIS affiche comme « numero de patient » (§48).
 */
export const metadata: Metadata = {
  title: t('patients.fiche'),
  robots: { index: false, follow: false },
}

export default async function PageFichePatient({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params

  // Validation de l'identifiant avant tout appel reseau cote client.
  const resultat = identifiant.safeParse(id)
  if (!resultat.success) notFound()

  return (
    <PagePrivee titre={t('patients.fiche')}>
      <FichePatient patientId={resultat.data} />
    </PagePrivee>
  )
}
