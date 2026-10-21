import type { Metadata } from 'next'

import { t } from '@content/index'

import { PagePrivee } from '@/components/layout/page-privee'
import { ListePaiements } from '@/components/paiements/liste-paiements'
import { EntetePaiements } from '@/components/paiements/entete-paiements'

/** Liste des paiements (§16). */
export const metadata: Metadata = {
  title: t('paiements.titre'),
  robots: { index: false, follow: false },
}

export default async function PagePaiements(): Promise<React.JSX.Element> {
  return (
    <PagePrivee cleTitre="paiements.titre">
      {/*
        L'entête est un composant CLIENT : `t()` y est résolu au rendu dans la
        langue active. En composant serveur, les libellés restaient figés en
        français lorsque le médecin basculait l'interface en arabe.
      */}
      <EntetePaiements />
      <ListePaiements />
    </PagePrivee>
  )
}
