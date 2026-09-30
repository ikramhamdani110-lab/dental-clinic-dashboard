import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { Corbeille } from '@/components/corbeille/corbeille'

/**
 * Corbeille (§23).
 *
 * Les elements supprimes y restent RESTAURABLES pendant exactement 24 heures.
 * La duree restante affichee est fournie par le serveur ; le navigateur ne fait
 * que la presenter, il ne la calcule jamais lui-meme.
 */
export const metadata: Metadata = {
  title: t('corbeille.titre'),
  robots: { index: false, follow: false },
}

export default async function PageCorbeille(): Promise<React.JSX.Element> {
  return (
    <PagePrivee titre={t('corbeille.titre')}>
      <Corbeille />
    </PagePrivee>
  )
}
