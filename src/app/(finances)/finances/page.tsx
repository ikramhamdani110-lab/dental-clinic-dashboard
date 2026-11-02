import type { Metadata } from 'next'

import { TableauBordFinancier } from '@/components/finances/tableau-bord-financier'

/**
 * Page d'accueil du site financier privé — accès réservé au médecin.
 *
 * La protection est faite par la mise en page du groupe `(finances)` : sans
 * session financière dédiée valide, l'utilisateur est redirigé vers
 * `/finances/connexion` AVANT que cette page ne soit rendue.
 */
export const metadata: Metadata = {
  title: 'Finances privées',
  robots: { index: false, follow: false },
}

export default function PageFinances(): React.JSX.Element {
  return <TableauBordFinancier />
}
