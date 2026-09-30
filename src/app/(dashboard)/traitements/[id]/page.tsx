import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { t } from '@content/index'

import { identifiant } from '@backend/validation/schemas'

import { PagePrivee } from '@/components/layout/page-privee'
import { DetailTraitement } from '@/components/traitements/detail-traitement'

/** Detail d'un traitement (§12). */
export const metadata: Metadata = {
  title: t('traitements.titre'),
  robots: { index: false, follow: false },
}

export default async function PageTraitement({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params

  const resultat = identifiant.safeParse(id)
  if (!resultat.success) notFound()

  return (
    <PagePrivee titre={t('traitements.titre')}>
      <DetailTraitement traitementId={resultat.data} />
    </PagePrivee>
  )
}
